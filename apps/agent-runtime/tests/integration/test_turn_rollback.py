"""A failure at any turn write rolls back every row of that turn; the Response fails and a new key then succeeds."""
import pytest
from sqlalchemy import event, select

from agent_runtime.infrastructure.db.tables import (
    activities,
    conversations,
    messages,
    responses,
    result_snapshots,
)
from tests.helpers.turns import biased_option, current_state, post_turn, request_for

pytestmark = pytest.mark.integration
TABLES = (conversations, activities, messages, result_snapshots)


def persisted(rig):
    with rig.uow.begin() as session:
        return {table.name: [dict(row) for row in session.execute(select(table).order_by(*table.primary_key))
                             .mappings()] for table in TABLES}


class Fault:
    """Raise from inside the transaction right before the targeted statement reaches PostgreSQL."""

    def __init__(self, rig, fragment):
        self.rig, self.fragment, self.hits = rig, fragment, 0

    def __enter__(self):
        event.listen(self.rig.db_engine, "before_cursor_execute", self)
        return self

    def __exit__(self, *exc):
        event.remove(self.rig.db_engine, "before_cursor_execute", self)

    def __call__(self, conn, cursor, statement, parameters, context, many):
        if self.hits == 0 and statement.lstrip().startswith(self.fragment):  # once: failing the Response must work
            self.hits += 1
            raise RuntimeError("injected write fault")


def _final_answer(client, rig):
    """Drive real adaptive turns until the next answer completes the activity (fixture projector)."""
    assert post_turn(client, rig, request_for(rig, "set_name", key="name")).status_code == 200
    step = 0
    while True:
        step += 1
        question_id = current_state(rig)[2]["current_question"]["question_id"]
        request = request_for(rig, "submit_answer", key=f"a{step}", option_id=biased_option(question_id))
        probe = request_for(rig, "submit_answer", key=f"probe{step}", option_id=biased_option(question_id))
        begun = rig.store.begin(rig.caller, rig.conversation_id, probe)
        completes = rig.handler.prepare(begun.snapshot, probe).completion is not None
        rig.store.fail(begun, "PROBE")  # releases the single in-progress slot; the real key stays unused
        if completes:
            return request
        assert post_turn(client, rig, request).status_code == 200


@pytest.mark.parametrize("fragment", [
    "UPDATE execution.activities", "INSERT INTO execution.result_snapshots",
    "INSERT INTO execution.messages", "UPDATE execution.responses",
])
def test_fault_after_each_write_rolls_back_whole_turn(turn_http, fragment):
    client, rig = turn_http
    request = _final_answer(client, rig)
    before = persisted(rig)
    calls = rig.completion.calls
    with Fault(rig, fragment) as fault:
        response = post_turn(client, rig, request)
    assert fault.hits == 1
    # Past begin the fault becomes a failed Response; no turn row survives.
    data = response.json()["data"]
    assert (response.status_code, data["status"], data["error"]) == (200, "failed", {"code": "SYS_INTERNAL_ERROR"})
    assert persisted(rig) == before
    with rig.uow.begin() as session:
        row = session.execute(select(responses).where(responses.c.id == data["id"])).mappings().one()
    assert (row["status"], row["error_code"]) == ("failed", "SYS_INTERNAL_ERROR")
    replay = post_turn(client, rig, request)  # the failed Response owns its key
    assert replay.json()["meta"]["replayed"] is True and replay.json()["data"] == data
    retry = post_turn(client, rig, request_for(rig, "submit_answer", key="retry",
                                               option_id=request.payload.option_id))
    assert retry.status_code == 200 and retry.json()["meta"]["replayed"] is False
    assert retry.json()["data"]["activity"]["status"] == "completed"
    assert rig.completion.calls > calls
