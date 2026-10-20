"""Release and trusted storage fixtures; never used by production code.

Legacy definitions cannot pass the current semantic validator. Storage builders
exercise existing v1 persistence without exposing an import/start bypass.
"""
from datetime import timedelta

from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.schemas.activity import (
    ActivityRecord,
    ActivityStateV1,
    ActivityStateV2,
    CapabilitySnapshot,
    SupportedBlock,
)
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.release import ReleaseDescriptor
from agent_runtime.sessions.schemas.result import ResultSnapshotInput
from agent_runtime.sessions.services.releases import validate_snapshot_integrity


def agent_release(**changes):
    content = changes.pop("content", {
        "greeting_text": "Hello", "allowed_activity_profiles": ["personality_assessment"]
    })
    data = dict(environment="demo", kind="agent", release_id="agent-x",
                content_hash=calculate_content_hash(content), delivery_schema_version="agent.snapshot.v1",
                content=content, is_demo=True)
    return ReleaseDescriptor(**(data | changes))


def experience_release(content, **changes):
    data = dict(environment="demo", kind="experience", release_id="experience-x",
                content_hash=calculate_content_hash(content), delivery_schema_version="experience.snapshot.v1",
                content=content, is_demo=True, definition_schema_version=content["schema_version"],
                engine_version=content["engine_version"],
                algorithm_profile="riasec.mean.bounds.v2" if content["schema_version"] == "2.0" else None)
    return ReleaseDescriptor(**(data | changes))


def adaptive_capabilities():
    return CapabilitySnapshot(accepted_activity_profiles=("riasec.mean.bounds.v2",), legacy_enabled=False,
                              supported_blocks=tuple(SupportedBlock(type=kind, schema_versions=(version,))
                                                     for kind, version in (
                                                         ("text", 1), ("assessment_question", 2),
                                                         ("assessment_clarification", 2), ("personality_card", 1))))


def persisted_state(definition, *, completed=False, pending=False):
    """Fixed question-4 / pending / completed v1 and 14 / 18-answer v2 states.

    Answers and result cards are synthetic storage evidence, never scoring output.
    """
    adaptive = definition["schema_version"] == "2.0"
    questions = {q["question_id"]: q for q in definition["questions"]}
    order = ([f"q_{code}_{index:02}" for index in range(1, 6) for code in "riasec"] if adaptive else
             [f"q_demo_{index:02}" for index in range(1, 7)])

    def question(identity):
        original = questions[identity]
        return {"question_id": identity, "title": original["prompt"], "options": [
            {"id": option["option_id"], "label": option["label"]} for option in original["choices"]]}

    count = (18 if completed else 14) if adaptive else (6 if completed else 3)
    revision = count + 1 + int(pending)
    current = None if completed else question(order[count])
    proposal = None
    if pending:
        proposal = {"proposal_id": "proposal-question-4", "question_id": current["question_id"],
                    "activity_revision": revision, "title": "Confirm persisted choice", "candidates": [
                        {"id": "candidate-one", "option_id": current["options"][0]["id"], "label": "First"}]}
    state = dict(status="completed" if completed else "in_progress", display_name="Fixture Student",
                 current_question=current, clarification=proposal,
                 answers=[{"answer_id": f"answer-{index:02}", "question_id": identity,
                           "option_id": questions[identity]["choices"][0]["option_id"], "ordinal": index,
                           "accepted_activity_revision": index + 1, "source": "option",
                           "question": question(identity)} for index, identity in enumerate(order[:count], 1)],
                 current_result_id="result-fixed" if completed else None)
    if adaptive:
        value = ActivityStateV2(**state, state_schema_version=2, schema_version=2,
            type="personality_assessment_adaptive", algorithm_profile="riasec.mean.bounds.v2",
            progress={"completed": count, "total": count if completed else None,
                      "phase": "completed" if completed else "adaptive"})
    else:
        value = ActivityStateV1(**state, state_schema_version=1, schema_version=1,
                               type="personality_assessment", progress={"completed": count})
    return value, revision


def seed_conversation(session, *, created_at, conversation_id="conversation-fixed", owner_id="owner",
                      capabilities=None):
    capabilities = capabilities if capabilities is not None else CapabilitySnapshot()
    pin = SnapshotRepository().store(session, validate_snapshot_integrity(agent_release()))
    record = ConversationRecord(id=conversation_id, owner_id=owner_id, environment="demo", status="active",
        revision=0, agent_snapshot=pin, capability_snapshot=capabilities, created_at=created_at,
        expires_at=created_at + timedelta(seconds=3600), content_retention_seconds=86400)
    ConversationRepository().insert(session, record)
    return record


def seed_activity(session, parent, definition, *, completed=False, pending=False):
    state, revision = persisted_state(definition, completed=completed, pending=pending)
    pin = SnapshotRepository().store(session, validate_snapshot_integrity(experience_release(definition)))
    record = ActivityRecord(id="activity-fixed", conversation_id=parent.id, experience_id="logical-experience",
        experience_snapshot=pin, engine_version=definition["engine_version"], revision=revision,
        state=state, created_at=parent.created_at)
    ActivityRepository().insert(session, record)
    ConversationRepository().save(session, parent.model_copy(update={
        "active_activity_id": record.id, "display_name": state.display_name, "revision": revision + 1}))
    return record


def seed_result(session, parent, activity, *, display_name="Fixture Student"):
    card = {"display_name": display_name, "house": {"house_id": "house_r", "name": "Synthetic House",
            "theme_ref": "theme-r", "mascot_ref": "mascot-r"}, "strengths": ["Fixture strength"],
            "tendencies": ["Fixture tendency"], "career_groups": ["Fixture group"],
            "quote": "Synthetic persistence fixture", "is_demo": True}
    result = ResultSnapshotInput(result_id="result-fixed", activity_id=activity.id, result_revision=2,
        source_activity_revision=activity.revision,
        result_projection={"result_id": "result-fixed", "result_revision": 2, "conversation_id": parent.id,
            "activity_id": activity.id, "activity_type": activity.state.type,
            "experience_release_id": activity.experience_snapshot.release_id, "created_at": parent.created_at,
            "data": card}, card_projection=card,
        share_projection={"result_id": "result-fixed", "result_revision": 2, "activity_id": activity.id,
            "display_name": card["display_name"], "house": card["house"],
            "branding": {"brand_ref": "brand", "label": "Fixture"}, "is_demo": True,
            "demo_label": "Demo", "template_ref": "template"})
    ResultRepository().insert(session, result, parent.created_at)
    return result
