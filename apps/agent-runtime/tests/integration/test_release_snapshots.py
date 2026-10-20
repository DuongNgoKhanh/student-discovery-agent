"""Real PostgreSQL evidence for shared immutable release import and racing transactions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from sqlalchemy import func, select

from agent_runtime.evaluations.services.validator import ExperienceValidator
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import conversations, release_snapshots
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.schemas.activity import CapabilitySnapshot
from agent_runtime.sessions.schemas.release import ReleaseKey
from agent_runtime.sessions.services.releases import validate_release
from tests.helpers.builders import agent_release
from tests.helpers.product import FakeProductReleaseSource

pytestmark = pytest.mark.integration


@pytest.fixture
def storage(test_database):
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    try:
        yield engine, RuntimeUnitOfWork(engine)
    finally:
        engine.dispose()


def repository():
    return SnapshotRepository()


def validated(descriptor=None):
    return validate_release(descriptor or agent_release(), environment="demo", capabilities=CapabilitySnapshot(),
                            validator=ExperienceValidator())


def pin_conversation(session, conversation_id, key):
    # Task 4 has no conversation repository yet; only arrange its existing FK through Core.
    created = datetime(2026, 10, 20, tzinfo=timezone.utc)
    session.execute(conversations.insert().values(
        id=conversation_id, owner_id="owner", environment="demo", status="active", revision=0,
        agent_environment=key.environment, agent_kind=key.kind, agent_release_id=key.release_id,
        capability_snapshot=CapabilitySnapshot().model_dump(mode="json"), created_at=created,
        expires_at=created + timedelta(hours=1), content_retention_seconds=86400,
    ))


def test_shared_snapshot_survives_active_switch_and_engine_restart(storage, test_database):
    engine, uow = storage
    source = FakeProductReleaseSource()
    source.agent = agent_release()
    imported = validated(source.resolve_active_agent("demo"))
    repo = repository()
    with uow.begin() as session:
        key = repo.store(session, imported)
        pin_conversation(session, "one", key)
    with uow.begin() as session:
        assert repo.store(session, imported) == key
        pin_conversation(session, "two", key)
    source.agent = agent_release(release_id="agent-y", content={"greeting_text": "Changed",
                                                              "allowed_activity_profiles": []})
    source.unavailable = True
    engine.dispose()
    restarted = build_engine(test_database.url)
    try:
        with RuntimeUnitOfWork(restarted).begin() as session:
            loaded = repository().get(session, key)
            assert loaded.content["greeting_text"] == "Hello"
            assert session.scalar(select(func.count()).select_from(release_snapshots)) == 1
            assert session.scalars(select(conversations.c.agent_release_id)).all() == ["agent-x", "agent-x"]
        assert source.resolve_calls == 1
    finally:
        restarted.dispose()


@pytest.mark.parametrize("change", ["content", "metadata"])
def test_same_identity_cannot_change_content_or_immutable_metadata(storage, change):
    _, uow = storage
    repo = repository()
    original = validated()
    with uow.begin() as session:
        key = repo.store(session, original)
    conflicting = (validated(agent_release(content={"greeting_text": "Other", "allowed_activity_profiles": []}))
                   if change == "content" else original.model_copy(update={"is_demo": False}))
    with pytest.raises(RuntimeSessionError) as error:
        with uow.begin() as session:
            repo.store(session, conflicting)
    assert (error.value.status, error.value.code) == (422, "INCOMPATIBLE_RELEASE")
    with uow.begin() as session:
        assert repo.get(session, key) == original
        assert session.scalar(select(func.count()).select_from(release_snapshots)) == 1


@pytest.mark.parametrize("change", ["hash", "schema"])
def test_invalid_import_rolls_back_without_creating_rows(storage, change):
    _, uow = storage
    repo = repository()
    invalid = (agent_release().model_copy(update={"content_hash": "sha256:" + "0" * 64})
               if change == "hash" else agent_release().model_copy(update={"delivery_schema_version": "draft"}))
    with pytest.raises(RuntimeSessionError) as error:
        with uow.begin() as session:
            repo.store(session, validated(invalid))
    assert error.value.code == "INCOMPATIBLE_RELEASE"
    with uow.begin() as session:
        assert session.scalar(select(func.count()).select_from(release_snapshots)) == 0


def test_nested_payload_mutation_after_validation_is_not_stored(storage):
    _, uow = storage
    repo = repository()
    release = validated()
    release.content["greeting_text"] = "Tampered"
    with pytest.raises(RuntimeSessionError) as error:
        with uow.begin() as session:
            repo.store(session, release)
    assert error.value.code == "INCOMPATIBLE_RELEASE"
    with uow.begin() as session:
        assert session.scalar(select(func.count()).select_from(release_snapshots)) == 0


def test_missing_pin_is_corruption_without_product_fallback(storage):
    _, uow = storage
    repo = repository()
    with uow.begin() as session:
        with pytest.raises(RuntimeSessionError) as error:
            repo.get(session, ReleaseKey(environment="demo", kind="agent", release_id="missing"))
    assert (error.value.status, error.value.code) == (500, "INTERNAL_ERROR")


@pytest.mark.parametrize("conflict", [False, True])
def test_racing_inserts_select_one_immutable_winner(storage, conflict):
    _, uow = storage
    repo = repository()
    first = validated()
    second = (validated(agent_release(content={"greeting_text": "Other", "allowed_activity_profiles": []}))
              if conflict else first)
    ready = Barrier(2)

    def store(release):
        ready.wait(timeout=10)
        try:
            with uow.begin() as session:
                repo.store(session, release)
            return "stored"
        except RuntimeSessionError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(store, release) for release in (first, second)]
        outcomes = sorted(future.result(timeout=20) for future in futures)
    assert outcomes == (["INCOMPATIBLE_RELEASE", "stored"] if conflict else ["stored", "stored"])
    with uow.begin() as session:
        assert session.scalar(select(func.count()).select_from(release_snapshots)) == 1
        assert repo.get(session, ReleaseKey(environment="demo", kind="agent", release_id="agent-x")) in (first, second)
