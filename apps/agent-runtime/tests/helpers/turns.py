"""Shared turn fixtures. Synthetic examples come from contracts; never imported by runtime code."""
import copy
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import cache
from pathlib import Path
from typing import Literal
from uuid import uuid4

from sqlalchemy import func, select

from agent_runtime.evaluations.services.compatibility import PILOT_ENGINE_REGISTRY
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import (
    activities,
    conversations,
    messages,
    operation_outcomes,
    result_snapshots,
)
from agent_runtime.sessions.schemas.activity import ActivityRecord, ActivityStateV1, ActivityStateV2
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.schemas.conversation import ConversationRecord, CreateConversationInput
from agent_runtime.sessions.schemas.release import ReleaseKey
from agent_runtime.sessions.schemas.turn_execution import CompletionBundle, TurnSnapshot
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.releases import validate_snapshot_integrity
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_input import parse_turn_input
from agent_runtime.sessions.services.turn_store import TurnStore
from tests.helpers.builders import adaptive_capabilities, agent_release, experience_release
from tests.helpers.clock import FakeClock
from tests.helpers.product import FakeProductReleaseSource

PROFILE = "riasec.mean.bounds.v2"
NOW = datetime(2026, 10, 20, tzinfo=timezone.utc)
FIXTURE = Path(__file__).resolve().parents[4] / "contracts" / "fixtures" / "session-turns.json"


@cache
def _examples() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8-sig"))


def turn_examples() -> dict:
    return copy.deepcopy(_examples())


def make_turn_snapshot(definition: dict, *, capabilities=None) -> TurnSnapshot:
    """Fresh collecting_name activity pinned to an integrity-checked synthetic release."""
    now = NOW
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


@dataclass(repr=False)
class TurnRig:
    uow: object
    db_engine: object
    clock: object
    caller: VerifiedCaller
    product: FakeProductReleaseSource
    conversations: ConversationService
    activity_persistence: ActivityPersistence
    store: TurnStore
    handler: TurnHandler
    conversation_id: str
    activity_id: str
    completion: FakeCompletionPort
    service: object = None


def build_turn_rig(url: str, definition: dict, validator) -> TurnRig:
    upgrade_database(url)
    db_engine = build_engine(url)
    uow = RuntimeUnitOfWork(db_engine)
    clock = FakeClock(NOW)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(seconds=60))
    product = FakeProductReleaseSource()
    product.agent = agent_release(content={"greeting_text": "Hello", "allowed_activity_profiles": [PROFILE]})
    product.experiences[("logical-experience", PROFILE)] = experience_release(definition)
    conversations = ConversationService(uow, product, validator, policy=RuntimePolicy(environment="demo"),
                                        clock=clock)
    blocks = [block.model_dump() for block in adaptive_capabilities().supported_blocks]
    created = conversations.create(caller, CreateConversationInput(
        idempotency_key="create", accepted_activity_profiles=(PROFILE,), supported_blocks=blocks))
    conversation_id = created.data["conversation"]["id"]
    persistence = ActivityPersistence(uow, product, validator, clock=clock)
    activity_id = persistence.start(caller, conversation_id, 0, "logical-experience", PROFILE, "start").data[
        "activity_id"]
    completion = FakeCompletionPort()
    return TurnRig(uow=uow, db_engine=db_engine, clock=clock, caller=caller, product=product,
                   conversations=conversations, activity_persistence=persistence,
                   store=TurnStore(uow, persistence, conversations, clock=clock),
                   handler=TurnHandler(PinnedAssessmentEngine(PILOT_ENGINE_REGISTRY), completion),
                   conversation_id=conversation_id, activity_id=activity_id, completion=completion)


def turn_counts(rig: TurnRig) -> dict[str, int]:
    with rig.uow.begin() as session:
        def count(table, *where):
            return session.scalar(select(func.count()).select_from(table).where(*where))
        activity = session.execute(select(activities.c.revision, activities.c.state).where(
            activities.c.id == rig.activity_id)).one()
        return {"answers": len(activity.state["answers"]), "messages": count(messages),
                "outcomes": count(operation_outcomes), "results": count(result_snapshots),
                "conversation_revision": session.scalar(select(conversations.c.revision).where(
                    conversations.c.id == rig.conversation_id)),
                "activity_revision": activity.revision}


def current_state(rig: TurnRig) -> tuple[int, int, dict]:
    with rig.uow.begin() as session:
        revision = session.scalar(select(conversations.c.revision).where(conversations.c.id == rig.conversation_id))
        row = session.execute(select(activities.c.revision, activities.c.state).where(
            activities.c.id == rig.activity_id)).one()
        return revision, row.revision, row.state


def request_for(rig: TurnRig, action: Literal["set_name", "submit_answer"], *, key: str,
                option_id: str | None = None, with_activity_revision: bool = True):
    """Supported request against current DB revisions: name 'Ngân' or rating 3 on the current question."""
    revision, activity_revision, state = current_state(rig)
    if action == "set_name":
        payload = {"display_name": "Ngân"}
    else:
        question_id = state["current_question"]["question_id"]
        payload = {"question_id": question_id, "option_id": option_id or f"{question_id}_opt_3"}
    data = {"type": "interaction", "activity_id": rig.activity_id, "action": action, "payload": payload,
            "expected_revision": revision, "idempotency_key": key}
    if with_activity_revision:
        data["expected_activity_revision"] = activity_revision
    return parse_turn_input(data)
