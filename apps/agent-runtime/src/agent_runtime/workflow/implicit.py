"""The graph ``mode = agent`` runs: start -> agent -> answer."""
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.workflow import Workflow, WorkflowBudget, WorkflowEdge, WorkflowNode
from agent_runtime.workflow.nodes.agent import ALL_TOOLS


def implicit_workflow(agent: AgentSnapshotV1) -> Workflow:
    """start -> agent (every enabled tool) -> answer: what ``mode = agent`` has always done (FR-WFL-01)."""
    return Workflow(
        entry="start",
        nodes=(WorkflowNode(id="start", type="start"),
               WorkflowNode(id="agent", type="agent", config={"tools": list(ALL_TOOLS)}),
               WorkflowNode(id="answer", type="answer", config={"blocks": [{"type": "upstream"}]})),
        edges=(WorkflowEdge(id="e1", source="start", source_handle="next", target="agent"),
               WorkflowEdge(id="e2", source="agent", source_handle="success", target="answer"),
               WorkflowEdge(id="e3", source="agent", source_handle="handoff", target="answer")),
        budget=WorkflowBudget(max_nodes=3, max_llm_calls=agent.limits.max_tool_steps,
                              turn_timeout_ms=agent.limits.turn_timeout_ms))
