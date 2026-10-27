"""Pure name/option transitions over the pinned release. No DB, Product or LLM; runs outside transactions."""
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from agent_runtime.engine.exceptions import EngineError, UnsupportedDefinitionError
from agent_runtime.engine.schemas.selector import SelectionResult, SelectionStatus
from agent_runtime.engine.services.selector import AdaptiveQuestionSelector
from agent_runtime.evaluations.services.compatibility import DEFAULT_ENGINE_REGISTRY, EngineProfile
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.ports import AssessmentEngine, CompletionPort
from agent_runtime.sessions.schemas.activity import ActivityAnswer, ActivityState, AssessmentQuestion
from agent_runtime.sessions.schemas.common import JsonObject
from agent_runtime.sessions.schemas.release import ValidatedRelease
from agent_runtime.sessions.schemas.turn import SetNameInteraction, SupportedInteraction
from agent_runtime.sessions.schemas.turn_execution import CompletionBundle, CompletionContext, TurnDraft, TurnSnapshot
from agent_runtime.sessions.services.turn_input import validate_display_name

MAX_COUNTER = 9007199254740991
_STATE = TypeAdapter(ActivityState)


def _engine_failure():
    return RuntimeSessionError(422, "ENGINE_FAILURE")


class PinnedAssessmentEngine:
    """Selects from the persisted pin with an explicitly configured engine registry."""

    def __init__(self, registry: dict[str, EngineProfile] | None = None):
        # Production registers the C-02/C-03 engine; tests/pilots may inject theirs.
        self.registry = registry if registry is not None else DEFAULT_ENGINE_REGISTRY

    def select(self, release: ValidatedRelease, answers: tuple[ActivityAnswer, ...], seed: str) -> SelectionResult:
        profile = self.registry.get(release.engine_version)
        if profile is None or release.definition_schema_version not in profile.supported_schema_versions:
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA")
        prefix = [{"question_id": answer.question_id, "option_id": answer.option_id} for answer in answers]
        try:
            # Ratings come from the pinned definition, never from client or stored answers.
            result = AdaptiveQuestionSelector().select_next_question(
                prefix, definition=release.content, validate_sequence=True, seed=seed)
            return SelectionResult.model_validate(result.model_dump())
        except UnsupportedDefinitionError:
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA") from None
        except (EngineError, ValidationError):
            raise _engine_failure() from None
        except Exception:
            raise RuntimeSessionError(500, "INTERNAL_ERROR") from None


def _question_cap(release: ValidatedRelease) -> int:
    """Hard cap from the pinned definition, independent of what the engine reports."""
    payload = (release.content.get("coverage_rules") or {}).get("payload") or {}
    cap = payload.get("max_total", payload.get("required_question_count"))
    if not isinstance(cap, int) or isinstance(cap, bool) or cap < 1:
        raise _engine_failure()
    return cap


def _prepare_completion(port: CompletionPort, context: CompletionContext) -> CompletionBundle:
    """Same failure mapping as selection: completion never commits a partial or invented card."""
    try:
        return port.prepare(context)
    except RuntimeSessionError:
        raise
    except UnsupportedDefinitionError:
        raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA") from None
    except (EngineError, ValidationError):
        raise _engine_failure() from None
    except Exception:
        raise RuntimeSessionError(500, "INTERNAL_ERROR") from None


def _definition_question(release: ValidatedRelease, question_id: str) -> JsonObject | None:
    return next((q for q in release.content.get("questions", ()) if q.get("question_id") == question_id), None)


def _view_question(question: JsonObject | None) -> AssessmentQuestion:
    """Display content comes verbatim from the pinned definition: prompt -> title, choices -> options."""
    try:
        return AssessmentQuestion(question_id=question["question_id"], title=question["prompt"], options=tuple(
            {"id": choice["option_id"], "label": choice["label"]} for choice in question["choices"]))
    except (ValidationError, KeyError, TypeError):
        raise _engine_failure() from None


class TurnHandler:
    def __init__(self, engine: AssessmentEngine, completion: CompletionPort | None = None):
        self.engine = engine
        self.completion = completion

    def prepare(self, snapshot: TurnSnapshot, request: SupportedInteraction) -> TurnDraft:
        parent, activity, state = snapshot.parent, snapshot.activity, snapshot.activity.state
        if parent.revision >= MAX_COUNTER or activity.revision >= MAX_COUNTER:
            raise RuntimeSessionError(500, "INTERNAL_ERROR")
        if isinstance(request, SetNameInteraction):
            if state.status != "collecting_name":
                raise RuntimeSessionError(422, "INVALID_ACTIVITY_TRANSITION")
            name = validate_display_name(request.payload.display_name)
            return self._advance(snapshot, name, (), self.engine.select(snapshot.release, (), activity.id))
        if state.status != "in_progress" or state.display_name is None or state.current_question is None:
            raise RuntimeSessionError(422, "INVALID_ACTIVITY_TRANSITION")
        payload = request.payload
        if payload.question_id != state.current_question.question_id:
            raise RuntimeSessionError(422, "INVALID_QUESTION")
        pinned = _definition_question(snapshot.release, payload.question_id)
        if pinned is None:
            raise _engine_failure()
        question = _view_question(pinned)
        if payload.option_id not in {option.id for option in question.options}:
            raise RuntimeSessionError(422, "INVALID_OPTION")
        answer = ActivityAnswer(answer_id=uuid4().hex, question_id=question.question_id, option_id=payload.option_id,
                                ordinal=len(state.answers) + 1, accepted_activity_revision=activity.revision + 1,
                                source="option", question=question)
        answers = (*state.answers, answer)
        return self._advance(snapshot, state.display_name, answers,
                             self.engine.select(snapshot.release, answers, activity.id))

    def _progress(self, state, selection: SelectionResult, count: int) -> JsonObject:
        if selection.progress.completed != count:
            raise _engine_failure()
        if state.state_schema_version == 1:
            return {"completed": count}
        return {"completed": count, "min_total": selection.progress.min_total,
                "max_total": selection.progress.max_total, "total": selection.progress.total,
                "phase": selection.phase.value}

    def _advance(self, snapshot: TurnSnapshot, name: str, answers: tuple[ActivityAnswer, ...],
                 selection: SelectionResult) -> TurnDraft:
        state = snapshot.activity.state
        completed = selection.status == SelectionStatus.COMPLETED
        cap = _question_cap(snapshot.release)
        if (completed and not answers) or len(answers) > cap or (len(answers) == cap and not completed):
            raise _engine_failure()
        base = state.model_dump(mode="json") | {
            "display_name": name, "clarification": None, "answers": [a.model_dump(mode="json") for a in answers],
            "progress": self._progress(state, selection, len(answers))}
        bundle = None
        if completed:
            if self.completion is None:
                # Never persist the final answer as a fake in-progress step.
                raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "not_configured"})
            context = CompletionContext(snapshot=snapshot, answers=answers, selection=selection,
                                        next_activity_revision=snapshot.activity.revision + 1)
            bundle = self._checked_bundle(snapshot, selection, name, _prepare_completion(self.completion, context))
            base |= {"status": "completed", "current_question": None, "current_result_id": bundle.result_id}
        else:
            question = _view_question(_definition_question(snapshot.release, selection.next_question_id))
            base |= {"status": "in_progress", "current_question": question.model_dump(mode="json")}
        try:
            return TurnDraft(next_state=_STATE.validate_python(base), completion=bundle)
        except ValidationError:
            raise _engine_failure() from None

    def _checked_bundle(self, snapshot: TurnSnapshot, selection: SelectionResult, name: str,
                        bundle: CompletionBundle) -> CompletionBundle:
        """Server-owned projector output: any mismatch is an internal error, never a partial commit."""
        try:
            checked = CompletionBundle.model_validate(bundle.model_dump(mode="json"))
        except (ValidationError, AttributeError):
            raise RuntimeSessionError(500, "INTERNAL_ERROR") from None
        houses = {house.get("house_id"): house for house in snapshot.release.content.get("houses", ())}
        pinned = houses.get(checked.card.house.house_id)
        card, share = checked.card, checked.share
        if (pinned is None or checked.card.house.house_id != selection.primary_house_id
                or (pinned.get("name"), pinned.get("theme_ref"), pinned.get("mascot_ref")) != (
                    card.house.name, card.house.theme_ref, card.house.mascot_ref)
                or checked.result_revision != snapshot.next_result_revision
                or checked.source_activity_revision != snapshot.activity.revision + 1
                or card.display_name != name or card.is_demo != snapshot.release.is_demo
                or (share.result_id, share.result_revision, share.activity_id) != (
                    checked.result_id, checked.result_revision, snapshot.activity.id)
                or (share.display_name, share.house, share.is_demo) != (card.display_name, card.house, card.is_demo)):
            raise RuntimeSessionError(500, "INTERNAL_ERROR")
        return checked
