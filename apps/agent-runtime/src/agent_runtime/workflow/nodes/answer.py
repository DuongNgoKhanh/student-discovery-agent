from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from agent_runtime.agent.loop import TextDelta, text_block
from agent_runtime.sessions.schemas.activity import SuggestionsBlock, TypedBlock
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.tools.knowledge import KnowledgeShowArguments
from agent_runtime.workflow.nodes.base import NodeContext, NodeResult, NodeSpec
from agent_runtime.workflow.registry import register
from agent_runtime.workflow.templates import render


class AnswerBlock(ContractModel):
    type: Literal["knowledge_card", "suggestions", "upstream"]
    ref: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}\.k[0-9]{1,3}$")] | None = None
    items: Annotated[tuple[Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")], ...],
                     Field(min_length=1, max_length=4)] | None = None

    @model_validator(mode="after")
    def shape(self) -> "AnswerBlock":
        if (self.type == "knowledge_card") != (self.ref is not None):
            raise ValueError("knowledge_card takes a ref (<node_id>.k1) and nothing else does")
        if (self.type == "suggestions") != (self.items is not None):
            raise ValueError("suggestions take items and nothing else does")
        return self


class AnswerConfig(ContractModel):
    text: str = ""
    blocks: tuple[AnswerBlock, ...] = ()


def _blocks(ctx: NodeContext, config: AnswerConfig) -> tuple[TypedBlock, ...]:
    blocks: list[TypedBlock] = []
    for spec in config.blocks:
        if spec.type == "upstream":
            blocks += [block for _, group in ctx.state.blocks_by_node for block in group]
        elif spec.type == "suggestions":
            labels = list(dict.fromkeys(spec.items))
            blocks.append(SuggestionsBlock(block_id=ctx.new_id(), type="suggestions", schema_version=1,
                                           items=[{"label": label, "message_text": label} for label in labels]))
        elif spec.type == "knowledge_card":
            blocks += _cards(ctx, spec.ref)
    return tuple(blocks)


def _cards(ctx: NodeContext, ref: str) -> list[TypedBlock]:
    node_id, _, short = ref.partition(".")
    tools = ctx.state.knowledge.get(node_id)
    if tools is None or "error" in tools.show(KnowledgeShowArguments(refs=(short,)), accumulate=True):
        return []  # the node did not run this turn, or the ref is not one of its results: no card, no error
    return list(tools.cards())


def run(ctx: NodeContext, config: AnswerConfig) -> NodeResult:
    text = render(config.text, ctx.scope.get).strip()
    domains = ctx.ports.agent.links.allowed_domains
    lead = text_block(ctx.new_id(), text, domains) if text else None
    streamed = {ctx.scope.get(f"{node}.text") for node in ctx.state.streamed}
    if text and text not in streamed:
        ctx.emit(TextDelta(text))
    blocks = ((lead,) if lead is not None else ()) + _blocks(ctx, config)
    return NodeResult(None, {"text": text}, blocks=blocks)


register(NodeSpec("answer", AnswerConfig, lambda config: (), {"type": "object", "properties": {"text": {"type": "string"}}},
                  run))
