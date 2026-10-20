"""A failure at any turn write rolls back every row of that turn; retry with the same key then succeeds."""
import pytest
from sqlalchemy import event, select

from agent_runtime.infrastructure.db.tables import (
    activities,
    conversations,
    messages,
    operation_outcomes,
    result_snapshots,
)
from tests.helpers.turns import biased_option, current_state, post_turn, request_for

pytestmark = pytest.mark.integration
TABLES = (conversations, activities, messages, result_snapshots, operation_outcomes)


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
        if statement.lstrip().startswith(self.fragment):
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
        prepared = rig.store.preflight(rig.caller, rig.conversation_id, request)
        if rig.handler.prepare(prepared, request).completion is not None:
            return request
        assert post_turn(client, rig, request).status_code == 200


@pytest.mark.parametrize("fragment", [
    "UPDATE execution.activities", "INSERT INTO execution.result_snapshots",
    "INSERT INTO execution.messages", "INSERT INTO execution.operation_outcomes",
])
def test_fault_after_each_write_rolls_back_whole_turn(turn_http, fragment):
    client, rig = turn_http
    request = _final_answer(client, rig)
    before = persisted(rig)
    calls = rig.completion.calls
    with Fault(rig, fragment) as fault:
        response = post_turn(client, rig, request)
    assert fault.hits == 1
    assert (response.status_code, response.json()["success"]) == (500, False)
    assert persisted(rig) == before
    retry = post_turn(client, rig, request)
    assert retry.status_code == 200 and retry.json()["meta"]["replayed"] is False
    assert retry.json()["data"]["activity"]["status"] == "completed"
    assert rig.completion.calls > calls
