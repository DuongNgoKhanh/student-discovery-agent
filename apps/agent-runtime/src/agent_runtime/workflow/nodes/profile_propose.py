import json
from typing import Annotated

from pydantic import Field

from agent_runtime.agent.model import SystemMessage, UserMessage
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.workflow.effects import ProfileProposal
from agent_runtime.workflow.nodes.base import NodeContext, NodeError, NodeResult, NodeSpec
from agent_runtime.workflow.nodes.model_support import invoke, node_settings
from agent_runtime.workflow.registry import register
from agent_runtime.workflow.templates import render


class ProfileProposeConfig(ContractModel):
    fields: Annotated[tuple[str, ...], Field(min_length=1, max_length=2)]
    target_step: str | None = None
    input: str = "{{sys.query}}"
    instructions: str = ""


def run(ctx: NodeContext, config: ProfileProposeConfig) -> NodeResult:
    text = render(config.input, ctx.scope.get)
    system = ("Trích giá trị hồ sơ của học sinh từ tin nhắn. Chỉ các trường: " + ", ".join(config.fields) +
              ". Trả về đúng một JSON object chỉ gồm các trường tìm thấy rõ ràng, không có thì trả {}. Không suy "
              "đoán." + (" " + config.instructions.strip() if config.instructions.strip() else ""))
    reply = invoke(ctx, [SystemMessage(system), UserMessage(text or "[Không có tin nhắn]")],
                   node_settings(ctx, temperature=0.0, max_output_tokens=200))
    try:
        found = json.loads(reply.text.strip().removeprefix("```json").removesuffix("```").strip())
    except ValueError:
        found = None
    if found is not None and not isinstance(found, dict):
        raise NodeError("invalid_output")
    wanted = {key: value for key, value in (found or {}).items() if key in config.fields}
    accepted = dict(ctx.ports.profile.accept(wanted)) if wanted else {}
    accepted = {key: value for key, value in accepted.items() if key in config.fields}
    if not accepted:
        return NodeResult("none", {"fields": []}, input=text)
    return NodeResult("proposed", {"proposal_id": ctx.new_id(), "fields": list(accepted)},
                      effects=(ProfileProposal(tuple(accepted.items()), config.target_step),), input=text,
                      reason={"fields": list(accepted)})


register(NodeSpec("profile_propose", ProfileProposeConfig, lambda config: ("proposed", "none", "error"),
                  {"type": "object", "properties": {"proposal_id": {"type": "string"},
                                                    "fields": {"type": "array", "items": {"type": "string"}}}}, run))
