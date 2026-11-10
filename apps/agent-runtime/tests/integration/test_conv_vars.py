import pytest

from agent_runtime.sessions.repositories.conversations import ConversationRepository

pytestmark = pytest.mark.integration


def test_conv_vars_default_empty_and_round_trip(turn_rig):
    repository = ConversationRepository()
    with turn_rig.uow.begin() as session:
        parent = repository.get(session, turn_rig.conversation_id, "owner", lock="write")
        assert parent.conv_vars == {}
        repository.save_conv_vars(session, parent.id, parent.owner_id, {"stage": "assessment", "offered": ["fee"]})
    with turn_rig.uow.begin() as session:
        stored = repository.get(session, turn_rig.conversation_id, "owner")
        assert stored.conv_vars == {"stage": "assessment", "offered": ["fee"]}
