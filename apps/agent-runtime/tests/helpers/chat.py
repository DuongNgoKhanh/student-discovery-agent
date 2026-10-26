"""A demo conversation wired to a FakeModel, shared by the message-turn and turn-lifecycle suites."""
import copy
import json
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import func, select

from agent_runtime.agent.model import FakeModel
from agent_runtime.evaluations.services.compatibility import PILOT_ENGINE_REGISTRY
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import conversations as conversations_table
from agent_runtime.infrastructure.db.tables import messages
from agent_runtime.sessions.schemas.activity import SupportedBlock
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.schemas.conversation import CreateConversationInput
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.responses import ResponseService
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_input import parse_message_input
from agent_runtime.sessions.services.turn_store import TurnStore
from agent_runtime.sessions.services.turns import TurnService
from tests.helpers.builders import adaptive_capabilities, agent_release, experience_release
from tests.helpers.clock import FakeClock
from tests.helpers.product import FakeProductReleaseSource
from tests.helpers.turns import NOW, PROFILE, FakeCompletionPort

ROOT = Path(__file__).resolve().parents[4]
EXPERIENCE = "logical-experience"


def _agent_content():
    content = copy.deepcopy(json.loads((ROOT / "contracts/fixtures/agent-snapshot-demo.json").read_text("utf-8")))
    start = next(tool for tool in content["tools"] if tool["name"] == "assessment.start")
    start["params"]["experiences"][0]["experience_id"] = EXPERIENCE
    return content


def build_chat(test_database, valid_v2_doc, validator) -> SimpleNamespace:
    """Caller owns ``dispose()``."""
    upgrade_database(test_database.url)
    db_engine = build_engine(test_database.url)
    uow = RuntimeUnitOfWork(db_engine)
    clock = FakeClock(NOW)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(seconds=60))
    product = FakeProductReleaseSource()
    product.agent = agent_release(content=_agent_content())
    product.experiences[(EXPERIENCE, PROFILE)] = experience_release(valid_v2_doc)
    conversations = ConversationService(uow, product, validator, policy=RuntimePolicy(environment="demo"), clock=clock)
    blocks = [*adaptive_capabilities().supported_blocks, SupportedBlock(type="markdown", schema_versions=(1,)),
              SupportedBlock(type="suggestions", schema_versions=(1,))]
    created = conversations.create(caller, CreateConversationInput(idempotency_key="create",
        accepted_activity_profiles=(PROFILE,), supported_blocks=[block.model_dump() for block in blocks]))
    model = FakeModel()
    store = TurnStore(uow, ActivityPersistence(uow, product, validator, clock=clock), conversations, clock=clock)
    responses = ResponseService(uow, clock=clock)
    service = TurnService(store, TurnHandler(PinnedAssessmentEngine(PILOT_ENGINE_REGISTRY), FakeCompletionPort()),
                          models=lambda provider: model, responses=responses)
    conversation_id = created.data["conversation"]["id"]

    def send(body, *, revision, key):
        """Free text when ``body`` is a str, else one interaction part."""
        part = {"type": "text", "text": body} if isinstance(body, str) else {"type": "interaction", **body}
        request = parse_message_input({"expected_revision": revision, "idempotency_key": key, "content": [part]})
        return service.submit(caller, conversation_id, request)

    def message_count():
        with uow.begin() as session:
            return session.scalar(select(func.count()).select_from(messages).where(
                messages.c.conversation_id == conversation_id))

    def revision():
        with uow.begin() as session:
            return session.scalar(select(conversations_table.c.revision).where(
                conversations_table.c.id == conversation_id))

    def user_message_ids():
        with uow.begin() as session:
            return list(session.scalars(select(messages.c.message_id).where(
                messages.c.conversation_id == conversation_id, messages.c.role == "user")))

    return SimpleNamespace(model=model, service=service, responses=responses, conversations=conversations,
                           caller=caller, conversation_id=conversation_id, send=send, message_count=message_count,
                           revision=revision, user_message_ids=user_message_ids, dispose=db_engine.dispose)
