"""Message turns place server-built knowledge cards between the agent's lead-in and what follows it."""
from types import SimpleNamespace

from agent_runtime.agent.catalog import KnowledgeSearchArguments, KnowledgeShowArguments
from agent_runtime.agent.loop import AgentTurn
from agent_runtime.sessions.schemas.activity import KnowledgeCardBlock, SuggestionsBlock, TextBlock
from agent_runtime.sessions.services.message_turns import SnapshotToolExecutor, plan_message_turn

LEAD = TextBlock(block_id="t1", type="text", schema_version=1, content="Đây nhé")
CHIPS = SuggestionsBlock(block_id="s1", type="suggestions", schema_version=1,
                         items=[{"label": "Thêm", "message_text": "Thêm"}])
CARD = KnowledgeCardBlock(block_id="c1", type="knowledge_card", schema_version=1, title="Trường A",
                          fields=[{"label": "Học phí", "value": "25 triệu"}], document_id="a", revision=1,
                          updated_at="2026-10-27T03:00:00Z")


def plan(turn):
    return plan_message_turn(None, turn, None, handler=None, persistence=None, cards=(CARD,))


def test_cards_follow_the_lead_in_and_precede_suggestions():
    assert plan(AgentTurn((LEAD, CHIPS))).blocks == (LEAD, CARD, CHIPS)
    assert plan(AgentTurn((LEAD,))).blocks == (LEAD, CARD)


def test_cards_are_dropped_when_the_turn_fell_back_to_templates():
    assert plan(AgentTurn((LEAD, CHIPS), fallback="deadline")).blocks == (LEAD, CHIPS)


def test_executor_routes_knowledge_calls_and_reports_missing_knowledge():
    snapshot = SimpleNamespace(activity=None)
    search = KnowledgeSearchArguments(query="học phí")
    assert SnapshotToolExecutor(snapshot).execute("knowledge.search", search) == {"error": "knowledge_unavailable"}
    assert SnapshotToolExecutor(snapshot).cards() == ()
    tools = SimpleNamespace(search=lambda arguments: {"results": []}, show=lambda arguments: {"shown": 1},
                            cards=lambda: (CARD,))
    executor = SnapshotToolExecutor(snapshot, tools)
    assert executor.execute("knowledge.search", search) == {"results": []}
    assert executor.execute("knowledge.show", KnowledgeShowArguments(refs=("k1",))) == {"shown": 1}
    assert executor.cards() == (CARD,)


def test_unreadable_knowledge_fields_degrade_to_a_context_without_fields(caplog):
    import json
    from pathlib import Path

    from agent_runtime.agent.knowledge_tools import KnowledgeTools
    from agent_runtime.sessions.schemas.release import AgentSnapshotV1
    from agent_runtime.sessions.services.turns import TurnService

    root = Path(__file__).resolve().parents[5]
    agent = AgentSnapshotV1.model_validate(
        json.loads((root / "contracts/fixtures/agent-snapshot-demo.json").read_text("utf-8")))

    class BrokenPort:
        def fields(self, kb_ids):
            raise RuntimeError("no schema")

    service = TurnService(SimpleNamespace(uow=None, access=SimpleNamespace(clock=None)), None,
                          responses=SimpleNamespace(), knowledge=BrokenPort())
    context, tools = service._knowledge(agent)
    assert context.knowledge_fields == {}
    assert isinstance(tools, KnowledgeTools)
    assert "knowledge fields unavailable: RuntimeError" in caplog.text


def test_a_failing_knowledge_tool_becomes_an_error_result_not_a_failed_turn(caplog):
    def broken(arguments):
        raise KeyError("secret-detail")

    tools = SimpleNamespace(search=broken, show=broken, cards=lambda: ())
    executor = SnapshotToolExecutor(SimpleNamespace(activity=None), tools)
    assert executor.execute("knowledge.search", KnowledgeSearchArguments(query="học phí")) == {
        "error": "knowledge_unavailable"}
    assert executor.execute("knowledge.show", KnowledgeShowArguments(refs=("k1",))) == {
        "error": "knowledge_unavailable"}
    assert "KeyError" in caplog.text and "secret-detail" not in caplog.text
