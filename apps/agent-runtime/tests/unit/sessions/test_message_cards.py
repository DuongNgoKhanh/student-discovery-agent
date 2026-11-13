"""Message turns place server-built knowledge cards between the agent's lead-in and what follows it."""
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from agent_runtime.agent.knowledge_tools import with_cards
from agent_runtime.agent.loop import run_agent_turn
from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable, ToolCall
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.sessions.schemas.activity import KnowledgeCardBlock, SuggestionsBlock, TextBlock
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.turns import TurnService
from agent_runtime.tools.kit import Answered
from tests.helpers.toolbox import scripted_toolbox

ROOT = Path(__file__).resolve().parents[5]
AGENT = AgentSnapshotV1.model_validate(
    json.loads((ROOT / "contracts/fixtures/agent-snapshot-demo.json").read_text("utf-8")))
LEAD = TextBlock(block_id="t1", type="text", schema_version=1, content="Đây nhé")
CHIPS = SuggestionsBlock(block_id="s1", type="suggestions", schema_version=1,
                         items=[{"label": "Thêm", "message_text": "Thêm"}])
CARD = KnowledgeCardBlock(block_id="c1", type="knowledge_card", schema_version=1, title="Trường A",
                          fields=[{"label": "Học phí", "value": "25 triệu"}], document_id="a", revision=1,
                          updated_at="2026-10-27T03:00:00Z")


def test_cards_follow_the_lead_in_and_precede_suggestions():
    assert with_cards((LEAD, CHIPS), (CARD,)) == (LEAD, CARD, CHIPS)
    assert with_cards((LEAD,), (CARD,)) == (LEAD, CARD)


def test_cards_are_dropped_when_the_turn_fell_back_to_templates():
    toolbox, _ = scripted_toolbox(AGENT, {"knowledge.show": Answered({"shown": 1}, blocks=(CARD,))})
    model = FakeModel(ModelReply(text="", tool_calls=(ToolCall("c1", "knowledge.show", {"refs": ["k1"]}),)),
                      ModelUnavailable("timeout"))
    turn = run_agent_turn(AGENT, model, toolbox, AgentContext(today=date(2026, 10, 27)), [], "học phí",
                          new_id=lambda: "b1")
    assert turn.fallback == "timeout" and turn.cards == ()


def test_unreadable_knowledge_fields_degrade_to_a_turn_without_fields(caplog):
    class BrokenPort:
        def fields(self, kb_ids):
            raise RuntimeError("no schema")

    service = TurnService(SimpleNamespace(uow=None, access=SimpleNamespace(clock=None)), None,
                          responses=SimpleNamespace(), knowledge=BrokenPort())
    assert service._fields(AGENT) == {}
    assert "knowledge fields unavailable: RuntimeError" in caplog.text
