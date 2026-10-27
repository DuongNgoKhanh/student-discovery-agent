"""One agent turn: the model proposes, code decides.

Tools are offered from the snapshot's bindings and the catalog only; arguments are validated before any tool runs.
A handoff tool ends the model's turn: the server renders the next activity block (question, clarification, card),
so the model never authors assessment content. Model failures fall back to the snapshot templates.
"""
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import uuid4

from pydantic import ValidationError

from agent_runtime.agent.catalog import (
    NO_CONTEXT,
    TOOL_DECLARATIONS,
    SuggestRepliesArguments,
    ToolContext,
    ToolDeclaration,
)
from agent_runtime.agent.model import (
    AssistantMessage,
    ChatMessage,
    ModelPort,
    ModelUnavailable,
    ModelUsage,
    ToolCall,
    ToolDefinition,
    ToolResultMessage,
    UnavailableReason,
    UserMessage,
)
from agent_runtime.agent.output import sanitize_markdown
from agent_runtime.agent.prompt import AgentContext, system_messages
from agent_runtime.sessions.schemas.activity import MarkdownBlock, SuggestionsBlock, TextBlock, TypedBlock
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.blocks import markdown_to_text

Fallback = UnavailableReason | Literal["max_tool_steps", "empty_reply", "deadline"]
_BUSY = frozenset({"rate_limited", "timeout", "provider_error", "deadline"})


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolCallStarted:
    name: str


AgentEvent = TextDelta | ToolCallStarted


class ToolExecutor(Protocol):
    """Runs a validated call against server state; the returned mapping is shown to the model."""

    def execute(self, name: str, arguments: ContractModel) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class Handoff:
    name: str
    arguments: ContractModel
    result: Mapping[str, Any]


@dataclass(frozen=True)
class AgentTurn:
    blocks: tuple[TypedBlock, ...]  # agent-authored text and suggestions; the handoff block comes after them
    handoff: Handoff | None = None
    fallback: Fallback | None = None
    steps: int = 0
    usage: ModelUsage = ModelUsage()
    cancelled: bool = False


@dataclass(frozen=True)
class _Offered:
    declaration: ToolDeclaration
    definition: ToolDefinition


def offered_tools(snapshot: AgentSnapshotV1, context: ToolContext = NO_CONTEXT) -> dict[str, _Offered]:
    offered = {}
    for binding in snapshot.tools:
        declaration = TOOL_DECLARATIONS[(binding.name, binding.version)]
        offered[binding.name] = _Offered(declaration, ToolDefinition(
            name=binding.name, description=declaration.describe(binding.params, binding.description, context),
            parameters=declaration.parameters(binding.params, context)))
    return offered


def _text_block(block_id: str, text: str, allowed_domains: tuple[str, ...]) -> TypedBlock | None:
    clean = sanitize_markdown(text, allowed_domains)
    if not clean:
        return None
    try:
        return MarkdownBlock(block_id=block_id, type="markdown", schema_version=1, content=clean)
    except ValidationError:  # e.g. prose like "a<b": still worth showing, as plain text
        plain = markdown_to_text(clean).strip()
        return TextBlock(block_id=block_id, type="text", schema_version=1, content=plain) if plain else None


def _fallback(snapshot: AgentSnapshotV1, reason: Fallback, new_id: Callable[[], str], steps: int,
              usage: ModelUsage) -> AgentTurn:
    templates = snapshot.templates
    # Only a reply the agent could not use means "not understood"; the rest are on our side and worth a retry.
    content = templates.busy_message if reason in _BUSY else templates.unknown_message
    blocks: list[TypedBlock] = [TextBlock(block_id=new_id(), type="text", schema_version=1, content=content)]
    if templates.fallback_suggestions:
        blocks.append(SuggestionsBlock(block_id=new_id(), type="suggestions", schema_version=1, items=[
            {"label": label, "message_text": label} for label in templates.fallback_suggestions]))
    return AgentTurn(tuple(blocks), fallback=reason, steps=steps, usage=usage)


def _add(usage: ModelUsage, more: ModelUsage) -> ModelUsage:
    return ModelUsage(usage.input_tokens + more.input_tokens, usage.output_tokens + more.output_tokens)


def run_agent_turn(snapshot: AgentSnapshotV1, model: ModelPort, executor: ToolExecutor, context: AgentContext,
                   history: Sequence[ChatMessage], user_text: str, *,
                   new_id: Callable[[], str] = lambda: uuid4().hex,
                   on_event: Callable[[AgentEvent], None] | None = None,
                   should_stop: Callable[[], bool] | None = None,
                   deadline: float | None = None,
                   clock: Callable[[], float] = time.monotonic,
                   tool_context: ToolContext = NO_CONTEXT) -> AgentTurn:
    emit = on_event or (lambda event: None)
    stop = should_stop or (lambda: False)

    def sink(text: str) -> bool:
        emit(TextDelta(text))
        return not stop()

    usage = ModelUsage()
    if snapshot.model is None:
        return _fallback(snapshot, "not_configured", new_id, 0, usage)
    limits, domains = snapshot.limits, snapshot.links.allowed_domains
    offered = offered_tools(snapshot, tool_context)
    recent = list(history)[-limits.history_messages:] if limits.history_messages else []
    messages: list[ChatMessage] = [*system_messages(snapshot, context), *recent,
                                   UserMessage(user_text[:limits.max_input_chars])]
    definitions = [item.definition for item in offered.values()]
    suggestions: SuggestRepliesArguments | None = None
    lead_in = ""  # the last text written alongside tool calls; used when the finishing reply has none
    for step in range(1, limits.max_tool_steps + 1):
        if stop():
            return AgentTurn((), cancelled=True, steps=step - 1, usage=usage)
        if deadline is not None and clock() >= deadline:
            return _fallback(snapshot, "deadline", new_id, step - 1, usage)
        reply = model.invoke(messages, definitions, snapshot.model.settings(),
                             on_text_delta=sink if on_event else None)
        if isinstance(reply, ModelUnavailable):
            if reply.reason == "cancelled":
                return AgentTurn((), cancelled=True, steps=step, usage=usage)
            return _fallback(snapshot, reply.reason, new_id, step, usage)
        usage = _add(usage, reply.usage)
        handoff = None
        results = []
        for call in reply.tool_calls:
            arguments, error = _validated(offered, call)
            if error is not None:
                results.append(ToolResultMessage(call.id, call.name, {"error": error}))
                continue
            declaration = offered[call.name].declaration
            if not declaration.handoff:
                emit(ToolCallStarted(call.name))
            if declaration.arguments_model is SuggestRepliesArguments:
                suggestions = arguments
                results.append(ToolResultMessage(call.id, call.name, {"shown": True}))
                continue
            result = dict(executor.execute(call.name, arguments))
            # A rejected handoff is an ordinary tool error: the model sees it and may recover.
            if declaration.handoff and "error" not in result:
                handoff = Handoff(call.name, arguments, result)
                break  # later calls in the same reply are dropped: the server owns what happens next
            results.append(ToolResultMessage(call.id, call.name, result))
        if handoff is not None or not reply.tool_calls:
            return _finish(snapshot, reply.text if reply.text.strip() else lead_in, suggestions, handoff, new_id, step, usage, domains)
        if reply.text.strip():
            lead_in = reply.text
        messages += [AssistantMessage(reply.text or None, reply.tool_calls), *results]
    return _fallback(snapshot, "max_tool_steps", new_id, limits.max_tool_steps, usage)


def _validated(offered: Mapping[str, _Offered], call: ToolCall) -> tuple[ContractModel | None, str | None]:
    tool = offered.get(call.name)
    if tool is None:
        return None, "unknown_tool"
    if call.arguments is None:
        return None, "invalid_arguments: not a JSON object"
    try:
        return tool.declaration.arguments_model.model_validate(call.arguments), None
    except ValidationError as error:
        problems = "; ".join(f"{'.'.join(map(str, item['loc'])) or '<root>'}: {item['msg']}"
                             for item in error.errors())
        return None, f"invalid_arguments: {problems}"


def _finish(snapshot: AgentSnapshotV1, text: str, suggestions: SuggestRepliesArguments | None,
            handoff: Handoff | None, new_id: Callable[[], str], steps: int, usage: ModelUsage,
            domains: tuple[str, ...]) -> AgentTurn:
    blocks: list[TypedBlock] = []
    if (block := _text_block(new_id(), text, domains)) is not None:
        blocks.append(block)
    if not blocks and handoff is None:
        return _fallback(snapshot, "empty_reply", new_id, steps, usage)
    if suggestions is not None and handoff is None:  # the handoff block carries its own choices
        unique = {item.label: item.model_dump() for item in reversed(suggestions.items)}  # first label wins
        blocks.append(SuggestionsBlock(block_id=new_id(), type="suggestions", schema_version=1,
                                       items=list(reversed(unique.values()))))
    return AgentTurn(tuple(blocks), handoff=handoff, steps=steps, usage=usage)
