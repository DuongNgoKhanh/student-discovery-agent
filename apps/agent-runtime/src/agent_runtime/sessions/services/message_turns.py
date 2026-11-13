"""Message turns: what a turn captured (snapshot), what commit writes (plan), and the code-owned texts.

Pure; no DB access. Tools live in agent_runtime.tools; a handoff's plan comes from tools.toolbox.settle.
"""
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import uuid4

from agent_runtime.agent.model import AssistantMessage, ChatMessage, UserMessage
from agent_runtime.agent.prompt import AgentContext, AssessmentPhase
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import ActivityRecord, TextBlock, TypedBlock
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.history import MessageView
from agent_runtime.sessions.schemas.release import AgentSnapshotV1, ValidatedRelease
from agent_runtime.sessions.schemas.turn import ExplainResult
from agent_runtime.sessions.schemas.turn_execution import TurnDraft

PROPOSAL_TEXT = "Có phải ý bạn là “{label}”? Bạn bấm chọn đáp án bên dưới để xác nhận nhé."
EXPLAIN_REQUEST_TEXT = "[Hệ thống yêu cầu giải thích kết quả]"
EXPLAIN_FALLBACK = ("Thẻ **{house}** là nhóm tính cách nổi bật nhất của {name}.\n\n"
                    "**Điểm mạnh:** {strengths}.\n\n**Xu hướng:** {tendencies}.\n\n"
                    "**Nhóm ngành gợi ý:** {career_groups}.\n\n> {quote}\n\n"
                    "Bạn muốn tìm hiểu thêm về ngành nào thì cứ hỏi mình nhé!")


@dataclass(frozen=True)
class MessageSnapshot:
    """Detached state captured under the preflight parent lock; commit compares the parent revision."""
    parent: ConversationRecord
    agent: AgentSnapshotV1
    activity: ActivityRecord | None
    release: ValidatedRelease | None  # the activity's pinned experience
    result_card: Mapping[str, Any] | None  # current valid card of a completed activity
    history: tuple[MessageView, ...]
    next_result_revision: int
    today: date
    current_result: tuple[str, int] | None = None  # (result_id, result_revision) of result_card
    agent_content_hash: str | None = None  # content hash of the agent release this turn runs
    user_turns: int = 0  # committed student messages, counted in storage (the history window may be shorter)


@dataclass(frozen=True)
class StartPlan:
    release: ValidatedRelease
    experience_id: str
    algorithm_profile: str | None


@dataclass(frozen=True)
class MessagePlan:
    """What commit writes: assistant blocks plus at most one activity change."""
    blocks: tuple[TypedBlock, ...]
    start: StartPlan | None = None
    draft: TurnDraft | None = None  # set_name transition of the snapshot's activity
    conv_vars: Mapping[str, Any] | None = None  # chatflow variables after the turn; None leaves them untouched


def phase(snapshot: MessageSnapshot) -> AssessmentPhase:
    status = snapshot.activity.state.status if snapshot.activity else None
    if status in {"collecting_name", "in_progress", "completed"}:
        return status
    return "not_started"


def agent_context(snapshot: MessageSnapshot, *, explain: bool = False) -> AgentContext:
    state = snapshot.activity.state if snapshot.activity else None
    question = state.current_question if state and state.status == "in_progress" else None
    return AgentContext(today=snapshot.today, phase=phase(snapshot),
                        display_name=(state.display_name if state else None) or snapshot.parent.display_name,
                        current_question=question.model_dump(mode="json") if question else None,
                        explain_result=explain)


def _block_text(block) -> str | None:
    if block.type in {"text", "markdown"}:
        return block.content
    if block.type == "assessment_question":
        return f"[Hệ thống hiển thị câu hỏi: {block.title}]"
    if block.type == "assessment_clarification":
        return "[Hệ thống hỏi lại để xác nhận đáp án]"
    if block.type == "personality_card":
        return f"[Hệ thống hiển thị thẻ kết quả: {block.data.house.name}]"
    if block.type == "knowledge_card":
        return f"[Hệ thống hiển thị: {block.title}]"
    return None  # suggestions are UI affordances, not conversation


def interaction_summary(action: str, *, display_name: str | None = None, option_id: str | None = None) -> str:
    """The user turn a model sees for a button press: one source for history and an interaction's graph."""
    if action == "explain_result":
        return EXPLAIN_REQUEST_TEXT
    if action == "set_name":
        return f"[Học sinh nhập tên: {display_name}]"
    return f"[Học sinh chọn đáp án {option_id}]"


def chat_history(views: Sequence[MessageView]) -> list[ChatMessage]:
    """Committed messages as model context; interactions are summarised, never replayed as tool calls."""
    history: list[ChatMessage] = []
    for view in views:
        if view.role == "user":
            if view.text and view.interaction is None:
                history.append(UserMessage(view.text))
            elif view.interaction:
                history.append(UserMessage(interaction_summary(view.interaction.action, display_name=view.text,
                                                               option_id=view.interaction.option_id)))
        elif view.role == "assistant":
            parts = [text for text in map(_block_text, view.blocks) if text]
            if parts:
                history.append(AssistantMessage("\n".join(parts)))
    return history


def plain_text(content: str) -> TextBlock:
    return TextBlock(block_id=uuid4().hex, type="text", schema_version=1, content=content)


def check_explain(snapshot: MessageSnapshot, explain: ExplainResult) -> None:
    """Only the current result of a completed activity is explained, and only once."""
    activity, current = snapshot.activity, snapshot.current_result
    if (activity is None or activity.id != explain.activity_id or activity.state.status != "completed"
            or current is None or current != (explain.result_id, explain.result_revision)):
        raise RuntimeSessionError(422, "INVALID_ACTIVITY_TRANSITION")
    for view in snapshot.history:
        done = view.interaction
        if done is not None and done.action == "explain_result" and (done.result_id, done.result_revision) == current:
            raise RuntimeSessionError(422, "INVALID_ACTIVITY_TRANSITION")


def explain_fallback(card: Mapping[str, Any], display_name: str | None) -> TextBlock:
    """Card-only explanation when the model is unavailable: the student always gets one."""
    return plain_text(EXPLAIN_FALLBACK.format(house=card["house"]["name"], name=display_name or "bạn",
                                              strengths=", ".join(card["strengths"]),
                                              tendencies=", ".join(card["tendencies"]),
                                              career_groups=", ".join(card["career_groups"]), quote=card["quote"]))
