import itertools
import json
from datetime import date
from pathlib import Path

import agent_runtime.workflow.nodes  # noqa: F401  (registers every node type)
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.workflow import Workflow, WorkflowNode
from agent_runtime.workflow import registry
from agent_runtime.workflow.budget import Budget, BudgetedModel
from agent_runtime.workflow.nodes.base import NodeContext, RunState
from agent_runtime.workflow.ports import Ports
from agent_runtime.workflow.scope import Scope

FIXTURES = Path(__file__).resolve().parents[5] / "contracts/fixtures"
DEMO = json.loads((FIXTURES / "agent-snapshot-demo.json").read_text(encoding="utf-8"))
MIN = json.loads((FIXTURES / "agent-snapshot-chatflow-min.json").read_text(encoding="utf-8"))


def agent(**changes):
    return AgentSnapshotV1.model_validate({**DEMO, **changes})


def ids():
    counter = itertools.count(1)
    return lambda: f"b{next(counter)}"


def workflow(nodes, edges, variables=(), **budget):
    return Workflow.model_validate({"entry": nodes[0]["id"], "variables": list(variables), "nodes": nodes,
                                    "edges": [{"id": f"e{i}", "source": s, "source_handle": h, "target": t}
                                              for i, (s, h, t) in enumerate(edges)], "budget": budget})


def scope_for(wf, *, query="xin chào", conv=None, profile=None, result=None, outcome="none"):
    return Scope(sys={"query": query, "interaction": None, "interaction_outcome": outcome, "turn_index": 0,
                      "client_blocks": [], "activity_status": None},
                 conv=conv or {}, profile=profile or {}, result=result, variables=wf.variables)


def ports_for(**changes):
    return Ports(agent=changes.pop("snapshot", agent()), **changes)


def budget_for(wf, **kwargs):
    return Budget(wf.budget, **kwargs)


def run_node(node_dict, wf=None, *, model=None, scope=None, state=None, **ports_args):
    """Run one node in isolation; returns (spec, result, scope, emitted events)."""
    node = WorkflowNode.model_validate(node_dict)
    wf = wf or workflow([node_dict], [])
    spec = registry.get(node.type)
    config = spec.config_model.model_validate(node.config)
    scope = scope or scope_for(wf)
    budget = budget_for(wf)
    emitted = []
    ports_args.setdefault("agent_context", AgentContext(today=date(2026, 11, 10)))
    ctx = NodeContext(node=node, scope=scope, ports=ports_for(**ports_args),
                      model=BudgetedModel(model, budget) if model else None, budget=budget,
                      state=state or RunState(), new_id=ids(), emit=emitted.append, should_stop=lambda: False,
                      streaming=True)
    return spec, spec.run(ctx, config), scope, emitted
