"""Guard mutations with real parent locks, durable outcomes and atomic PostgreSQL writes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event
from time import monotonic

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

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
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.schemas.activity import (
    ActivityRecord,
    ActivityStateV1,
    ActivityStateV2,
    CapabilitySnapshot,
    CommitPatch,
    NewMessage,
)
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.result import ResultSnapshotInput
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.releases import validate_release
from tests.helpers.builders import adaptive_capabilities, agent_release, experience_release
from tests.helpers.clock import FakeClock
from tests.helpers.product import FakeProductReleaseSource
from tests.unit.conftest import valid_v1_doc as legacy_definition_fixture
from tests.unit.conftest import valid_v2_doc as adaptive_definition_fixture
from tests.unit.conftest import validator as pilot_validator_fixture

pytestmark = pytest.mark.integration
NOW = datetime(2026, 10, 20, tzinfo=timezone.utc)
PROFILE = "riasec.mean.bounds.v2"
valid_v1_doc = legacy_definition_fixture
valid_v2_doc = adaptive_definition_fixture
validator = pilot_validator_fixture


@pytest.fixture
def rig(test_database, valid_v2_doc, validator):
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    uow = RuntimeUnitOfWork(engine)
    clock = FakeClock(NOW)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(seconds=60))
    source = FakeProductReleaseSource()
    source.experiences[("logical-experience", PROFILE)] = experience_release(valid_v2_doc)
    capabilities = adaptive_capabilities()
    agent = validate_release(agent_release(content={"greeting_text": "Hello",
                                                   "allowed_activity_profiles": [PROFILE]}),
                             environment="demo", capabilities=capabilities, validator=validator)
    with uow.begin() as session:
        pin = SnapshotRepository().store(session, agent)
        for identity in ("conv", "other-conv"):
            ConversationRepository().insert(session, ConversationRecord(
                id=identity, owner_id="owner", environment="demo", status="active", revision=0,
                agent_snapshot=pin, capability_snapshot=capabilities, created_at=NOW,
                expires_at=NOW + timedelta(hours=1), content_retention_seconds=86400))
    service = ActivityPersistence(uow, source, validator, clock=clock)
    try:
        yield engine, uow, clock, caller, source, service, AccessPolicy(clock=clock)
    finally:
        engine.dispose()


def start(rig, conversation="conv", key="start"):
    return rig[5].start(rig[3], conversation, 0, "logical-experience", PROFILE, key).data["activity_id"]


def question(index=1):
    return {"question_id": f"q{index}", "title": "Question", "options": [
        {"id": "one", "label": "One"}, {"id": "two", "label": "Two"}]}


def patch(activity_id, *, suffix="one", expected=0):
    state = ActivityStateV2(state_schema_version=2, schema_version=2, type="personality_assessment_adaptive",
                            algorithm_profile=PROFILE, status="in_progress", display_name="Student",
                            current_question=question(), clarification=None, answers=(), current_result_id=None,
                            progress={"completed": 0, "total": None, "phase": "baseline"})
    return CommitPatch(request_input={"action": "set_name", "name": "Student"}, activity_id=activity_id,
                       expected_activity_revision=expected, next_state=state,
                       append_messages=(NewMessage(message_id=f"msg-{suffix}", role="assistant", blocks=(),
                                                   text="Persisted message"),), new_result=None,
                       invalidate_result_ids=(), response_data={"message_id": f"msg-{suffix}"})


def completion(activity_id, *, result_id="result-one", expected=0, generation=1, invalidations=()):
    base = patch(activity_id, suffix=result_id, expected=expected)
    state = base.next_state.model_dump(mode="json")
    state.update(status="completed", current_question=None, current_result_id=result_id,
                 answers=[{"answer_id": f"a{i}", "question_id": f"q{i}", "option_id": "one", "ordinal": i,
                           "accepted_activity_revision": expected + 1, "source": "option", "question": question(i)}
                          for i in range(1, 13)],
                 progress={"completed": 12, "total": 12, "phase": "completed"})
    card = {"display_name": "Student", "house": {"house_id": "h1", "name": "House", "theme_ref": "theme",
                                                "mascot_ref": "mascot"}, "strengths": ["Strength"],
            "tendencies": ["Tendency"], "career_groups": ["Group"], "quote": "Quote", "is_demo": True}
    result = ResultSnapshotInput(result_id=result_id, activity_id=activity_id, result_revision=generation,
        source_activity_revision=expected + 1,
        result_projection={"result_id": result_id, "result_revision": generation, "activity_id": activity_id,
                           "conversation_id": "conv", "activity_type": "personality_assessment_adaptive",
                           "experience_release_id": "experience-x", "created_at": NOW, "data": card},
        card_projection=card,
        share_projection={"result_id": result_id, "result_revision": generation, "activity_id": activity_id,
                          "display_name": "Student", "house": card["house"], "branding": {"brand_ref": "brand",
                          "label": "Brand"}, "is_demo": True, "demo_label": "Demo", "template_ref": "template"})
    return CommitPatch(**(base.model_dump() | {"next_state": state, "new_result": result,
                                              "invalidate_result_ids": invalidations}))


def counts(rig):
    with rig[1].begin() as session:
        return tuple(session.scalar(select(func.count()).select_from(table))
                     for table in (activities, messages, result_snapshots, operation_outcomes))


def test_cross_owner_never_returns_state(rig):
    act = start(rig)
    other = VerifiedCaller("stranger", "sda-product-bff", NOW + timedelta(seconds=60))
    for action in (lambda: rig[5].commit(other, "conv", 1, "commit", patch(act)),
                   lambda: rig[5].start(other, "conv", 0, "logical-experience", PROFILE, "start")):
        with pytest.raises(RuntimeSessionError) as error:
            action()
        assert (error.value.status, error.value.code, error.value.details) == (404, "RESOURCE_NOT_FOUND", None)
    with rig[1].begin() as session:
        with pytest.raises(RuntimeSessionError) as error:
            rig[6].require_read(session, other, "conv")
        assert error.value.code == "RESOURCE_NOT_FOUND"
    assert counts(rig) == (1, 0, 0, 1)


def test_two_expected_revision_writers_only_one_commits(rig):
    act = start(rig)
    ready = Barrier(2)
    def write(suffix):
        ready.wait(timeout=10)
        try:
            rig[5].commit(rig[3], "conv", 1, suffix, patch(act, suffix=suffix))
            return "committed"
        except RuntimeSessionError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(write, suffix) for suffix in ("left", "right")]
        assert sorted(f.result(timeout=15) for f in futures) == ["REVISION_CONFLICT", "committed"]
    with rig[1].begin() as session:
        assert session.scalar(select(conversations.c.revision).where(conversations.c.id == "conv")) == 2
        assert session.scalar(select(activities.c.revision)) == 1
    assert counts(rig) == (1, 1, 0, 2)


@pytest.mark.parametrize("closure,code", [("end", "CONVERSATION_ENDED"), ("expiry", "CONVERSATION_EXPIRED"),
                                          ("context", "AUTH_REQUIRED")])
def test_end_or_expiry_or_context_expiry_blocks_late_patch(rig, closure, code):
    act = start(rig)
    waiting = Event()
    def observe(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and "conversations" in statement:
            waiting.set()
    def write():
        try:
            rig[5].commit(rig[3], "conv", 1, "late", patch(act))
            return "committed"
        except RuntimeSessionError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=1) as pool:
        with rig[1].begin() as blocker:
            blocker.execute(select(conversations).where(conversations.c.id == "conv").with_for_update())
            pid = blocker.scalar(text("SELECT pg_backend_pid()"))
            event.listen(rig[0], "before_cursor_execute", observe)
            future = pool.submit(write)
            try:
                assert waiting.wait(timeout=5)
                deadline = monotonic() + 5
                while not blocker.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                              "WHERE :pid = ANY(pg_blocking_pids(pid)))"), {"pid": pid}):
                    assert monotonic() < deadline, "writer did not actually wait on the PostgreSQL parent lock"
                if closure == "end":
                    blocker.execute(conversations.update().where(conversations.c.id == "conv").values(
                        status="ended", ended_at=NOW, revision=2))
                elif closure == "expiry":
                    rig[2].set(NOW + timedelta(hours=1))
                else:
                    rig[2].set(rig[3].expires_at)
            finally:
                event.remove(rig[0], "before_cursor_execute", observe)
        assert future.result(timeout=10) == code
    assert counts(rig) == (1, 0, 0, 1)


def test_patch_failure_rolls_back_result_state_messages_outcome(rig):
    act = start(rig)
    rig[5].commit(rig[3], "conv", 1, "complete", completion(act))
    before = counts(rig)
    candidate = completion(act, result_id="result-two", expected=1, generation=2, invalidations=("result-one",))
    # A duplicate history PK fails after state/result writes, proving the whole UoW rolls back.
    candidate = candidate.model_copy(update={"append_messages": (NewMessage(message_id="msg-result-one",
                                                                            role="assistant", blocks=()),)})
    with pytest.raises(IntegrityError):
        rig[5].commit(rig[3], "conv", 2, "broken", candidate)
    assert counts(rig) == before
    with rig[1].begin() as session:
        assert session.scalar(select(result_snapshots.c.validity)) == "valid"
        assert session.scalar(select(activities.c.state))["current_result_id"] == "result-one"
        assert session.scalar(select(activities.c.revision)) == 1
        assert session.scalar(select(conversations.c.revision).where(conversations.c.id == "conv")) == 2


def test_retry_ignores_fresh_generated_patch_ids(rig):
    act = start(rig)
    first = rig[5].commit(rig[3], "conv", 1, "same", completion(act))
    retry = completion(act, result_id="fresh-result")
    # Deliberately malformed candidate must be ignored once original input replay is found.
    retry = retry.model_copy(update={"next_state": retry.next_state.model_copy(update={"schema_version": 1})})
    second = rig[5].commit(rig[3], "conv", 1, "same", retry)
    assert second.replayed and second.data == first.data and second.status == first.status
    assert counts(rig) == (1, 1, 1, 2)


@pytest.mark.parametrize("change", ["input", "parent-revision", "child-revision"])
def test_same_key_changed_original_request_collides(rig, change):
    act = start(rig)
    original = patch(act)
    rig[5].commit(rig[3], "conv", 1, "same", original)
    candidate = original.model_copy(update={"request_input": {"action": "different"}}) if change == "input" else original
    if change == "child-revision":
        candidate = candidate.model_copy(update={"expected_activity_revision": 1})
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].commit(rig[3], "conv", 2 if change == "parent-revision" else 1, "same", candidate)
    assert error.value.code == "IDEMPOTENCY_KEY_COLLISION"


def test_same_key_different_resource_does_not_replay(rig):
    first = start(rig)
    second = start(rig, "other-conv")
    assert first != second
    assert counts(rig) == (2, 0, 0, 2)


def test_start_pins_validated_release_and_retry_never_resolves_active(rig):
    act = start(rig)
    rig[4].unavailable = True
    replay = rig[5].start(rig[3], "conv", 0, "logical-experience", PROFILE, "start")
    assert replay.replayed and replay.data["activity_id"] == act
    assert rig[4].resolve_calls == 1
    with rig[1].begin() as session:
        row = session.execute(select(activities)).mappings().one()
        assert row["experience_id"] == "logical-experience"
        assert row["experience_release_id"] == "experience-x"
        assert row["state"]["status"] == "collecting_name"
        assert row["state"]["answers"] == [] and row["state"]["current_result_id"] is None
        assert row["revision"] == 0


def test_second_active_activity_is_rejected(rig):
    start(rig)
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].start(rig[3], "conv", 1, "logical-experience", PROFILE, "second")
    assert error.value.code == "REVISION_CONFLICT"
    assert counts(rig) == (1, 0, 0, 1)


@pytest.mark.parametrize("offset", [0, 1])
def test_exact_or_after_expiry_blocks_read_and_replay_without_materialization(rig, offset):
    start(rig)
    rig[2].set(NOW + timedelta(hours=1, seconds=offset))
    caller = VerifiedCaller("owner", "sda-product-bff", rig[2].now() + timedelta(seconds=60))
    with rig[1].begin() as session:
        with pytest.raises(RuntimeSessionError) as error:
            rig[6].require_read(session, caller, "conv")
        assert error.value.code == "CONVERSATION_EXPIRED"
        assert session.scalar(select(conversations.c.status).where(conversations.c.id == "conv")) == "active"
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].start(caller, "conv", 0, "logical-experience", PROFILE, "start")
    assert error.value.code == "CONVERSATION_EXPIRED"


def test_valid_result_replacement_is_atomic(rig):
    act = start(rig)
    rig[5].commit(rig[3], "conv", 1, "first", completion(act))
    rig[5].commit(rig[3], "conv", 2, "second", completion(act, result_id="result-two", expected=1,
                                                        generation=2, invalidations=("result-one",)))
    with rig[1].begin() as session:
        assert dict(session.execute(select(result_snapshots.c.result_id, result_snapshots.c.validity)).all()) == {
            "result-one": "superseded", "result-two": "valid"}
        assert session.scalar(select(activities.c.state))["current_result_id"] == "result-two"
        assert session.scalars(select(messages.c.ordinal).order_by(messages.c.ordinal)).all() == [1, 2]
        assert session.scalars(select(messages.c.committed_conversation_revision)
                               .order_by(messages.c.ordinal)).all() == [2, 3]
    assert counts(rig) == (1, 2, 2, 3)


@pytest.mark.parametrize("allowed,profile,code", [([], PROFILE, "FORBIDDEN"),
    (["personality_assessment"], PROFILE, "FORBIDDEN"), ([PROFILE], None, "FORBIDDEN")])
def test_start_obeys_pinned_agent_permission_without_implicit_grants(rig, validator, allowed, profile, code):
    descriptor = agent_release(release_id="restricted", content={"greeting_text": "Hello",
                                                                 "allowed_activity_profiles": allowed})
    release = validate_release(descriptor, environment="demo", capabilities=adaptive_capabilities(), validator=validator)
    with rig[1].begin() as session:
        pin = SnapshotRepository().store(session, release)
        session.execute(conversations.update().where(conversations.c.id == "conv").values(agent_release_id=pin.release_id))
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].start(rig[3], "conv", 0, "logical-experience", profile, "start")
    assert error.value.code == code and rig[4].resolve_calls == 0
    assert counts(rig) == (0, 0, 0, 0)


def test_legacy_permission_preserves_none_profile_but_real_validator_fails_closed(rig, validator, valid_v1_doc):
    agent = validate_release(agent_release(release_id="legacy-agent"), environment="demo",
                             capabilities=CapabilitySnapshot(), validator=validator)
    with rig[1].begin() as session:
        SnapshotRepository().store(session, agent)
        session.execute(conversations.update().where(conversations.c.id == "conv").values(
            agent_release_id="legacy-agent", capability_snapshot=CapabilitySnapshot().model_dump(mode="json")))
    rig[4].experiences[("logical-experience", None)] = experience_release(valid_v1_doc)
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].start(rig[3], "conv", 0, "logical-experience", None, "legacy-start")
    assert error.value.code == "INCOMPATIBLE_RELEASE" and rig[4].resolve_calls == 1
    assert counts(rig) == (0, 0, 0, 0)


def test_start_rechecks_parent_after_product_work_without_holding_transaction(rig):
    resolving, release = Event(), Event()
    source_resolve = rig[4].resolve_active_experience
    def resolve(*args):
        resolving.set()
        assert release.wait(timeout=5)
        return source_resolve(*args)
    rig[4].resolve_active_experience = resolve
    def begin():
        try:
            start(rig)
            return "started"
        except RuntimeSessionError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(begin)
        try:
            assert resolving.wait(timeout=5)
            with rig[1].begin() as session:
                session.execute(text("SET LOCAL lock_timeout = '1000ms'"))
                session.execute(conversations.update().where(conversations.c.id == "conv").values(
                    status="ended", ended_at=NOW, revision=1))
        finally:
            release.set()
        assert future.result(timeout=10) == "CONVERSATION_ENDED"
    assert counts(rig) == (0, 0, 0, 0)


def test_concurrent_start_same_key_uses_one_activity_and_original_outcome(rig):
    ready = Barrier(2)
    source_resolve = rig[4].resolve_active_experience
    def resolve(*args):
        ready.wait(timeout=5)
        return source_resolve(*args)
    rig[4].resolve_active_experience = resolve
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(rig[5].start, rig[3], "conv", 0, "logical-experience", PROFILE, "same")
                   for _ in range(2)]
        responses = [future.result(timeout=10) for future in futures]
    assert responses[0].data == responses[1].data
    assert sorted(response.replayed for response in responses) == [False, True]
    assert counts(rig) == (1, 0, 0, 1)


@pytest.mark.parametrize("mutation", ["schema", "answer_revision", "result_parent", "result_pin", "generation",
                                      "source_revision", "foreign_interaction"])
def test_candidate_integrity_errors_never_write_partial_state(rig, mutation):
    act = start(rig)
    candidate = completion(act)
    if mutation == "schema":
        candidate = patch(act).model_copy(update={"next_state": ActivityStateV1(
            state_schema_version=1, schema_version=1, type="personality_assessment", status="collecting_name",
            display_name=None, current_question=None, clarification=None, answers=(),
            current_result_id=None, progress={"completed": 0})})
    elif mutation == "answer_revision":
        answer = candidate.next_state.answers[0].model_copy(update={"accepted_activity_revision": 2})
        candidate = candidate.model_copy(update={"next_state": candidate.next_state.model_copy(update={
            "answers": (answer, *candidate.next_state.answers[1:])})})
    elif mutation in {"result_parent", "result_pin"}:
        field = "conversation_id" if mutation == "result_parent" else "experience_release_id"
        result = candidate.new_result.model_copy(update={"result_projection":
            candidate.new_result.result_projection.model_copy(update={field: "different"})})
        candidate = candidate.model_copy(update={"new_result": result})
    elif mutation == "generation":
        candidate = completion(act, generation=2)
    elif mutation == "source_revision":
        candidate = candidate.model_copy(update={"new_result": candidate.new_result.model_copy(update={
            "source_activity_revision": 2})})
    else:
        candidate = candidate.model_copy(update={"append_messages": (NewMessage(message_id="interaction",
            role="user", blocks=(), interaction={"activity_id": "foreign", "action": "set_name",
                                                "question_id": None, "option_id": None}),)})
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].commit(rig[3], "conv", 1, "bad", candidate)
    assert error.value.code in {"INVALID_REQUEST", "INCOMPATIBLE_SCHEMA"}
    assert counts(rig) == (1, 0, 0, 1)


def test_replacing_result_requires_explicit_invalidation(rig):
    act = start(rig)
    rig[5].commit(rig[3], "conv", 1, "first", completion(act))
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].commit(rig[3], "conv", 2, "bad", completion(act, result_id="second", expected=1, generation=2))
    assert error.value.code == "INVALID_REQUEST"
    assert counts(rig) == (1, 1, 1, 2)


def test_postgres_blocks_multiple_active_children_and_foreign_result_ref(rig):
    act = start(rig)
    with pytest.raises(IntegrityError):
        with rig[1].begin() as session:
            current = ActivityRepository().get(session, "conv", act)
            ActivityRepository().insert(session, current.model_copy(update={"id": "second-active"}))
    rig[5].commit(rig[3], "conv", 1, "complete", completion(act))
    other = start(rig, "other-conv")
    with pytest.raises(IntegrityError):
        with rig[1].begin() as session:
            record = ActivityRepository().get(session, "other-conv", other)
            state = completion(other).next_state
            candidate = ActivityRecord.model_validate(record.model_dump() | {"revision": 1, "state": state})
            ActivityRepository().save(session, candidate)
    with rig[1].begin() as session:
        assert ActivityRepository().get(session, "other-conv", other).state.current_result_id is None


def test_outcome_insert_failure_rolls_back_all_preceding_writes(rig):
    act = start(rig)
    with rig[1].begin() as session:
        session.execute(text("CREATE FUNCTION execution.reject_outcome() RETURNS trigger LANGUAGE plpgsql AS $$ "
                             "BEGIN RAISE EXCEPTION 'injected outcome failure'; END $$"))
        session.execute(text("CREATE TRIGGER reject_outcome BEFORE INSERT ON execution.operation_outcomes "
                             "FOR EACH ROW EXECUTE FUNCTION execution.reject_outcome()"))
    with pytest.raises(DBAPIError):
        rig[5].commit(rig[3], "conv", 1, "failed", completion(act))
    assert counts(rig) == (1, 0, 0, 1)
    with rig[1].begin() as session:
        assert session.scalar(select(activities.c.revision)) == 0
        assert session.scalar(select(conversations.c.revision).where(conversations.c.id == "conv")) == 1


def test_commit_uses_pinned_snapshot_during_product_outage_and_jcs_replay(rig):
    act = start(rig)
    rig[4].unavailable = True
    first = patch(act).model_copy(update={"request_input": {"b": 1.0, "a": "value"}})
    rig[5].commit(rig[3], "conv", 1, "canonical", first)
    retry = patch(act, suffix="different").model_copy(update={"request_input": {"a": "value", "b": 1}})
    response = rig[5].commit(rig[3], "conv", 1, "canonical", retry)
    assert response.replayed and response.data == {"message_id": "msg-one"}
    assert rig[4].resolve_calls == 1


def test_just_before_deadline_allows_write_without_sliding_expiry(rig):
    act = start(rig)
    rig[2].set(NOW + timedelta(hours=1, microseconds=-1))
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=1))
    assert rig[5].commit(caller, "conv", 1, "before", patch(act)).status == 200
    with rig[1].begin() as session:
        assert rig[6].require_read(session, caller, "conv").expires_at == NOW + timedelta(hours=1)


@pytest.mark.parametrize("key", ["k" * 257, "k" * 4000])
def test_oversize_activity_keys_rejected_before_product_and_writes(rig, key):
    with pytest.raises(RuntimeSessionError) as caught:
        start(rig, key=key)
    assert (caught.value.status, caught.value.code) == (400, "INVALID_REQUEST")
    assert rig[4].resolve_calls == 0
    child = start(rig, key="k" * 256)
    with pytest.raises(RuntimeSessionError) as caught:
        rig[5].commit(rig[3], "conv", 1, key, patch(child))
    assert (caught.value.status, caught.value.code) == (400, "INVALID_REQUEST")
    with rig[1].begin() as session:
        assert session.scalar(select(conversations.c.revision).where(conversations.c.id == "conv")) == 1
        assert session.scalar(select(func.count()).select_from(messages)) == 0
        assert session.scalar(select(func.count()).select_from(operation_outcomes)) == 1
    assert rig[5].commit(rig[3], "conv", 1, "c" * 256, patch(child)).status == 200


@pytest.mark.parametrize("owner", ["x" * 257, chr(0x1F600) * 257, "bad\ud800", b"owner"])
def test_invalid_direct_owner_guards_start_commit_and_end(rig, owner):
    from dataclasses import replace

    from agent_runtime.sessions.schemas.conversation import EndConversationInput
    from agent_runtime.sessions.services.lifecycle import LifecycleService

    caller = replace(rig[3], owner_id=owner)
    child = start(rig)
    calls = rig[4].resolve_calls
    attempts = [
        lambda: rig[5].start(caller, "other-conv", 0, "logical-experience", PROFILE, "start"),
        lambda: rig[5].commit(caller, "conv", 1, "commit", patch(child)),
        lambda: LifecycleService(rig[1], clock=rig[2]).end(caller, "conv",
            EndConversationInput(expected_revision=1, idempotency_key="end")),
    ]
    for attempt in attempts:
        with pytest.raises(RuntimeSessionError) as caught:
            attempt()
        assert (caught.value.status, caught.value.code) == (401, "AUTH_REQUIRED")
    assert rig[4].resolve_calls == calls
    with rig[1].begin() as session:
        assert session.scalar(select(conversations.c.revision).where(conversations.c.id == "conv")) == 1
        assert session.scalar(select(func.count()).select_from(messages)) == 0
        assert session.scalar(select(func.count()).select_from(operation_outcomes)) == 1
