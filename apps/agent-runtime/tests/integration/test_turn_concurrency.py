"""Competing turns and late writes on the real PostgreSQL parent lock."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.conversation import EndConversationInput
from agent_runtime.sessions.services.lifecycle import LifecycleService
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from tests.helpers.turns import post_turn, request_for, turn_container, turn_counts

pytestmark = pytest.mark.integration


class GatedEngine:
    """Real selector, held after preflight so both requests compute from the same captured revisions."""

    def __init__(self, engine, barrier=None, release=None, entered=None):
        self.engine, self.barrier, self.release, self.entered = engine, barrier, release, entered

    def select(self, release, answers):
        if self.entered:
            self.entered.set()
        if self.barrier:
            self.barrier.wait(timeout=10)
        if self.release:
            assert self.release.wait(timeout=10)
        return self.engine.select(release, answers)


def test_two_keys_same_revisions_one_commit_one_conflict(turn_rig):
    rig = turn_rig
    entered, release = Event(), Event()
    handler = TurnHandler(GatedEngine(rig.handler.engine, release=release, entered=entered))
    left, right = (request_for(rig, "set_name", key=key) for key in ("left", "right"))
    before = turn_counts(rig)
    with TestClient(create_app(turn_container(rig, handler=handler))) as client:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(post_turn, client, rig, left)
            assert entered.wait(timeout=10)
            overlapping = post_turn(client, rig, right)  # one active turn per conversation
            release.set()
            committed = first.result(timeout=15)
        stale = post_turn(client, rig, right)  # same stale revisions once the first turn committed
    assert (overlapping.status_code, overlapping.json()["error"]["code"]) == (409, "CONFLICT_TURN_IN_PROGRESS")
    assert committed.status_code == 200 and committed.json()["data"]["status"] == "completed"
    assert stale.status_code == 409
    failed = stale.json()
    assert failed["error"]["code"] == "CONFLICT_REVISION"
    details = failed["error"]["details"]
    assert (details["resource_kind"], details["expected_revision"], details["actual_revision"]) == (
        "conversation", 1, 2)
    assert details["conversation"]["display_name"] == "Ngân" and details["activity"]["revision"] == 1
    after = turn_counts(rig)
    assert (after["messages"] - before["messages"], after["outcomes"] - before["outcomes"]) == (2, 1)
    assert (after["conversation_revision"], after["activity_revision"]) == (2, 1)


def test_end_while_engine_runs_blocks_stale_candidate(turn_rig):
    rig = turn_rig
    entered, release = Event(), Event()
    handler = TurnHandler(GatedEngine(rig.handler.engine, release=release, entered=entered))
    request = request_for(rig, "set_name", key="late", with_activity_revision=False)
    before = turn_counts(rig)
    with TestClient(create_app(turn_container(rig, handler=handler))) as client:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(post_turn, client, rig, request)
            assert entered.wait(timeout=10)
            LifecycleService(rig.uow, clock=rig.clock).end(rig.caller, rig.conversation_id,
                EndConversationInput(expected_revision=1, idempotency_key="end"))
            release.set()
            response = future.result(timeout=15)
    data = response.json()["data"]  # past begin the guard failure is a failed Response, not an error envelope
    assert (response.status_code, data["status"], data["error"]) == (200, "failed", {"code": "CONVERSATION_ENDED"})
    after = turn_counts(rig)
    # end's acknowledgement stays in operation_outcomes; the failed Response is the only new responses row
    assert after["messages"] == before["messages"] and after["outcomes"] == before["outcomes"] + 1
    assert after["answers"] == 0
