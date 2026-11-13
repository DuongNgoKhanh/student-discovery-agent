"""One agent turn: the model proposes, code decides.

Tools are offered and called through the turn's Toolbox only; arguments are validated before any tool runs.
A handoff tool ends the model's turn: the server renders the next activity block (question, clarification, card),
so the model never authors assessment content. Model failures fall back to the snapshot templates.
"""
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal
from uuid import uuid4

from pydantic import ValidationError

from agent_runtime.agent.model import (
    AssistantMessage,
    ChatMessage,
    ModelPort,
    ModelUnavailable,
    ModelUsage,
    ToolResultMessage,
    UnavailableReason,
    UserMessage,
)
from agent_runtime.agent.output import sanitize_markdown
from agent_runtime.agent.prompt import AgentContext, system_messages
from agent_runtime.sessions.schemas.activity import (
    KnowledgeCardBlock,
    MarkdownBlock,
    SuggestionsBlock,
    TextBlock,
    TypedBlock,
)
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.blocks import markdown_to_text
from agent_runtime.tools.kit import Answered, HandedOff, Handoff, Replied
from agent_runtime.tools.ui import SuggestRepliesArguments

if TYPE_CHECKING:
    from agent_runtime.tools.toolbox import Toolbox

Fallback = UnavailableReason | Literal["max_tool_steps", "empty_reply", "deadline", "workflow_budget",
                                       "workflow_node_error"]
_BUSY = frozenset({"rate_limited", "timeout", "provider_error", "deadline", "workflow_budget",
                   "workflow_node_error"})


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolCallStarted:
    name: str


AgentEvent = TextDelta | ToolCallStarted


@dataclass(frozen=True)
class AgentTurn:
    blocks: tuple[TypedBlock, ...]  # agent-authored text and suggestions; the handoff block comes after them
    handoff: Handoff | None = None
    fallback: Fallback | None = None
    steps: int = 0
    usage: ModelUsage = ModelUsage()
    cancelled: bool = False
    cards: tuple[KnowledgeCardBlock, ...] = ()  # the last knowledge.show of this turn; placed by the caller


def text_block(block_id: str, text: str, allowed_domains: tuple[str, ...]) -> TypedBlock | None:
    clean = sanitize_markdown(text, allowed_domains)
    if not clean:
        return None
    try:
        return MarkdownBlock(block_id=block_id, type="markdown", schema_version=1, content=clean)
    except ValidationError:  # e.g. prose like "a<b": still worth showing, as plain text
        plain = markdown_to_text(clean).strip()
        return TextBlock(block_id=block_id, type="text", schema_version=1, content=plain) if plain else None


def fallback_blocks(snapshot: AgentSnapshotV1, reason: Fallback, new_id: Callable[[], str]) -> tuple[TypedBlock, ...]:
    templates = snapshot.templates
    # Only a reply the agent could not use means "not understood"; the rest are on our side and worth a retry.
    content = templates.busy_message if reason in _BUSY else templates.unknown_message
    blocks: list[TypedBlock] = [TextBlock(block_id=new_id(), type="text", schema_version=1, content=content)]
    if templates.fallback_suggestions:
        blocks.append(SuggestionsBlock(block_id=new_id(), type="suggestions", schema_version=1, items=[
            {"label": label, "message_text": label} for label in templates.fallback_suggestions]))
    return tuple(blocks)


def _fallback(snapshot: AgentSnapshotV1, reason: Fallback, new_id: Callable[[], str], steps: int,
              usage: ModelUsage) -> AgentTurn:
    return AgentTurn(fallback_blocks(snapshot, reason, new_id), fallback=reason, steps=steps, usage=usage)


def _add(usage: ModelUsage, more: ModelUsage) -> ModelUsage:
    return ModelUsage(usage.input_tokens + more.input_tokens, usage.output_tokens + more.output_tokens)


def run_agent_turn(snapshot: AgentSnapshotV1, model: ModelPort, toolbox: "Toolbox", context: AgentContext,
                   history: Sequence[ChatMessage], user_text: str, *,
                   new_id: Callable[[], str] = lambda: uuid4().hex,
                   on_event: Callable[[AgentEvent], None] | None = None,
                   should_stop: Callable[[], bool] | None = None,
                   deadline: float | None = None,
                   clock: Callable[[], float] = time.monotonic) -> AgentTurn:
    emit = on_event or (lambda event: None)
    stop = should_stop or (lambda: False)

    def sink(text: str) -> bool:
        emit(TextDelta(text))
        return not stop()

    def announce(name: str) -> None:
        emit(ToolCallStarted(name))

    usage = ModelUsage()
    if snapshot.model is None:
        return _fallback(snapshot, "not_configured", new_id, 0, usage)
    limits, domains = snapshot.limits, snapshot.links.allowed_domains
    names = {binding.name for binding in snapshot.tools}  # a node's view may narrow the release's tools
    recent = list(history)[-limits.history_messages:] if limits.history_messages else []
    messages: list[ChatMessage] = [*system_messages(snapshot, context), *recent,
                                   UserMessage(user_text[:limits.max_input_chars])]
    definitions = list(toolbox.offer(names))
    suggestions: SuggestRepliesArguments | None = None
    cards: tuple[KnowledgeCardBlock, ...] = ()
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
            outcome = toolbox.call(call.name, call.arguments, offered=names, announce=announce)
            if isinstance(outcome, HandedOff):
                handoff = outcome.handoff  # outcome.effects are not applied yet (no tool emits one; wired with effect-commit)
                break  # later calls in the same reply are dropped: the server owns what happens next
            if isinstance(outcome, Replied):
                suggestions = outcome.arguments
                result = {"shown": True}
            elif isinstance(outcome, Answered):
                if outcome.blocks is not None:  # a call that rendered nothing leaves the turn's cards alone
                    cards = outcome.blocks
                # outcome.effects are not applied yet: no tool emits one; wiring comes with the effect-commit work
                result = dict(outcome.result)
            else:  # Refused: a rejected call is an ordinary tool error; the model sees it and may recover
                result = dict(outcome.error)
            results.append(ToolResultMessage(call.id, call.name, result))
        if handoff is not None or not reply.tool_calls:
            return _finish(snapshot, reply.text if reply.text.strip() else lead_in, suggestions, handoff, new_id,
                           step, usage, domains, cards)
        if reply.text.strip():
            lead_in = reply.text
        messages += [AssistantMessage(reply.text or None, reply.tool_calls), *results]
    return _fallback(snapshot, "max_tool_steps", new_id, limits.max_tool_steps, usage)


def _finish(snapshot: AgentSnapshotV1, text: str, suggestions: SuggestRepliesArguments | None,
            handoff: Handoff | None, new_id: Callable[[], str], steps: int, usage: ModelUsage,
            domains: tuple[str, ...], cards: tuple[KnowledgeCardBlock, ...] = ()) -> AgentTurn:
    blocks: list[TypedBlock] = []
    if (block := text_block(new_id(), text, domains)) is not None:
        blocks.append(block)
    if not blocks and handoff is None:
        return _fallback(snapshot, "empty_reply", new_id, steps, usage)
    if suggestions is not None and handoff is None:  # the handoff block carries its own choices
        unique = {item.label: item.model_dump() for item in reversed(suggestions.items)}  # first label wins
        blocks.append(SuggestionsBlock(block_id=new_id(), type="suggestions", schema_version=1,
                                       items=list(reversed(unique.values()))))
    return AgentTurn(tuple(blocks), handoff=handoff, steps=steps, usage=usage, cards=cards)
