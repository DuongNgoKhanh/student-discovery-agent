"""Composition acceptance: signed HTTP, real PostgreSQL, and a genuinely new pool/app.

Synthetic proposal/completion fixtures are persistence inputs, not engine/scoring evidence.
Removing durable pin/state/history/outcome storage would break these assertions.
"""
import base64
import json
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from agent_runtime.api.internal.dependencies import RuntimeContainer, build_runtime
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.infrastructure.db.tables import (
    activities,
    messages,
    operation_outcomes,
    release_snapshots,
    result_snapshots,
)
from agent_runtime.main import create_app
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.services.activity import ActivityPersistence
from tests.helpers.builders import (
    adaptive_capabilities,
    agent_release,
    experience_release,
    persisted_state,
    seed_result,
)
from tests.integration.test_session_http import KEY, assert_error, call
from tests.integration.test_session_http import http as signed_http_fixture
from tests.integration.test_session_http import rig as create_rig_fixture
from tests.integration.test_session_http import validator as pilot_validator_fixture
from tests.unit.conftest import valid_v2_doc as adaptive_definition_fixture

pytestmark = pytest.mark.integration
http = signed_http_fixture
rig = create_rig_fixture
validator = pilot_validator_fixture
valid_v2_doc = adaptive_definition_fixture
PROFILE = "riasec.mean.bounds.v2"


def configured_runtime(test_database):
    return build_runtime(Settings(_env_file=None, RUNTIME_ENVIRONMENT="demo",
        RUNTIME_DATABASE_URL=test_database.url,
        RUNTIME_INTERNAL_KEYRING=json.dumps({"http": base64.b64encode(KEY).decode()}),
        RUNTIME_CURSOR_SIGNING_KEY=base64.b64encode(b"acceptance-cursor-key-separate!!" * 2).decode()))


def counts(uow):
    with uow.begin() as session:
        return tuple(session.scalar(select(func.count()).select_from(table))
                     for table in (activities, messages, operation_outcomes, result_snapshots))


@pytest.mark.parametrize("completed", [False, True], ids=["pending-proposal-14", "completed-result-18"])
def test_restart_uses_db_pin_without_product_and_with_new_pool(http, rig, test_database, validator,
                                                              valid_v2_doc, completed):
    manifest = adaptive_capabilities()
    rig[4].agent = agent_release(content={"greeting_text": "Pinned greeting", "allowed_activity_profiles": [PROFILE]})
    rig[4].experiences[("logical-experience", PROFILE)] = experience_release(valid_v2_doc)
    request = {"idempotency_key": "acceptance-create",
               "accepted_activity_profiles": list(manifest.accepted_activity_profiles),
               "supported_blocks": [block.model_dump(mode="json") for block in manifest.supported_blocks]}
    created = call(http, rig, "POST", "/conversations", request)
    assert created.status_code == 201
    initial = created.json()["data"]
    cid = initial["conversation"]["id"]
    persistence = ActivityPersistence(rig[1], rig[4], validator, clock=rig[2])
    started = persistence.start(rig[3], cid, 0, "logical-experience", PROFILE, "acceptance-start")
    aid = started.data["activity_id"]
    rig[4].unavailable = True  # From now on, even the original source refuses all resolutions.

    state, fixture_revision = persisted_state(valid_v2_doc, completed=completed, pending=not completed)
    # Trusted question/proposal/completed storage fixtures on the activity genuinely
    # started above; these do not claim a sequence of real answers or engine output.
    with rig[1].begin() as session:
        parent = ConversationRepository().get(session, cid, "owner")
        child = ActivityRepository().get(session, cid, aid).model_copy(
            update={"state": state, "revision": fixture_revision})
        if completed:
            seed_result(session, parent, child)
        ActivityRepository().save(session, child)
        ConversationRepository().save(session, parent.model_copy(
            update={"revision": fixture_revision + 1, "display_name": state.display_name}))

    before = call(http, rig, "GET", f"/conversations/{cid}").json()["data"]
    history = call(http, rig, "GET", f"/conversations/{cid}/messages").json()["data"]
    result_paths = (f"/activities/{aid}/result", "/results/result-fixed/share-card") if completed else ()
    results = {path: call(http, rig, "GET", path).json()["data"] for path in result_paths}
    expected_counts = counts(rig[1])
    original_pool = rig[0].pool
    rig[0].dispose()
    fresh = configured_runtime(test_database)
    assert fresh is not None and fresh.engine is not rig[0] and fresh.engine.pool is not original_pool
    assert fresh.product_ready is False  # Production builder has ProductUnavailable, no fake fallback.
    fresh.verifier = CallerVerifier({"http": KEY}, rig[2])
    for service in (fresh.conversations, fresh.history, fresh.lifecycle, fresh.results):
        service.access.clock = rig[2]
    try:
        app = create_app(fresh)
        assert app is not http[0].app
        with TestClient(app) as client:
            restarted = (client, fresh)
            response = call(restarted, rig, "GET", f"/conversations/{cid}")
            assert response.status_code == 200 and response.json()["data"] == before
            view = response.json()["data"]
            assert view["agent_release_id"] == "agent-x"
            assert view["expires_at"] == initial["conversation"]["expires_at"]
            assert view["active_activity"]["id"] == aid
            assert view["active_activity"]["experience_release_id"] == "experience-x"
            assert view["revision"] == (20 if completed else 17)
            assert view["active_activity"]["revision"] == (19 if completed else 16)
            assert view["active_activity"]["progress"]["completed"] == (18 if completed else 14)
            assert len(view["active_activity"]["answers"]) == (18 if completed else 14)
            assert call(restarted, rig, "GET", f"/conversations/{cid}/messages").json()["data"] == history
            if completed:
                for path in result_paths:
                    result = call(restarted, rig, "GET", path)
                    assert result.status_code == 200 and result.json()["data"] == results[path]
                    assert result.json()["data"]["result_id"] == "result-fixed"
            else:
                assert view["active_activity"]["clarification"]["proposal_id"] == "proposal-question-4"
            # Durable create outcome still replays its original greeting after mutation/restart.
            replay = call(restarted, rig, "POST", "/conversations", request)
            assert replay.status_code == 201 and replay.json()["meta"]["replayed"] is True
            assert replay.json()["data"] == initial
            assert_error(call(restarted, rig, "POST", "/conversations", request | {
                "idempotency_key": "new-requires-product"}), 503, "SYS_UNAVAILABLE")
        assert counts(fresh.conversations.uow) == expected_counts
        with fresh.conversations.uow.begin() as session:
            restored = ConversationRepository().get(session, cid, "owner")
            assert restored.capability_snapshot == manifest
            assert ActivityRepository().get(session, cid, aid).state == state
        assert rig[4].resolve_calls == 2
    finally:
        fresh.engine.dispose()


def test_health_and_session_dependency_failures_are_distinct(http, rig, test_database):
    with TestClient(create_app(RuntimeContainer(policy=None))) as unconfigured:
        assert unconfigured.get("/health").json() == {"status": "ok"}
        assert_error(call((unconfigured, None), rig, "GET", "/conversations/missing"),
                     401, "AUTH_CALLER_CONTEXT_INVALID")
    missing_services = RuntimeContainer(policy=None, verifier=CallerVerifier({"http": KEY}, rig[2]))
    with TestClient(create_app(missing_services)) as unavailable:
        assert_error(unavailable.get("/api/v1/internal/conversations/missing"),
                     401, "AUTH_CALLER_CONTEXT_MISSING")
        authenticated = call((unavailable, missing_services), rig, "GET", "/conversations/missing")
        assert_error(authenticated, 503, "SYS_UNAVAILABLE")
        assert authenticated.json()["error"]["details"] == {"kind": "not_configured"}
        assert unavailable.get("/health").json() == {"status": "ok"}
    runtime = configured_runtime(test_database)
    assert runtime is not None and runtime.product_ready is False
    runtime.verifier = CallerVerifier({"http": KEY}, rig[2])
    runtime.conversations.access.clock = rig[2]
    try:
        with TestClient(create_app(runtime)) as client:
            assert client.get("/health").status_code == 200
            # Valid auth + live DB, but no Product delivery capability: safe 503.
            assert_error(call((client, runtime), rig, "POST", "/conversations", {"idempotency_key": "needs-product"}),
                         503, "SYS_UNAVAILABLE")
    finally:
        runtime.engine.dispose()


def test_agent_and_experience_active_x_y_rollback_x_preserve_pins_and_reuse_snapshots(http, rig, validator,
                                                                                  valid_v2_doc):
    """Catch repinning old resources, resolving on retry/read, or duplicating rollback snapshots."""
    definitions = {version: deepcopy(valid_v2_doc) for version in ("x", "y")}
    for version, definition in definitions.items():
        definition["questions"][0]["prompt"] = f"Experience {version.upper()} question"
    agents = {version: agent_release(release_id=f"agent-{version}", content={
        "greeting_text": f"Agent {version.upper()} greeting", "allowed_activity_profiles": [PROFILE]})
        for version in ("x", "y")}
    experiences = {version: experience_release(definition, release_id=f"experience-{version}")
                   for version, definition in definitions.items()}
    manifest = adaptive_capabilities()
    persistence = ActivityPersistence(rig[1], rig[4], validator, clock=rig[2])
    existing = []
    snapshots_before_rollback = None

    for index, version in enumerate(("x", "y", "x")):
        # Explicit fake active pointers model activation, then rollback to the original
        # immutable descriptors. Every positive start uses the injected pilot validator.
        rig[4].unavailable = False
        rig[4].agent = agents[version]
        rig[4].experiences[("logical-experience", PROFILE)] = experiences[version]
        request = {"idempotency_key": f"active-create-{index}",
                   "accepted_activity_profiles": list(manifest.accepted_activity_profiles),
                   "supported_blocks": [block.model_dump(mode="json") for block in manifest.supported_blocks]}
        response = call(http, rig, "POST", "/conversations", request)
        assert response.status_code == 201
        created = response.json()["data"]
        cid = created["conversation"]["id"]
        started = persistence.start(rig[3], cid, 0, "logical-experience", PROFILE, f"active-start-{index}")
        assert started.status == 201
        assert created["conversation"]["agent_release_id"] == f"agent-{version}"
        assert created["blocks"][0]["content"] == f"Agent {version.upper()} greeting"
        assert rig[4].resolve_calls == 2 * (index + 1)

        # Outage makes any accidental active resolution fail, including for X/Y
        # resources created before the pointer changed or rolled back.
        rig[4].unavailable = True
        read = call(http, rig, "GET", f"/conversations/{cid}")
        assert read.status_code == 200
        view = read.json()["data"]
        assert view["active_activity"]["id"] == started.data["activity_id"]
        assert view["active_activity"]["experience_release_id"] == f"experience-{version}"
        existing.append((version, request, created, started, view))

        for old_index, (old_version, old_request, old_created, old_started, old_view) in enumerate(existing):
            old_cid = old_created["conversation"]["id"]
            reread = call(http, rig, "GET", f"/conversations/{old_cid}")
            assert reread.status_code == 200 and reread.json()["data"] == old_view
            history = call(http, rig, "GET", f"/conversations/{old_cid}/messages")
            assert history.status_code == 200
            assert history.json()["data"]["items"][0]["blocks"] == old_created["blocks"]
            replay = call(http, rig, "POST", "/conversations", old_request)
            assert replay.status_code == 201 and replay.json()["meta"]["replayed"] is True
            assert replay.json()["data"] == old_created
            start_replay = persistence.start(rig[3], old_cid, 0, "logical-experience", PROFILE,
                                            f"active-start-{old_index}")
            assert start_replay.replayed is True and start_replay.data == old_started.data
            with rig[1].begin() as session:
                parent = ConversationRepository().get(session, old_cid, "owner")
                child = ActivityRepository().get(session, old_cid, old_started.data["activity_id"])
                assert parent.agent_snapshot.release_id == f"agent-{old_version}"
                assert child.experience_snapshot.release_id == f"experience-{old_version}"
                assert SnapshotRepository().get(session, parent.agent_snapshot).content == agents[old_version].content
                assert SnapshotRepository().get(session, child.experience_snapshot).content == definitions[old_version]
        assert rig[4].resolve_calls == 2 * (index + 1)

        with rig[1].begin() as session:
            snapshots = session.execute(select(release_snapshots).order_by(
                release_snapshots.c.kind, release_snapshots.c.release_id)).mappings().all()
            assert len(snapshots) == (2 if index == 0 else 4)
            if index == 1:
                snapshots_before_rollback = snapshots
            elif index == 2:
                # Includes content/hash/imported_at: rollback reuses both original X
                # snapshots rather than reinserting, changing, or duplicating them.
                assert snapshots == snapshots_before_rollback

    assert len({entry[2]["conversation"]["id"] for entry in existing}) == 3
    assert len({entry[3].data["activity_id"] for entry in existing}) == 3
