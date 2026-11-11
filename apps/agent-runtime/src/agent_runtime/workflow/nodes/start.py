from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.workflow.nodes.base import NodeResult, NodeSpec
from agent_runtime.workflow.registry import register


class StartConfig(ContractModel):
    pass


register(NodeSpec("start", StartConfig, lambda config: ("next",), {"type": "object", "properties": {}},
                  lambda ctx, config: NodeResult("next")))
