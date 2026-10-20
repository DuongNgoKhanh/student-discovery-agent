"""Stored projections obey parent lifecycle and current immutable generation."""
from datetime import timedelta

import pytest
from sqlalchemy import event, select

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.tables import activities, conversations, result_snapshots
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.schemas.activity import NewMessage, PersonalityCardBlock
from agent_runtime.sessions.schemas.result import ResultSnapshotInput
from agent_runtime.sessions.services.history import HistoryCursorCodec, HistoryService
from agent_runtime.sessions.services.results import ResultReadService
from tests.helpers.builders import seed_activity, seed_conversation, seed_result
from tests.integration.test_conversation_create import NOW
from tests.integration.test_conversation_create import rig as create_rig
from tests.integration.test_conversation_create import validator as create_validator
from tests.unit.conftest import valid_v1_doc as legacy_fixture
from tests.unit.sessions.test_history_cursor import KEY

pytestmark = pytest.mark.integration
rig = create_rig
validator = create_validator
valid_v1_doc = legacy_fixture


def reader(rig):
    return ResultReadService(rig[1], clock=rig[2])


def populate(rig, definition, *, completed=True):
    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW)
        activity = seed_activity(session, parent, definition, completed=completed)
        result = seed_result(session, parent, activity) if completed else None
    return parent, activity, result


def test_projection_paths_return_closed_allowlists_without_writes(rig, valid_v1_doc):
    service = reader(rig)
    parent, activity, result = populate(rig, valid_v1_doc)
    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.upper())
    rig[4].unavailable = True
    event.listen(rig[0], "before_cursor_execute", capture)
    try:
        projection = service.read_result(rig[3], activity.id, 2)
        card = service.read_share_card(rig[3], result.result_id, 2)
    finally:
        event.remove(rig[0], "before_cursor_execute", capture)
    assert projection.status == card.status == 200
    assert projection.data == result.result_projection.model_dump(mode="json")
    assert card.data == result.share_projection.model_dump(mode="json")
    assert set(projection.data) == {"result_id", "result_revision", "validity", "schema_version",
        "conversation_id", "activity_id", "activity_type", "experience_release_id", "created_at", "data"}
    assert set(card.data) == {"schema_version", "projection_version", "result_id", "result_revision",
        "activity_id", "display_name", "house", "branding", "is_demo", "demo_label", "template_ref"}
    assert any("FOR SHARE" in sql for sql in statements)
    assert all(not sql.lstrip().startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
    assert rig[4].resolve_calls == 0


def test_missing_result_is_not_computed(rig, valid_v1_doc):
    service = reader(rig)
    _, activity, _ = populate(rig, valid_v1_doc, completed=False)
    with pytest.raises(RuntimeSessionError) as error:
        service.read_result(rig[3], activity.id)
    assert (error.value.status, error.value.code) == (422, "RESULT_NOT_READY")


def test_superseded_result_never_becomes_current(rig, valid_v1_doc):
    service = reader(rig)
    parent, activity, result = populate(rig, valid_v1_doc)
    with rig[1].begin() as session:
        ResultRepository().invalidate(session, activity.id, (result.result_id,))
        data = result.model_dump(mode="json")
        data.update(result_id="result-new", result_revision=3)
        for field in ("result_projection", "share_projection"):
            data[field].update(result_id="result-new", result_revision=3)
        replacement = ResultSnapshotInput.model_validate(data)
        ResultRepository().insert(session, replacement, NOW)
        ActivityRepository().save(session, activity.model_copy(update={
            "state": activity.state.model_copy(update={"current_result_id": "result-new"})}))
    assert service.read_result(rig[3], activity.id).data["result_id"] == "result-new"
    assert service.read_share_card(rig[3], "result-new", 3).status == 200
    with pytest.raises(RuntimeSessionError) as error:
        service.read_share_card(rig[3], result.result_id, result.result_revision)
    assert (error.value.status, error.value.code) == (409, "STALE_RESULT_REVISION")
    with rig[1].begin() as session:
        old = session.execute(select(result_snapshots).where(result_snapshots.c.result_id == result.result_id)).mappings().one()
        assert old["result_projection"] == result.result_projection.model_dump(mode="json")
        assert old["validity"] == "superseded"


def test_historical_card_is_marked_superseded_without_reviving_result(rig, valid_v1_doc):
    service = reader(rig)
    parent, activity, result = populate(rig, valid_v1_doc)
    with rig[1].begin() as session:
        MessageRepository().append(session, parent.id, 1, (NewMessage(message_id="old-card",
            role="assistant", blocks=(PersonalityCardBlock(block_id="card-block", type="personality_card",
                schema_version=1, activity_id=activity.id, result_id=result.result_id, result_revision=2,
                data=result.card_projection),)),), NOW)
        ResultRepository().invalidate(session, activity.id, (result.result_id,))
        data = result.model_dump(mode="json")
        data.update(result_id="result-new", result_revision=3)
        for field in ("result_projection", "share_projection"):
            data[field].update(result_id="result-new", result_revision=3)
        ResultRepository().insert(session, ResultSnapshotInput.model_validate(data), NOW)
        ActivityRepository().save(session, activity.model_copy(update={"state":
            activity.state.model_copy(update={"current_result_id": "result-new"})}))
    history = HistoryService(rig[1], HistoryCursorCodec(KEY), clock=rig[2])
    page = history.read(rig[3], parent.id).data
    assert page["items"][0]["content_status"] == "superseded"
    assert page["items"][0]["blocks"][0]["result_id"] == "result-fixed"
    with pytest.raises(RuntimeSessionError) as error:
        service.read_share_card(rig[3], "result-fixed", 2)
    assert error.value.code == "STALE_RESULT_REVISION"


@pytest.mark.parametrize("path", ["result", "share"])
@pytest.mark.parametrize("revision", [0, True, "2", 9007199254740992])
def test_expected_result_revision_uses_strict_safe_positive_integer(rig, valid_v1_doc, path, revision):
    service = reader(rig)
    _, activity, result = populate(rig, valid_v1_doc)
    method = service.read_result if path == "result" else service.read_share_card
    with pytest.raises(RuntimeSessionError) as error:
        method(rig[3], activity.id if path == "result" else result.result_id, revision)
    assert (error.value.status, error.value.code) == (422, "INVALID_INPUT")


@pytest.mark.parametrize("path", ["result", "share"])
@pytest.mark.parametrize("mode,want", [("ended", (410, "CONVERSATION_ENDED")),
    ("expired", (410, "CONVERSATION_EXPIRED")), ("owner", (404, "RESOURCE_NOT_FOUND")),
    ("closed-other-owner", (404, "RESOURCE_NOT_FOUND")), ("context", (401, "AUTH_REQUIRED")),
    ("stale", (409, "STALE_RESULT_REVISION"))])
def test_closed_parent_blocks_both_projection_paths(rig, valid_v1_doc, path, mode, want):
    service = reader(rig)
    parent, activity, result = populate(rig, valid_v1_doc)
    caller = rig[3]
    if mode in ("ended", "closed-other-owner"):
        with rig[1].begin() as session:
            session.execute(conversations.update().values(status="ended", ended_at=NOW))
            session.execute(result_snapshots.update().values(validity="superseded"))
    if mode == "expired":
        rig[2].set(NOW + timedelta(seconds=3600))
        caller = VerifiedCaller("owner", "sda-product-bff", rig[2].now() + timedelta(seconds=60))
    elif mode in ("owner", "closed-other-owner"):
        caller = VerifiedCaller("stranger", "sda-product-bff", NOW + timedelta(seconds=60))
    elif mode == "context":
        rig[2].set(NOW + timedelta(seconds=60))
    method = service.read_result if path == "result" else service.read_share_card
    with pytest.raises(RuntimeSessionError) as error:
        method(caller, activity.id if path == "result" else result.result_id, 999)
    assert (error.value.status, error.value.code) == want and error.value.details is None


@pytest.mark.parametrize("path", ["result", "share"])
def test_unknown_child_does_not_leak_content(rig, path):
    service = reader(rig)
    method = service.read_result if path == "result" else service.read_share_card
    with pytest.raises(RuntimeSessionError) as error:
        method(rig[3], "missing")
    assert (error.value.status, error.value.code) == (404, "RESOURCE_NOT_FOUND")


def test_general_chat_revision_does_not_invalidate_result(rig, valid_v1_doc):
    service = reader(rig)
    _, activity, result = populate(rig, valid_v1_doc)
    with rig[1].begin() as session:
        session.execute(conversations.update().values(revision=50))
        session.execute(activities.update().values(revision=49))
    assert service.read_result(rig[3], activity.id, 2).status == 200
    assert service.read_share_card(rig[3], result.result_id, 2).status == 200
