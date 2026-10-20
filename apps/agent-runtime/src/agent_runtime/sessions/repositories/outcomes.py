"""Owner/operation/resource-scoped durable replay; never return a mismatched request."""
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import operation_outcomes
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import (
    IdempotencyKey,
    OutcomeOperation,
    OutcomeScope,
    OwnerId,
    ServiceResponse,
)


def _identity(owner_id, operation, resource_scope, key):
    try:
        for schema, value in ((OwnerId, owner_id), (OutcomeOperation, operation),
                              (OutcomeScope, resource_scope), (IdempotencyKey, key)):
            TypeAdapter(schema).validate_python(value)
    except (ValidationError, ValueError):
        raise RuntimeSessionError(400, "INVALID_REQUEST") from None


class OutcomeRepository:
    def find(self, session: Session, owner_id: str, operation: str, resource_scope: str, key: str, *,
             request_hash: str) -> ServiceResponse | None:
        _identity(owner_id, operation, resource_scope, key)
        row = session.execute(select(operation_outcomes).where(
            operation_outcomes.c.owner_id == owner_id, operation_outcomes.c.operation == operation,
            operation_outcomes.c.resource_scope == resource_scope, operation_outcomes.c.key == key,
        )).mappings().one_or_none()
        if row is None:
            return None
        if row["request_hash"] != request_hash:
            raise RuntimeSessionError(409, "IDEMPOTENCY_KEY_COLLISION")
        return ServiceResponse(status=row["response_status"], data=row["response_data"], replayed=True)

    def save(self, session: Session, *, owner_id: str, operation: str, resource_scope: str, key: str,
             request_hash: str, conversation_id: str, response: ServiceResponse) -> None:
        _identity(owner_id, operation, resource_scope, key)
        session.execute(operation_outcomes.insert().values(owner_id=owner_id, operation=operation,
            resource_scope=resource_scope, key=key, request_hash=request_hash, conversation_id=conversation_id,
            response_status=response.status, response_data=response.model_dump(mode="json")["data"]))
