"""B-03 acceptance over signed internal HTTP, real PostgreSQL and the production engine + completion port.

AT-07: two golden paths reach a valid card at the definition cap (12); extras never create a fake result.
AT-13: stored evidence traces every contribution to its answer, rule and version.
AT-20 (partial): the pure engine and the runtime API agree on question order, scores and House.
"""
import copy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from agent_runtime.engine.exceptions import MissingMappingError
from agent_runtime.engine.services.scorer import calculate_scores
from agent_runtime.engine.services.selector import AdaptiveQuestionSelector
from agent_runtime.evaluations.services.validator import ExperienceValidator
from agent_runtime.infrastructure.db.tables import result_snapshots
from agent_runtime.main import create_app
from agent_runtime.sessions.services.completion import EngineCompletionPort
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from tests.helpers.turns import build_turn_rig, current_state, post_turn, request_for, signed_call, turn_container
from tests.helpers.turns import turn_counts

pytestmark = pytest.mark.integration

PRIVATE_KEYS = ("evidence", "scoring", "contributions", "house_scores", "mean", "lower", "upper", "rating")


class CapturingSink:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)


class FailingScorer:
    def calculate_scores(self, answers, definition):
        raise MissingMappingError("synthetic scorer failure")


@pytest.fixture
def capped_definition(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    doc["coverage_rules"]["payload"]["max_total"] = 12
    return doc


@pytest.fixture
def completion_http(test_database, capped_definition):
    """Production validator, default engine registry and the real completion port; only the DB is a test one."""
    rig = build_turn_rig(test_database.url, capped_definition, ExperienceValidator())
    rig.handler = TurnHandler(PinnedAssessmentEngine(), EngineCompletionPort())
    sink = CapturingSink()
    try:
        with TestClient(create_app(turn_container(rig, trace_sink=sink))) as client:
            yield client, rig, sink
    finally:
        rig.db_engine.dispose()


def favour(code):
    return lambda question_id: f"{question_id}_opt_{5 if question_id.startswith(f'q_{code}_') else 1}"


def neutral(question_id):
    return f"{question_id}_opt_3"


def answer(client, rig, choose, *, key, expected_status=200):
    question_id = current_state(rig)[2]["current_question"]["question_id"]
    option = choose(question_id)
    response = post_turn(client, rig, request_for(rig, "submit_answer", key=key, option_id=option))
    assert response.status_code == expected_status, response.json()
    return response, {"question_id": question_id, "option_id": option}


def name(client, rig):
    assert post_turn(client, rig, request_for(rig, "set_name", key="name")).status_code == 200


def run_answers(client, rig, choose, count):
    sent, response = [], None
    for step in range(1, count + 1):
        response, sent_answer = answer(client, rig, choose, key=f"answer-{step}")
        sent.append(sent_answer)
    return response, sent


def stored_result(rig):
    with rig.uow.begin() as session:
        return session.execute(select(result_snapshots)).mappings().one()


def assert_no_private_fields(value):
    text = str(value)
    assert not any(f"'{key}'" in text for key in PRIVATE_KEYS), text


@pytest.mark.parametrize("code, house_id", [("r", "house_r"), ("s", "house_s")])
def test_golden_path_reaches_a_valid_card_at_the_cap(completion_http, capped_definition, code, house_id):
    client, rig, sink = completion_http
    name(client, rig)
    response, sent = run_answers(client, rig, favour(code), 12)
    data = response.json()["data"]
    activity, block = data["activity"], data["blocks"][0]
    assert activity["status"] == "completed" and len(activity["answers"]) == 12
    assert activity["progress"] == {"completed": 12, "min_total": 12, "max_total": 12, "total": 12,
                                    "phase": "completed"}
    assert block["type"] == "personality_card" and block["data"]["house"]["house_id"] == house_id
    assert block["data"]["display_name"] == "Ngân" and block["data"]["is_demo"] is True

    result = signed_call(client, rig, "GET", f"/activities/{rig.activity_id}/result").json()["data"]
    assert (result["result_id"], result["data"]) == (block["result_id"], block["data"])
    share = signed_call(client, rig, "GET", f"/results/{result['result_id']}/share-card").json()["data"]
    assert share["house"]["house_id"] == house_id and share["template_ref"] == "share_summary_v1"
    assert share["branding"] == {"brand_ref": "ihrd", "label": "IHRD"} and share["demo_label"]
    for public in (data, result, share):
        assert_no_private_fields(public)

    row = stored_result(rig)
    assert row["evidence"]["scoring"] == calculate_scores(sent, capped_definition).model_dump(mode="json")
    assert row["evidence"]["scoring"]["primary_house_id"] == house_id
    final = sink.events[-1]
    assert (final.outcome, final.result_id, final.activity_id) == ("success", result["result_id"], rig.activity_id)


def test_eleven_answers_never_produce_a_result(completion_http):
    client, rig, _ = completion_http
    name(client, rig)
    response, _ = run_answers(client, rig, favour("r"), 11)
    assert response.json()["data"]["activity"]["status"] == "in_progress"
    assert turn_counts(rig)["results"] == 0
    read = signed_call(client, rig, "GET", f"/activities/{rig.activity_id}/result")
    assert read.status_code == 422 and read.json()["error"]["code"] == "RES_RESULT_NOT_READY"


def test_answer_after_completion_is_rejected_without_side_effects(completion_http):
    client, rig, _ = completion_http
    name(client, rig)
    last, sent = run_answers(client, rig, favour("r"), 12)
    before = turn_counts(rig)
    question_id = sent[-1]["question_id"]
    payload = request_for(rig, "set_name", key="late").model_dump(mode="json", exclude_unset=True)
    payload |= {"action": "submit_answer", "payload": {"question_id": question_id,
                                                       "option_id": f"{question_id}_opt_1"}}
    late = post_turn(client, rig, payload)
    assert late.status_code == 422 and late.json()["error"]["code"] == "VAL_INVALID_ACTIVITY_TRANSITION"
    assert turn_counts(rig) == before and before["results"] == 1 and before["answers"] == 12


def test_scorer_failure_leaves_no_partial_completion_and_retry_succeeds(completion_http):
    client, rig, _ = completion_http
    name(client, rig)
    run_answers(client, rig, favour("s"), 11)
    question_id = current_state(rig)[2]["current_question"]["question_id"]
    request = request_for(rig, "submit_answer", key="final", option_id=favour("s")(question_id))
    before = turn_counts(rig)
    broken = TurnHandler(PinnedAssessmentEngine(), EngineCompletionPort(FailingScorer()))
    with TestClient(create_app(turn_container(rig, handler=broken))) as failing:
        failed = post_turn(failing, rig, request)
    assert failed.status_code == 422 and failed.json()["error"]["code"] == "SYS_ENGINE_FAILURE"
    assert turn_counts(rig) == before and current_state(rig)[2]["status"] == "in_progress"

    with TestClient(create_app(turn_container(rig))) as healthy:
        done = post_turn(healthy, rig, request)  # same key/payload once the engine is healthy
    assert done.status_code == 200 and done.json()["data"]["activity"]["status"] == "completed"
    assert turn_counts(rig)["results"] == 1


def test_evidence_traces_contributions_and_matches_the_pure_engine(completion_http, capped_definition):
    client, rig, _ = completion_http
    name(client, rig)
    _, sent = run_answers(client, rig, neutral, 12)
    selector = AdaptiveQuestionSelector()
    for index, item in enumerate(sent):  # AT-20: identical question order outside the runtime
        pure = selector.select_next_question(sent[:index], definition=capped_definition, validate_sequence=True)
        assert pure.next_question_id == item["question_id"]
    final = selector.select_next_question(sent, definition=capped_definition, validate_sequence=True)

    evidence = stored_result(rig)["evidence"]
    scoring = evidence["scoring"]
    assert scoring == calculate_scores(sent, capped_definition).model_dump(mode="json")
    assert (scoring["primary_house_id"], scoring["tie_applied"], scoring["stopping_reason"]) == (
        final.primary_house_id, True, "question_limit")
    assert [(c["ordinal"], c["question_id"], c["option_id"]) for c in scoring["all_contributions"]] == [
        (i, a["question_id"], a["option_id"]) for i, a in enumerate(sent, start=1)]
    assert evidence["engine_version"] == "career-assessment-v1"
    assert evidence["rule_refs"]["scoring_rules"] == capped_definition["scoring_rules"]["rule_schema_ref"]
