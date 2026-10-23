"""Engine-backed completion port: scorer -> selector cross-check -> summary.v1 projection -> evidence.

Runs outside any transaction (B-02 turn flow). Engine errors propagate to TurnHandler, which maps them;
nothing here touches the database, the clock or a provider.
"""
from uuid import uuid4

from agent_runtime.engine.exceptions import EngineError, UnsupportedDefinitionError
from agent_runtime.engine.projection import project_summary_v1
from agent_runtime.engine.services.scorer import ScoringEngine
from agent_runtime.sessions.schemas.result import ResultEvidence
from agent_runtime.sessions.schemas.turn_execution import CompletionBundle, CompletionContext

RULE_SLOTS = ("selection_rules", "scoring_rules", "coverage_rules", "tie_policy")


class EngineCompletionPort:
    def __init__(self, scorer: ScoringEngine | None = None):
        self.scorer = scorer or ScoringEngine()

    def prepare(self, context: CompletionContext) -> CompletionBundle:
        snapshot, selection = context.snapshot, context.selection
        release, activity = snapshot.release, snapshot.activity
        definition = release.content
        prefix = [{"question_id": answer.question_id, "option_id": answer.option_id} for answer in context.answers]
        scoring = self.scorer.calculate_scores(prefix, definition)
        if scoring.primary_house_id is None:
            # Legacy (v1) definitions report completion without a winning House: no card can be made.
            raise UnsupportedDefinitionError("definition completes without a primary house")
        if not scoring.is_complete or scoring.primary_house_id != selection.primary_house_id:
            raise EngineError("scorer and selector disagree on completion")
        house = next((h for h in definition.get("houses", ()) if h.get("house_id") == scoring.primary_house_id), None)
        if house is None:
            raise EngineError("winning house is missing from the pinned definition")
        result_id = uuid4().hex
        card, share = project_summary_v1(house=house, display_name=activity.state.display_name,
                                         is_demo=release.is_demo, result_id=result_id,
                                         result_revision=snapshot.next_result_revision, activity_id=activity.id)
        evidence = ResultEvidence(
            experience_release_id=release.release_id, definition_hash=release.content_hash,
            definition_id=definition["definition_id"], definition_version=definition["definition_version"],
            engine_version=release.engine_version, algorithm_profile=release.algorithm_profile,
            rule_refs={slot: definition[slot]["rule_schema_ref"] for slot in RULE_SLOTS}, scoring=scoring)
        return CompletionBundle(result_id=result_id, result_revision=snapshot.next_result_revision,
                                source_activity_revision=context.next_activity_revision, card=card, share=share,
                                evidence=evidence)
