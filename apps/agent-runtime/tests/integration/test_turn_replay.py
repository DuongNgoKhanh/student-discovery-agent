"""Durable turn replay across lost responses, newer turns, restarts and closure."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import conversations
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.conversation import EndConversationInput
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.lifecycle import LifecycleService
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from agent_runtime.sessions.services.turn_store import TurnStore
from tests.helpers.turns import post_turn, request_for, signed_call, turn_container, turn_counts

pytestmark = pytest.mark.integration


class ExplodingEngine:
    def select(self, release, answers):
        raise AssertionError("replay must never run the engine")


def _expiry(rig):
    with rig.uow.begin() as session:
        return session.scalar(select(conversations.c.expires_at).where(conversations.c.id == rig.conversation_id))


def test_lost_response_replays_exact_data(turn_http):
    client, rig = turn_http
    request = request_for(rig, "set_name", key="name")
    first = post_turn(client, rig, request)
    before = turn_counts(rig)
    second = post_turn(client, rig, request)  # new signed credential, same key and payload
    assert second.status_code == first.status_code == 200
    assert second.json()["data"] == first.json()["data"]
    assert second.json()["meta"]["replayed"] is True
    assert second.json()["meta"]["request_id"] != first.json()["meta"]["request_id"]
    assert turn_counts(rig) == before


def test_old_turn_replays_after_new_turn_and_new_pool(turn_http):
    client, rig = turn_http
    name = request_for(rig, "set_name", key="name")
    saved = post_turn(client, rig, name).json()["data"]
    for key in ("a1", "a2"):
        assert post_turn(client, rig, request_for(rig, "submit_answer", key=key)).status_code == 200
    expires_at = _expiry(rig)
    url = rig.db_engine.url.render_as_string(hide_password=False)
    rig.db_engine.dispose()

    # Restart: new SQLAlchemy pool and services over the same database; Product down, engine blocked.
    rig.db_engine = build_engine(url)
    rig.uow = RuntimeUnitOfWork(rig.db_engine)
    rig.product.unavailable = True
    rig.conversations = ConversationService(rig.uow, rig.product, None, policy=rig.conversations.policy,
                                            clock=rig.clock)
    rig.activity_persistence = ActivityPersistence(rig.uow, rig.product, None, clock=rig.clock)
    rig.store = TurnStore(rig.uow, rig.activity_persistence, rig.conversations, clock=rig.clock)
    with TestClient(create_app(turn_container(rig, handler=TurnHandler(ExplodingEngine())))) as restarted:
        before = turn_counts(rig)
        replay = post_turn(restarted, rig, name)
        assert replay.status_code == 200 and replay.json()["meta"]["replayed"] is True
        assert replay.json()["data"] == saved
        current = signed_call(restarted, rig, "GET", f"/conversations/{rig.conversation_id}").json()["data"]
        assert current["revision"] == 4 and current["active_activity"]["progress"]["completed"] == 2
        assert turn_counts(rig) == before and _expiry(rig) == expires_at


def test_semantic_identity_over_http(turn_http):
    client, rig = turn_http
    body = request_for(rig, "set_name", key="name").model_dump(mode="json", exclude_unset=True)
    first = post_turn(client, rig, body)
    equivalent = dict(reversed(list(body.items()))) | {"payload": {"display_name": " Ngân "}}
    assert post_turn(client, rig, equivalent).json()["data"] == first.json()["data"]
    for change in ({"action": "submit_answer", "payload": {"question_id": "q_r_01", "option_id": "q_r_01_opt_3"}},
                   {"expected_activity_revision": 1}, {"expected_revision": 2}):
        response = post_turn(client, rig, body | change)
        assert (response.status_code, response.json()["error"]["code"]) == (409, "IDEMPOTENCY_KEY_COLLISION")
        assert response.json()["error"]["details"] is None


@pytest.mark.parametrize("closure,status,code", [("end", 410, "CONVERSATION_ENDED"),
                                                 ("expiry", 410, "CONVERSATION_EXPIRED"),
                                                 ("owner", 404, "RESOURCE_NOT_FOUND")])
def test_closed_replay_never_exposes_saved_data(turn_http, closure, status, code):
    client, rig = turn_http
    request = request_for(rig, "set_name", key="name")
    assert post_turn(client, rig, request).status_code == 200
    owner = "owner"
    if closure == "end":
        LifecycleService(rig.uow, clock=rig.clock).end(rig.caller, rig.conversation_id,
            EndConversationInput(expected_revision=2, idempotency_key="end"))
    elif closure == "expiry":
        rig.clock.set(_expiry(rig))  # exact deadline is already closed
    else:
        owner = "stranger"
    response = post_turn(client, rig, request, owner=owner)
    assert (response.status_code, response.json()["error"]["code"]) == (status, code)
    assert response.json()["data"] is None and response.json()["error"]["details"] is None
    if closure == "expiry":
        rig.clock.set(_expiry(rig) - timedelta(seconds=1))
        assert post_turn(client, rig, request).json()["meta"]["replayed"] is True
