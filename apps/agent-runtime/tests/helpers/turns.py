"""Shared turn fixtures. Synthetic examples come from contracts; never imported by runtime code."""
import copy
import json
from datetime import datetime, timedelta, timezone
from functools import cache
from pathlib import Path
from uuid import uuid4

from agent_runtime.sessions.schemas.activity import ActivityRecord, ActivityStateV1, ActivityStateV2
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.release import ReleaseKey
from agent_runtime.sessions.schemas.turn_execution import CompletionBundle, TurnSnapshot
from agent_runtime.sessions.services.releases import validate_snapshot_integrity
from tests.helpers.builders import adaptive_capabilities, experience_release

FIXTURE = Path(__file__).resolve().parents[4] / "contracts" / "fixtures" / "session-turns.json"


@cache
def _examples() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8-sig"))


def turn_examples() -> dict:
    return copy.deepcopy(_examples())


def make_turn_snapshot(definition: dict, *, capabilities=None) -> TurnSnapshot:
    """Fresh collecting_name activity pinned to an integrity-checked synthetic release."""
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    release = validate_snapshot_integrity(experience_release(definition))
    adaptive = definition["schema_version"] == "2.0"
    common = dict(status="collecting_name", display_name=None, current_question=None, clarification=None,
                  answers=(), current_result_id=None)
    state = (ActivityStateV2(**common, state_schema_version=2, schema_version=2,
                             type="personality_assessment_adaptive", algorithm_profile="riasec.mean.bounds.v2",
                             progress={"completed": 0, "total": None, "phase": "baseline"}) if adaptive else
             ActivityStateV1(**common, state_schema_version=1, schema_version=1, type="personality_assessment",
                             progress={"completed": 0}))
    if capabilities is None and adaptive:
        capabilities = adaptive_capabilities()
    parent = ConversationRecord(id="conv_demo", owner_id="owner", environment="demo", status="active", revision=1,
        agent_snapshot=ReleaseKey(environment="demo", kind="agent", release_id="agent-x"),
        capability_snapshot=capabilities if capabilities is not None else {}, active_activity_id="act_demo",
        created_at=now, expires_at=now + timedelta(hours=1), content_retention_seconds=86400)
    activity = ActivityRecord(id="act_demo", conversation_id=parent.id, experience_id="logical-experience",
        experience_snapshot=ReleaseKey(environment="demo", kind="experience", release_id=release.release_id),
        engine_version=release.engine_version, revision=0, state=state, created_at=now)
    return TurnSnapshot(parent=parent, activity=activity, release=release, next_result_revision=1)


def advance(snapshot, draft):
    """Snapshot as it would be read after committing draft (unit tests only)."""
    parent = snapshot.parent.model_copy(update={"revision": snapshot.parent.revision + 1,
                                                "display_name": draft.next_state.display_name})
    activity = snapshot.activity.model_copy(update={"revision": snapshot.activity.revision + 1,
                                                    "state": draft.next_state})
    return snapshot.model_copy(update={"parent": parent, "activity": activity})


def interaction(snapshot, action: str, payload: dict, *, key: str = "key") -> dict:
    return {"type": "interaction", "activity_id": snapshot.activity.id, "action": action, "payload": payload,
            "expected_revision": snapshot.parent.revision, "idempotency_key": key}


def biased_option(question) -> str:
    """Rate house R items 5 and all others 1 so the adaptive selector stops early with a bounded winner."""
    rating = 5 if question.question_id.startswith("q_r_") else 1
    return f"{question.question_id}_opt_{rating}"


class FakeCompletionPort:
    """Interface/atomicity fixture only: copies pinned house metadata, proves no real scoring."""

    def __init__(self, mutate=None):
        self.calls = 0
        self.mutate = mutate

    def prepare(self, context):
        self.calls += 1
        snapshot = context.snapshot
        house = next(h for h in snapshot.release.content["houses"]
                     if h["house_id"] == context.selection.primary_house_id)
        identity = {key: house[key] for key in ("house_id", "name", "theme_ref", "mascot_ref")}
        name = snapshot.activity.state.display_name
        result_id = uuid4().hex
        card = {"display_name": name, "house": identity, "strengths": house["strengths"],
                "tendencies": house["tendencies"], "career_groups": house["suggested_fields"],
                "quote": house["quote"], "is_demo": snapshot.release.is_demo}
        share = {"result_id": result_id, "result_revision": snapshot.next_result_revision,
                 "activity_id": snapshot.activity.id, "display_name": name, "house": identity,
                 "branding": {"brand_ref": "fixture-brand", "label": "Fixture"}, "is_demo": snapshot.release.is_demo,
                 "demo_label": "Demo fixture", "template_ref": "fixture-template"}
        bundle = {"result_id": result_id, "result_revision": snapshot.next_result_revision,
                  "source_activity_revision": context.next_activity_revision, "card": card, "share": share}
        if self.mutate:
            self.mutate(bundle)
        return CompletionBundle.model_validate(bundle)
