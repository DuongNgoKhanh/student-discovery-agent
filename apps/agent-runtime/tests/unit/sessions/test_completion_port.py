"""B-03: the real completion port (scorer -> cross-check -> summary.v1 -> evidence) and the question-cap guard."""
import copy

import pytest

from agent_runtime.engine.exceptions import MissingMappingError, UnsupportedDefinitionError
from agent_runtime.engine.projection import SUMMARY_V1_DEMO_LABEL, SUMMARY_V1_TEMPLATE_REF
from agent_runtime.engine.services.ordering import seeded_order
from agent_runtime.engine.services.scorer import calculate_scores
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.services.completion import EngineCompletionPort
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_input import parse_turn_input
from tests.helpers.turns import advance, interaction, make_turn_snapshot, turn_examples


def capped(doc, max_total=12):
    doc = copy.deepcopy(doc)
    doc["coverage_rules"]["payload"]["max_total"] = max_total
    return doc


def favour(house_code):
    """Rate the given house 5 and every other house 1."""
    return lambda question_id: f"{question_id}_opt_{5 if question_id.startswith(f'q_{house_code}_') else 1}"


def neutral(question_id):
    return f"{question_id}_opt_3"


def run(handler, doc, choose):
    """Drive name + option turns until completion; returns (last snapshot, final draft, answers sent)."""
    snapshot = make_turn_snapshot(doc)
    snapshot = advance(snapshot, handler.prepare(snapshot, parse_turn_input(turn_examples()["name_input"])))
    sent = []
    while True:
        question_id = snapshot.activity.state.current_question.question_id
        option = choose(question_id)
        payload = {"question_id": question_id, "option_id": option}
        draft = handler.prepare(snapshot, parse_turn_input(interaction(snapshot, "submit_answer", payload)))
        sent.append({"question_id": question_id, "option_id": option})
        if draft.next_state.status == "completed":
            return snapshot, draft, sent
        snapshot = advance(snapshot, draft)


def production_handler(port=None):
    return TurnHandler(PinnedAssessmentEngine(), port or EngineCompletionPort())


@pytest.mark.parametrize("code, house_id", [("r", "house_r"), ("s", "house_s")])
def test_golden_paths_complete_at_the_definition_cap(valid_v2_doc, code, house_id):
    doc = capped(valid_v2_doc)
    last, draft, sent = run(production_handler(), doc, favour(code))
    bundle = draft.completion
    assert len(sent) == 12 and draft.next_state.progress.model_dump() == {
        "completed": 12, "min_total": 12, "max_total": 12, "total": 12, "phase": "completed"}
    assert bundle.card.house.house_id == bundle.share.house.house_id == house_id
    assert (bundle.share.template_ref, bundle.share.demo_label) == (SUMMARY_V1_TEMPLATE_REF, SUMMARY_V1_DEMO_LABEL)
    expected = calculate_scores(sent, doc, seed=last.activity.id)
    assert bundle.evidence.scoring == expected and expected.primary_house_id == house_id
    assert bundle.evidence.scoring.stopping_reason.value == "question_limit"


def test_evidence_traces_every_answer_to_the_pinned_rules(valid_v2_doc):
    doc = capped(valid_v2_doc)
    last, draft, sent = run(production_handler(), doc, neutral)
    evidence = draft.completion.evidence
    contributions = evidence.scoring.all_contributions
    assert [(c.ordinal, c.question_id, c.option_id) for c in contributions] == [
        (i, a["question_id"], a["option_id"]) for i, a in enumerate(sent, start=1)]
    houses = [h["house_id"] for h in doc["houses"]]  # all neutral: the activity seed breaks the tie
    assert evidence.scoring.tie_applied
    assert evidence.scoring.primary_house_id == seeded_order(last.activity.id, "house", houses)[0]
    release = last.release
    assert (evidence.experience_release_id, evidence.definition_hash, evidence.engine_version) == (
        release.release_id, release.content_hash, "career-assessment-v1")
    assert evidence.rule_refs == {slot: doc[slot]["rule_schema_ref"]
                                  for slot in ("selection_rules", "scoring_rules", "coverage_rules", "tie_policy")}


def test_adaptive_bounded_stop_still_completes_below_the_cap(valid_v2_doc):
    _, draft, sent = run(production_handler(), valid_v2_doc, favour("r"))
    assert 12 <= len(sent) < 30 and draft.completion.evidence.scoring.stopping_reason.value == "bounded_winner"


class StubScorer:
    def __init__(self, outcome):
        self.outcome = outcome

    def calculate_scores(self, answers, definition, seed=None):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome(calculate_scores(answers, definition, seed=seed))


@pytest.mark.parametrize("outcome, status, code", [
    (lambda s: s.model_copy(update={"primary_house_id": "house_c"}), 422, "ENGINE_FAILURE"),
    (lambda s: s.model_copy(update={"is_complete": False}), 422, "ENGINE_FAILURE"),
    (lambda s: s.model_copy(update={"primary_house_id": None}), 422, "INCOMPATIBLE_SCHEMA"),
    (MissingMappingError("no metadata"), 422, "ENGINE_FAILURE"),
    (UnsupportedDefinitionError("legacy"), 422, "INCOMPATIBLE_SCHEMA"),
    (RuntimeError("boom"), 500, "INTERNAL_ERROR"),
])
def test_completion_failures_never_produce_a_card(valid_v2_doc, outcome, status, code):
    handler = production_handler(EngineCompletionPort(StubScorer(outcome)))
    with pytest.raises(RuntimeSessionError) as caught:
        run(handler, capped(valid_v2_doc), neutral)
    assert (caught.value.status, caught.value.code) == (status, code)


def test_incomplete_house_metadata_is_rejected_before_any_question(valid_v2_doc):
    """The pinned definition is validated on every selection, so a card can never be built from gaps."""
    doc = capped(valid_v2_doc)
    next(h for h in doc["houses"] if h["house_id"] == "house_r")["quote"] = ""
    snapshot = make_turn_snapshot(doc)
    with pytest.raises(RuntimeSessionError) as caught:
        production_handler().prepare(snapshot, parse_turn_input(turn_examples()["name_input"]))
    assert (caught.value.status, caught.value.code) == (422, "INCOMPATIBLE_SCHEMA")


def test_harness_guard_rejects_an_engine_that_runs_past_the_cap(valid_v2_doc):
    class NeverStops:
        """Reports the next baseline question even after the pinned cap is reached."""
        def __init__(self):
            self.inner = PinnedAssessmentEngine()

        def select(self, release, answers, seed):
            result = self.inner.select(release, answers, seed)
            if result.status.value != "completed":
                return result
            asked = {a.question_id for a in answers}
            spare = next(q["question_id"] for q in release.content["questions"] if q["question_id"] not in asked)
            progress = result.progress.model_copy(update={"total": None, "phase": "adaptive"})
            return result.model_copy(update={"status": "next_question", "next_question_id": spare,
                                             "primary_house_id": None, "stopping_reason": None,
                                             "progress": progress})

    handler = TurnHandler(NeverStops(), EngineCompletionPort())
    with pytest.raises(RuntimeSessionError) as caught:
        run(handler, capped(valid_v2_doc), neutral)
    assert (caught.value.status, caught.value.code) == (422, "ENGINE_FAILURE")


def test_production_registry_rejects_legacy_definitions_before_any_question(valid_v1_doc):
    """Definition 1.0 cannot produce a winning House, so it never starts on the default registry."""
    snapshot = make_turn_snapshot(valid_v1_doc)
    with pytest.raises(RuntimeSessionError) as caught:
        production_handler().prepare(snapshot, parse_turn_input(turn_examples()["name_input"]))
    assert (caught.value.status, caught.value.code) == (422, "INCOMPATIBLE_SCHEMA")
