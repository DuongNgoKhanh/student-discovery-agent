"""Name/option transitions with the real adaptive selector and an injected pilot registry."""
import pytest

from agent_runtime.engine.services.selector import AdaptiveQuestionSelector
from agent_runtime.evaluations.services.compatibility import PILOT_ENGINE_REGISTRY
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import ActivityClarification
from agent_runtime.sessions.services.turn_handlers import MAX_COUNTER, PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_input import parse_turn_input
from tests.helpers.turns import (
    FakeCompletionPort,
    advance,
    biased_option,
    interaction,
    make_turn_snapshot,
    turn_examples,
)
from tests.unit.conftest import with_engine


@pytest.fixture
def handler():
    return TurnHandler(PinnedAssessmentEngine(PILOT_ENGINE_REGISTRY))


def _error(call, status, code):
    with pytest.raises(RuntimeSessionError) as error:
        call()
    assert (error.value.status, error.value.code) == (status, code)


def _named(handler, definition):
    snapshot = make_turn_snapshot(definition)
    draft = handler.prepare(snapshot, parse_turn_input(interaction(snapshot, "set_name", {"display_name": "Ngân"})))
    return advance(snapshot, draft)


def _option(snapshot, option_id, question_id=None):
    question_id = question_id or snapshot.activity.state.current_question.question_id
    return parse_turn_input(interaction(snapshot, "submit_answer",
                                        {"question_id": question_id, "option_id": option_id}))


def test_set_name_uses_first_pinned_question(handler, valid_v2_doc):
    snapshot = make_turn_snapshot(valid_v2_doc)
    draft = handler.prepare(snapshot, parse_turn_input(turn_examples()["name_input"]))
    assert draft.next_state.status == "in_progress"
    assert draft.next_state.display_name == "Ngân"
    assert draft.next_state.progress.completed == 0
    assert draft.completion is None
    seen = []

    class Recording(PinnedAssessmentEngine):
        def select(self, release, answers, seed):
            seen.append(seed)
            return super().select(release, answers, seed)

    TurnHandler(Recording(handler.engine.registry)).prepare(snapshot, parse_turn_input(turn_examples()["name_input"]))
    assert seen == [snapshot.activity.id]  # the activity id seeds this activity's order
    definition = AdaptiveQuestionSelector._coerce_definition(valid_v2_doc)
    first = AdaptiveQuestionSelector._baseline_sequence(definition, snapshot.activity.id)[0]
    pinned = next(q for q in valid_v2_doc["questions"] if q["question_id"] == first)
    question = draft.next_state.current_question
    assert question.question_id == first and question.title == pinned["prompt"]
    assert [(o.id, o.label) for o in question.options] == [(c["option_id"], c["label"]) for c in pinned["choices"]]
    assert snapshot.activity.state.status == "collecting_name"  # snapshot is never mutated


def test_option_extends_prefix_once(handler, valid_v2_doc):
    snapshot = _named(handler, valid_v2_doc)
    current = snapshot.activity.state.current_question
    draft = handler.prepare(snapshot, _option(snapshot, f"{current.question_id}_opt_3"))
    (answer,) = draft.next_state.answers
    assert (answer.source, answer.ordinal, answer.accepted_activity_revision) == ("option", 1, 2)
    assert answer.question == current
    assert draft.next_state.progress.completed == 1 and draft.next_state.progress.total is None
    assert draft.next_state.current_question.question_id != current.question_id


def test_option_clears_pending_proposal(handler, valid_v2_doc):
    snapshot = _named(handler, valid_v2_doc)
    current = snapshot.activity.state.current_question
    proposal = ActivityClarification.model_validate({"proposal_id": "prop", "question_id": current.question_id, "activity_revision": 1,
                "title": "Confirm", "candidates": [{"id": "c1", "option_id": current.options[0].id, "label": "One"}]})
    state = snapshot.activity.state.model_copy(update={"clarification": proposal})
    snapshot = snapshot.model_copy(update={"activity": snapshot.activity.model_copy(update={"state": state})})
    draft = handler.prepare(snapshot, _option(snapshot, current.options[1].id))
    assert draft.next_state.clarification is None


@pytest.mark.parametrize("case,status,code", [
    ("name_twice", 422, "INVALID_ACTIVITY_TRANSITION"),
    ("answer_before_name", 422, "INVALID_ACTIVITY_TRANSITION"),
    ("other_question", 422, "INVALID_QUESTION"),
    ("foreign_option", 422, "INVALID_OPTION"),
    ("invalid_name", 422, "INVALID_INPUT"),
])
def test_rejects_wrong_state_question_option(handler, valid_v2_doc, case, status, code):
    fresh = make_turn_snapshot(valid_v2_doc)
    named = _named(handler, valid_v2_doc)
    current = named.activity.state.current_question
    request = {
        "name_twice": (named, parse_turn_input(interaction(named, "set_name", {"display_name": "Lan"}))),
        "answer_before_name": (fresh, _option(fresh, "q_r_01_opt_3", "q_r_01")),
        "other_question": (named, _option(named, "q_c_05_opt_3", "q_c_05")),
        "foreign_option": (named, _option(named, "q_c_05_opt_3", current.question_id)),
        "invalid_name": (fresh, parse_turn_input(interaction(fresh, "set_name", {"display_name": "<b>Lan</b>"}))),
    }[case]
    _error(lambda: handler.prepare(*request), status, code)


def test_default_registry_runs_production_engine_and_rejects_others(valid_v2_doc):
    request = parse_turn_input(turn_examples()["name_input"])
    draft = TurnHandler(PinnedAssessmentEngine()).prepare(make_turn_snapshot(valid_v2_doc), request)
    assert draft.next_state.status == "in_progress"
    snapshot = make_turn_snapshot(with_engine(valid_v2_doc, "2.0.0"))
    _error(lambda: TurnHandler(PinnedAssessmentEngine()).prepare(snapshot, request), 422, "INCOMPATIBLE_SCHEMA")


def test_malformed_engine_output_is_engine_failure(valid_v2_doc):
    class StaleEngine:
        def select(self, release, answers, seed):
            result = PinnedAssessmentEngine(PILOT_ENGINE_REGISTRY).select(release, answers, seed)
            return result.model_copy(update={"next_question_id": "q_missing"})

    snapshot = make_turn_snapshot(valid_v2_doc)
    request = parse_turn_input(turn_examples()["name_input"])
    _error(lambda: TurnHandler(StaleEngine()).prepare(snapshot, request), 422, "ENGINE_FAILURE")


def test_counter_overflow_rejected_before_engine(valid_v2_doc):
    class ExplodingEngine:
        def select(self, release, answers, seed):
            raise AssertionError("engine must not run")

    snapshot = make_turn_snapshot(valid_v2_doc)
    snapshot = snapshot.model_copy(update={"parent": snapshot.parent.model_copy(update={"revision": MAX_COUNTER})})
    request = parse_turn_input(turn_examples()["name_input"])
    _error(lambda: TurnHandler(ExplodingEngine()).prepare(snapshot, request), 500, "INTERNAL_ERROR")


def _run_to_completion(handler, snapshot):
    while True:
        option = biased_option(snapshot.activity.state.current_question.question_id)
        draft = handler.prepare(snapshot, _option(snapshot, option))
        if draft.next_state.status == "completed":
            return snapshot, draft
        snapshot = advance(snapshot, draft)


def test_terminal_without_completion_port_is_unavailable(handler, valid_v2_doc):
    port = FakeCompletionPort()
    last, done = _run_to_completion(TurnHandler(handler.engine, port), _named(handler, valid_v2_doc))
    assert port.calls == 1 and done.completion is not None
    assert done.next_state.progress.total == done.next_state.progress.completed < 30  # adaptive, not hardcoded
    assert done.next_state.current_result_id == done.completion.result_id
    request = _option(last, biased_option(last.activity.state.current_question.question_id))
    with pytest.raises(RuntimeSessionError) as caught:
        handler.prepare(last, request)
    assert (caught.value.status, caught.value.code) == (503, "SERVICE_UNAVAILABLE")
    assert caught.value.details == {"kind": "not_configured"}


@pytest.mark.parametrize("mutate", [
    lambda b: b["card"]["house"].update(house_id="house_c", name="house_c"),
    lambda b: b["card"]["house"].update(name="Forged"),
    lambda b: b["card"].update(display_name="Other"),
    lambda b: b.update(result_revision=2),
    lambda b: b.update(source_activity_revision=1),
    lambda b: b["share"].update(activity_id="other"),
])
def test_invalid_completion_bundle_is_internal_error(handler, valid_v2_doc, mutate):
    last, _ = _run_to_completion(TurnHandler(handler.engine, FakeCompletionPort()), _named(handler, valid_v2_doc))
    forged = TurnHandler(handler.engine, FakeCompletionPort(mutate))
    request = _option(last, biased_option(last.activity.state.current_question.question_id))
    _error(lambda: forged.prepare(last, request), 500, "INTERNAL_ERROR")
