from typing import Annotated, Any

from pydantic import Field, StringConstraints, ValidationError

from agent_runtime.agent.catalog import KnowledgeSearchArguments, KnowledgeSearchParams
from agent_runtime.agent.knowledge_tools import KnowledgeTools
from agent_runtime.knowledge.schemas import Condition, FieldName, MetadataCondition
from agent_runtime.sessions.schemas.common import ContractModel, OpaqueId
from agent_runtime.workflow.effects import KbRefsUsed
from agent_runtime.workflow.expressions import PATH
from agent_runtime.workflow.nodes.base import NodeContext, NodeError, NodeResult, NodeSpec
from agent_runtime.workflow.registry import register
from agent_runtime.workflow.templates import render

_OPERATOR = {"string_list": "contains", "string": "is", "number": "=", "time": "is"}
_UNAVAILABLE = {"knowledge_unavailable", "knowledge_base_unavailable"}


class KnowledgeRetrievalConfig(ContractModel):
    knowledge_base_id: OpaqueId = Field(json_schema_extra={"x-widget": "kb_picker"})
    query: Annotated[str, StringConstraints(min_length=1)]
    fixed_filter: MetadataCondition | None = None
    filter_from_vars: dict[FieldName, Annotated[str, StringConstraints(pattern=PATH.pattern)]] = Field(
        default_factory=dict, max_length=10)
    top_k: Annotated[int, Field(strict=True, ge=1, le=8)] = 5


def _filter(ctx: NodeContext, config: KnowledgeRetrievalConfig, types: dict[str, str]) -> MetadataCondition | None:
    conditions = []
    for field, path in config.filter_from_vars.items():
        value = ctx.scope.get(path)
        if value is None or value == "":
            continue  # an unknown variable never narrows the search
        kind = types.get(field)
        if kind is None and not types:
            raise NodeError("kb_unavailable")  # the field read failed: the filter cannot be checked, not misconfigured
        if kind is None or isinstance(value, bool | list | dict):
            raise NodeError("invalid_output")
        conditions.append(Condition(name=field, comparison_operator=_OPERATOR[kind], value=value))
    return MetadataCondition(logical_operator="and", conditions=tuple(conditions)) if conditions else None


def run(ctx: NodeContext, config: KnowledgeRetrievalConfig) -> NodeResult:
    ports = ctx.ports
    fields = ports.knowledge_fields.get(config.knowledge_base_id, ())
    query = render(config.query, ctx.scope.get).strip()[:300]
    if not query:
        return NodeResult("empty", {"refs": [], "chunks": []}, input=query)
    try:  # a ValidationError escaping a node is an unexpected error: it must surface as a typed NodeError instead
        params = KnowledgeSearchParams(knowledge_base_id=config.knowledge_base_id, top_k=config.top_k,
                                       fixed_filter=config.fixed_filter,
                                       auto_filter_fields=tuple(config.filter_from_vars))
        arguments = KnowledgeSearchArguments(
            query=query, filter=_filter(ctx, config, {field.name: field.type for field in fields}))
    except ValidationError as error:
        raise NodeError("invalid_output") from error
    tools = KnowledgeTools(ports.knowledge, params, ports.show_params, fields,
                           allowed_domains=ports.agent.links.allowed_domains, new_id=ctx.new_id, clock=ctx.budget.clock)
    ctx.state.knowledge[ctx.node.id] = tools
    result = tools.search(arguments)
    if "error" in result:
        raise NodeError("kb_unavailable" if result["error"] in _UNAVAILABLE else "invalid_output")
    chunks: list[dict[str, Any]] = result["results"]
    refs = tuple(chunk["ref"] for chunk in chunks)
    if not refs:
        return NodeResult("empty", {"refs": [], "chunks": []}, input=query)
    return NodeResult("found", {"refs": list(refs), "chunks": chunks},
                      effects=(KbRefsUsed(config.knowledge_base_id, refs),),
                      refs=tuple(f"{ctx.node.id}.{ref}" for ref in refs), input=query,
                      reason={"degraded": result["degraded"]})


register(NodeSpec("knowledge_retrieval", KnowledgeRetrievalConfig, lambda config: ("found", "empty", "error"),
                  {"type": "object", "properties": {"refs": {"type": "array", "items": {"type": "string"}},
                                                    "chunks": {"type": "array", "items": {"type": "object"}}}}, run))
