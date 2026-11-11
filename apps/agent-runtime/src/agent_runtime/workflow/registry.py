from typing import TYPE_CHECKING

if TYPE_CHECKING:  # nodes import this module to register themselves; a runtime import here would be circular
    from agent_runtime.workflow.nodes.base import NodeSpec

REGISTRY: dict[str, "NodeSpec"] = {}


def register(spec: "NodeSpec") -> "NodeSpec":
    REGISTRY[spec.type] = spec
    return spec


def get(node_type: str) -> "NodeSpec":
    return REGISTRY[node_type]
