"""Assessment tools: start the personality assessment, save the name, show or answer the current question, read
the result. A handoff tool never authors assessment content: its ``settle`` renders the next server block."""
from collections.abc import Iterator
from typing import Annotated, Any

from pydantic import Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from agent_runtime.agent.placeholders import render_placeholders
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ContractModel, NonEmptyText, OpaqueId
from agent_runtime.sessions.schemas.turn import SetNameInteraction
from agent_runtime.sessions.schemas.turn_execution import TurnDraft, TurnSnapshot
from agent_runtime.sessions.services.message_turns import PROPOSAL_TEXT, MessagePlan, StartPlan, phase, plain_text
from agent_runtime.sessions.services.turn_input import validate_display_name
from agent_runtime.sessions.services.turn_response import activity_block
from agent_runtime.tools.kit import Call, Ref, RefPorts, Settle, Tool, ToolError

OPEN_STATES = {"collecting_name", "in_progress"}


class StartExperience(ContractModel):
    experience_id: OpaqueId
    algorithm_profile: NonEmptyText
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]


class StartAssessmentParams(ContractModel):
    experiences: Annotated[tuple[StartExperience, ...], Field(min_length=1)]

    @model_validator(mode="after")
    def unique_experiences(self) -> "StartAssessmentParams":
        if len({item.experience_id for item in self.experiences}) != len(self.experiences):
            raise PydanticCustomError("duplicate_items", "experience_id must be unique", {"field": "experiences"})
        return self


# Arguments the model fills; validated before any tool runs.
class StartArguments(ContractModel):
    experience_id: OpaqueId


class SetNameArguments(ContractModel):
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=50, pattern=r"\S")]


class ProposeAnswerArguments(ContractModel):
    option_id: OpaqueId


def _start(call: Call) -> dict[str, Any]:
    offered = {item.experience_id for item in call.params.experiences}
    if call.arguments.experience_id not in offered:
        raise ToolError("unknown_experience", available=sorted(offered))
    current = phase(call.view)
    if current in OPEN_STATES:
        raise ToolError("assessment_in_progress", phase=current)
    return {"status": "started"}


def _start_detail(params: StartAssessmentParams, state: Any) -> str:
    return "Các bài hiện có: " + "; ".join(f"{item.experience_id} ({item.label})" for item in params.experiences)


def _settle_start(s: Settle) -> MessagePlan:
    chosen = next(item for item in s.params.experiences if item.experience_id == s.handoff.arguments.experience_id)
    release = s.persistence.resolve_experience(s.snapshot.parent, chosen.experience_id, chosen.algorithm_profile)
    ask = render_placeholders(s.snapshot.agent.templates.ask_name, {"display_name": "bạn"})
    return MessagePlan((*s.blocks, plain_text(ask)),
                       start=StartPlan(release, chosen.experience_id, chosen.algorithm_profile))


def _start_refs(params: StartAssessmentParams, ports: RefPorts, agent: Any) -> Iterator[Ref]:
    for k, item in enumerate(params.experiences):
        if not ports.experience_exists(item.experience_id, item.algorithm_profile):
            yield Ref(f"experiences[{k}].experience_id", "experience_not_configured",
                      f"Bài khám phá '{item.experience_id}' chưa được cấu hình.")


def _set_name(call: Call) -> dict[str, Any]:
    current = phase(call.view)
    if current != "collecting_name":
        raise ToolError("not_collecting_name", phase=current)
    try:
        return {"status": "saved", "display_name": validate_display_name(call.arguments.display_name)}
    except RuntimeSessionError:
        raise ToolError("invalid_name", rule="1-50 chữ cái và khoảng trắng, không số/emoji/ký hiệu") from None


def _settle_set_name(s: Settle) -> MessagePlan:
    snapshot, activity, request = s.snapshot, s.snapshot.activity, s.request
    interaction = SetNameInteraction(expected_revision=request.expected_revision,
                                     idempotency_key=request.idempotency_key, type="interaction",
                                     activity_id=activity.id, action="set_name",
                                     payload={"display_name": s.handoff.result["display_name"]})
    draft = s.handler.prepare(TurnSnapshot(parent=snapshot.parent, activity=activity, release=snapshot.release,
                                           next_result_revision=snapshot.next_result_revision), interaction)
    return MessagePlan((*s.blocks, activity_block(activity, draft)), draft=draft)


def _current_question(call: Call) -> dict[str, Any]:
    current = phase(call.view)
    if current != "in_progress":
        raise ToolError("no_current_question", phase=current)
    return {"status": "shown"}


def _propose_answer(call: Call) -> dict[str, Any]:
    _current_question(call)
    options = {option.id for option in call.view.activity.state.current_question.options}
    if call.arguments.option_id not in options:
        raise ToolError("unknown_option", options=sorted(options))
    return {"status": "shown"}


def _settle_shown(s: Settle) -> MessagePlan:
    activity = s.snapshot.activity
    return MessagePlan((*s.blocks, activity_block(activity, TurnDraft(next_state=activity.state))))


def _settle_proposal(s: Settle) -> MessagePlan:
    activity = s.snapshot.activity
    label = next(option.label for option in activity.state.current_question.options
                 if option.id == s.handoff.arguments.option_id)
    return MessagePlan((*s.blocks, plain_text(PROPOSAL_TEXT.format(label=label)),
                        activity_block(activity, TurnDraft(next_state=activity.state))))


def _explain(call: Call) -> dict[str, Any]:
    card = call.view.result_card
    if card is None:
        raise ToolError("no_result", phase=phase(call.view))
    return {"house": card["house"]["name"], "house_id": card["house"]["house_id"],
            "strengths": card["strengths"], "tendencies": card["tendencies"],
            "career_groups": card["career_groups"], "quote": card["quote"]}


TOOLS = (
    Tool("assessment.start", 1, "handoff", label="Bắt đầu bài khám phá",
         summary="Mở bài khám phá tính cách khi học sinh muốn làm bài.",
         description="Bắt đầu bài khám phá khi học sinh muốn làm bài.",
         params=StartAssessmentParams, arguments=StartArguments, run=_start, detail=_start_detail,
         settle=_settle_start, refs=_start_refs),
    Tool("assessment.set_name", 1, "handoff", label="Lưu tên học sinh", summary="Ghi tên học sinh trước khi làm bài.",
         description="Lưu tên học sinh khi bạn ấy cho biết tên.", arguments=SetNameArguments, run=_set_name,
         settle=_settle_set_name),
    Tool("assessment.current_question", 1, "handoff", label="Hiện lại câu hỏi",
         summary="Hiển thị lại câu hỏi đang làm.", description="Hiển thị lại câu hỏi hiện tại của bài khám phá.",
         run=_current_question, settle=_settle_shown),
    Tool("assessment.propose_answer", 1, "handoff", label="Đề xuất đáp án",
         summary="Hiểu câu trả lời tự do và hỏi lại để xác nhận.",
         description="Đề xuất đáp án cho câu hỏi hiện tại từ câu trả lời tự do của học sinh; hệ thống sẽ hỏi "
                     "lại để học sinh xác nhận. Chỉ dùng option_id có trong câu hỏi hiện tại.",
         arguments=ProposeAnswerArguments, run=_propose_answer, settle=_settle_proposal),
    Tool("result.explain", 1, "query", label="Giải thích kết quả", summary="Đọc kết quả bài khám phá để giải thích.",
         description="Lấy kết quả bài khám phá đã hoàn thành để giải thích cho học sinh.", run=_explain),
)
