import itertools
import json
from pathlib import Path

from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.workflow import Workflow
from agent_runtime.workflow.budget import Budget
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
