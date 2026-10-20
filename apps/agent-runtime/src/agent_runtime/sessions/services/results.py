"""Read stored current projections under the parent access lock; never score."""
from pydantic import TypeAdapter, ValidationError

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.schemas.common import PositiveRevision, ServiceResponse
from agent_runtime.sessions.schemas.result import ResultView, ShareCard
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.trace import observed


def is_current_result(parent, activity, result) -> bool:
    """Shared structural check for stored current refs and result readers."""
    return (result is not None and result.validity == "valid"
        and result.result_id == activity.state.current_result_id
        and result.activity_id == activity.id
        and result.result_projection.conversation_id == parent.id
        and result.result_projection.activity_type == activity.state.type
        and result.result_projection.experience_release_id == activity.experience_snapshot.release_id
        and result.source_activity_revision <= activity.revision)


class ResultReadService:
    def __init__(self, uow, *, clock=None, trace_sink=None):
        self.trace_sink = trace_sink
        self.uow = uow
        self.access = AccessPolicy(clock=clock)
        self.activities = ActivityRepository()
        self.results = ResultRepository()

    def _current(self, session, parent, activity, expected_revision):
        if expected_revision is not None:
            try:
                TypeAdapter(PositiveRevision).validate_python(expected_revision)
            except ValidationError:
                raise RuntimeSessionError(422, "INVALID_INPUT") from None
        if activity.state.current_result_id is None:
            raise RuntimeSessionError(422, "RESULT_NOT_READY")
        result = self.results.get(session, activity.id, activity.state.current_result_id)
        if not is_current_result(parent, activity, result):
            raise RuntimeSessionError(409, "STALE_RESULT_REVISION")
        if expected_revision is not None and expected_revision != result.result_revision:
            raise RuntimeSessionError(409, "STALE_RESULT_REVISION")
        return result

    @observed("result.read")
    def read_result(self, caller: VerifiedCaller, activity_id: str,
                    expected_result_revision: int | None = None) -> ServiceResponse:
        with self.uow.begin() as session:
            conversation_id = self.activities.conversation_id(session, activity_id)
            if conversation_id is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            parent = self.access.require_read(session, caller, conversation_id)
            activity = self.activities.get(session, parent.id, activity_id)
            if activity is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            result = self._current(session, parent, activity, expected_result_revision)
            projection = ResultView.model_validate(result.result_projection.model_dump(mode="json"))
            response = ServiceResponse(status=200, data=projection.model_dump(mode="json"))
        return response

    @observed("share.read")
    def read_share_card(self, caller: VerifiedCaller, result_id: str,
                        expected_result_revision: int | None = None) -> ServiceResponse:
        with self.uow.begin() as session:
            reference = self.results.parent_reference(session, result_id)
            if reference is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            conversation_id, activity_id = reference
            parent = self.access.require_read(session, caller, conversation_id)
            activity = self.activities.get(session, parent.id, activity_id)
            if activity is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            if activity.state.current_result_id != result_id:
                raise RuntimeSessionError(409, "STALE_RESULT_REVISION")
            result = self._current(session, parent, activity, expected_result_revision)
            projection = ShareCard.model_validate(result.share_projection.model_dump(mode="json"))
            response = ServiceResponse(status=200, data=projection.model_dump(mode="json"))
        return response
