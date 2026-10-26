"""Free-text message turns: the agent loop's handoffs drive the assessment through server-checked commits."""
import copy
import json
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select

from agent_runtime.agent.model import FakeModel, ModelReply, SystemMessage, ToolCall, UserMessage
from agent_runtime.evaluations.services.compatibility import PILOT_ENGINE_REGISTRY
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import messages
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import SupportedBlock
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.schemas.conversation import CreateConversationInput
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_input import parse_turn_input
from agent_runtime.sessions.services.turn_store import TurnStore
from agent_runtime.sessions.services.turns import TurnService
from tests.helpers.builders import adaptive_capabilities, agent_release, experience_release
from tests.helpers.clock import FakeClock
from tests.helpers.product import FakeProductReleaseSource
from tests.helpers.turns import NOW, PROFILE, FakeCompletionPort, biased_option

ROOT = Path(__file__).resolve().parents[4]
EXPERIENCE = "logical-experience"


def _agent_content():
    content = copy.deepcopy(json.loads((ROOT / "contracts/fixtures/agent-snapshot-demo.json").read_text("utf-8")))
    start = next(tool for tool in content["tools"] if tool["name"] == "assessment.start")
    start["params"]["experiences"][0]["experience_id"] = EXPERIENCE
    return content


def call(name, arguments):
    return ToolCall(id=f"call-{name}", name=name, arguments=arguments)


@pytest.fixture
def chat(test_database, valid_v2_doc, validator):
    upgrade_database(test_database.url)
    db_engine = build_engine(test_database.url)
    uow = RuntimeUnitOfWork(db_engine)
    clock = FakeClock(NOW)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(seconds=60))
    product = FakeProductReleaseSource()
    product.agent = agent_release(content=_agent_content())
    product.experiences[(EXPERIENCE, PROFILE)] = experience_release(valid_v2_doc)
    conversations = ConversationService(uow, product, validator, policy=RuntimePolicy(environment="demo"), clock=clock)
    blocks = [*adaptive_capabilities().supported_blocks, SupportedBlock(type="markdown", schema_versions=(1,)),
              SupportedBlock(type="suggestions", schema_versions=(1,))]
    created = conversations.create(caller, CreateConversationInput(idempotency_key="create",
        accepted_activity_profiles=(PROFILE,), supported_blocks=[block.model_dump() for block in blocks]))
    model = FakeModel()
    store = TurnStore(uow, ActivityPersistence(uow, product, validator, clock=clock), conversations, clock=clock)
    service = TurnService(store, TurnHandler(PinnedAssessmentEngine(PILOT_ENGINE_REGISTRY), FakeCompletionPort()),
                          models=lambda provider: model)
    conversation_id = created.data["conversation"]["id"]

    def send(text, *, revision, key):
        request = parse_turn_input({"type": "message", "content": {"text": text}, "expected_revision": revision,
                                    "idempotency_key": key})
        return service.submit(caller, conversation_id, request)

    def message_count():
        with uow.begin() as session:
            return session.scalar(select(func.count()).select_from(messages).where(
                messages.c.conversation_id == conversation_id))

    try:
        yield model, send, service, caller, conversation_id, message_count
    finally:
        db_engine.dispose()


def test_free_text_starts_names_and_proposes_through_server_rendered_blocks(chat):
    model, send, service, caller, conversation_id, message_count = chat
    shown = {}
    model._outcomes += [
        ModelReply(text="Bắt đầu nhé!", tool_calls=(call("assessment.start", {"experience_id": EXPERIENCE}),)),
        ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
        lambda messages: ModelReply(text="Mình hiểu rồi.", tool_calls=(
            call("assessment.propose_answer", {"option_id": shown["option"]}),)),
    ]

    started = send("mình muốn làm bài", revision=0, key="m1").data
    assert started["revision"] == 1 and started["activity"]["status"] == "collecting_name"
    assert [block["type"] for block in started["blocks"]] == ["markdown", "text"]

    named = send("Mình tên Ngân", revision=1, key="m2").data
    assert named["activity"]["status"] == "in_progress" and named["activity"]["display_name"] == "Ngân"
    (question,) = named["blocks"]
    assert question["type"] == "assessment_question"
    shown["option"] = question["options"][-1]["id"]

    proposed = send("khá thích", revision=2, key="m3").data
    assert [block["type"] for block in proposed["blocks"]] == ["markdown", "text", "assessment_question"]
    assert question["options"][-1]["label"] in proposed["blocks"][1]["content"]
    assert proposed["blocks"][2]["question_id"] == question["question_id"]
    assert proposed["activity"]["revision"] == named["activity"]["revision"]  # a proposal never answers
    phase = [m.text for m in model.calls[2][0] if isinstance(m, SystemMessage) and m.text.startswith("Trạng thái")]
    assert shown["option"] in phase[0]  # the model sees the current question's option ids
    assert UserMessage("Mình tên Ngân") in model.calls[2][0]  # committed history reaches the model

    answer = parse_turn_input({"type": "interaction", "activity_id": proposed["activity"]["id"],
        "action": "submit_answer", "expected_revision": 3, "idempotency_key": "a1",
        "payload": {"question_id": question["question_id"], "option_id": shown["option"]}})
    assert service.submit(caller, conversation_id, answer).data["activity"]["progress"]["completed"] == 1
    assert message_count() == 1 + 4 * 2


def test_message_replays_without_rerunning_the_model_and_rejects_stale_revisions(chat):
    model, send, _, _, _, message_count = chat
    model._outcomes.append(ModelReply(text="Chào bạn!"))
    first = send("xin chào", revision=0, key="hello")
    again = send("xin chào", revision=0, key="hello")
    assert again.data == first.data and len(model.calls) == 1
    with pytest.raises(RuntimeSessionError) as conflict:
        send("còn đó không", revision=0, key="stale")
    assert conflict.value.status == 409 and len(model.calls) == 1
    assert message_count() == 3


def test_rejected_handoff_leaves_state_unchanged(chat):
    model, send, *_ = chat
    model._outcomes += [ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
                        ModelReply(text="Bạn muốn làm bài khám phá không?")]
    data = send("mình tên Ngân", revision=0, key="early").data
    assert data["activity"] is None and [block["type"] for block in data["blocks"]] == ["markdown"]
    assert model.calls[1][0][-1].content["error"] == "not_collecting_name"


def test_completed_result_is_explained_from_the_stored_card(chat):
    model, send, service, caller, conversation_id, _ = chat
    model._outcomes += [
        ModelReply(text="", tool_calls=(call("assessment.start", {"experience_id": EXPERIENCE}),)),
        ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
    ]
    send("làm bài", revision=0, key="m1")
    data = send("Ngân", revision=1, key="m2").data
    while data["activity"]["status"] == "in_progress":
        question_id = data["activity"]["current_question"]["question_id"]
        data = service.submit(caller, conversation_id, parse_turn_input({"type": "interaction",
            "activity_id": data["activity"]["id"], "action": "submit_answer", "expected_revision": data["revision"],
            "idempotency_key": f"a-{data['revision']}",
            "payload": {"question_id": question_id, "option_id": biased_option(question_id)}})).data
    card = data["blocks"][0]["data"]
    model._outcomes += [ModelReply(text="", tool_calls=(call("result.explain", {}),)),
                        ModelReply(text="Bạn thuộc **" + card["house"]["name"] + "**.")]
    explained = send("giải thích thêm về card này đi", revision=data["revision"], key="explain").data
    assert model.calls[-1][0][-1].content["house"] == card["house"]["name"]
    assert explained["blocks"][0]["content"] == "Bạn thuộc **" + card["house"]["name"] + "**."
    assert explained["activity"]["status"] == "completed"
