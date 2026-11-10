"""Free-text message turns: the agent loop proposes, the server checks tools against captured state and renders.

Pure apart from the injected engine/Product calls in ``plan_message_turn``; no DB access. The executor only
validates a call against the preflight snapshot and records it; every state change is committed afterwards
under the parent lock by ``TurnStore.commit_message``.
"""
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import uuid4

from agent_runtime.agent.catalog import StartAssessmentParams, render_placeholders
from agent_runtime.agent.knowledge_tools import KnowledgeTools, with_cards
from agent_runtime.agent.loop import AgentTurn, Handoff
from agent_runtime.agent.model import AssistantMessage, ChatMessage, UserMessage
from agent_runtime.agent.prompt import AgentContext, AssessmentPhase
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import ActivityRecord, KnowledgeCardBlock, TextBlock, TypedBlock
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.history import MessageView
from agent_runtime.sessions.schemas.release import AgentSnapshotV1, ValidatedRelease
from agent_runtime.sessions.schemas.turn import ExplainResult, MessageTurnInput, SetNameInteraction
from agent_runtime.sessions.schemas.turn_execution import TurnDraft, TurnSnapshot
from agent_runtime.sessions.services.turn_input import validate_display_name
from agent_runtime.sessions.services.turn_response import activity_block

OPEN_STATES = {"collecting_name", "in_progress"}
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

logger = logging.getLogger(__name__)


class SnapshotToolExecutor:
    """Checks each call against the captured snapshot; results are what the model sees."""

    def __init__(self, snapshot: MessageSnapshot, knowledge: KnowledgeTools | None = None):
        self.snapshot = snapshot
        self.knowledge = knowledge

    def cards(self) -> tuple[KnowledgeCardBlock, ...]:
        return self.knowledge.cards() if self.knowledge else ()

    def execute(self, name: str, arguments: ContractModel) -> Mapping[str, Any]:
        if name in {"knowledge.search", "knowledge.show"}:
            if self.knowledge is None:
                return {"error": "knowledge_unavailable"}
            try:  # a knowledge failure never fails the turn: the model sees an error result instead
                return self.knowledge.search(arguments) if name == "knowledge.search" else self.knowledge.show(arguments)
            except Exception as error:
                logger.warning("knowledge tool %s failed: %s", name, type(error).__name__)
                return {"error": "knowledge_unavailable"}
        snapshot, current = self.snapshot, phase(self.snapshot)
        if name == "assessment.start":
            binding = snapshot.agent.tool(name)
            offered = {item.experience_id for item in StartAssessmentParams.model_validate(binding.params).experiences}
            if arguments.experience_id not in offered:
                return {"error": "unknown_experience", "available": sorted(offered)}
            if current in OPEN_STATES:
                return {"error": "assessment_in_progress", "phase": current}
            return {"status": "started"}
        if name == "assessment.set_name":
            if current != "collecting_name":
                return {"error": "not_collecting_name", "phase": current}
            try:
                return {"status": "saved", "display_name": validate_display_name(arguments.display_name)}
            except RuntimeSessionError:
                return {"error": "invalid_name", "rule": "1-50 chữ cái và khoảng trắng, không số/emoji/ký hiệu"}
        if name in {"assessment.current_question", "assessment.propose_answer"}:
            if current != "in_progress":
                return {"error": "no_current_question", "phase": current}
            if name == "assessment.propose_answer":
                options = {option.id for option in snapshot.activity.state.current_question.options}
                if arguments.option_id not in options:
                    return {"error": "unknown_option", "options": sorted(options)}
            return {"status": "shown"}
        if name == "result.explain":
            if snapshot.result_card is None:
                return {"error": "no_result", "phase": current}
            card = snapshot.result_card
            return {"house": card["house"]["name"], "house_id": card["house"]["house_id"],
                    "strengths": card["strengths"], "tendencies": card["tendencies"],
                    "career_groups": card["career_groups"], "quote": card["quote"]}
        return {"error": "unsupported_tool"}


def _text(content: str) -> TextBlock:
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
    return _text(EXPLAIN_FALLBACK.format(house=card["house"]["name"], name=display_name or "bạn",
                                         strengths=", ".join(card["strengths"]),
                                         tendencies=", ".join(card["tendencies"]),
                                         career_groups=", ".join(card["career_groups"]), quote=card["quote"]))


def plan_message_turn(snapshot: MessageSnapshot, turn: AgentTurn, request: MessageTurnInput, *,
                      handler, persistence, cards: tuple[KnowledgeCardBlock, ...] = ()) -> MessagePlan:
    """Turn an agent turn into server blocks and one activity change. Engine/Product calls run here,
    outside any transaction; ``handler`` is the TurnHandler, ``persistence`` the ActivityPersistence."""
    if getattr(request, "explain", None) is not None and turn.fallback is not None:
        return MessagePlan((explain_fallback(snapshot.result_card, snapshot.activity.state.display_name),))
    # A template fallback has no lead-in from the model, so cards would stand alone out of context.
    blocks = with_cards(turn.blocks, cards if turn.fallback is None else ())
    return plan_handoff(snapshot, turn.handoff, blocks, request, handler=handler, persistence=persistence)


def plan_handoff(snapshot: MessageSnapshot, handoff: Handoff | None, blocks: tuple[TypedBlock, ...],
                 request: MessageTurnInput, *, handler, persistence) -> MessagePlan:
    """The activity change a tool handoff asks for, rendered after the agent's own blocks."""
    if handoff is None:
        return MessagePlan(blocks)
    agent, activity = snapshot.agent, snapshot.activity
    if handoff.name == "assessment.start":
        binding = StartAssessmentParams.model_validate(agent.tool(handoff.name).params)
        chosen = next(item for item in binding.experiences if item.experience_id == handoff.arguments.experience_id)
        release = persistence.resolve_experience(snapshot.parent, chosen.experience_id, chosen.algorithm_profile)
        ask = render_placeholders(agent.templates.ask_name, {"display_name": "bạn"})
        return MessagePlan((*blocks, _text(ask)),
                           start=StartPlan(release, chosen.experience_id, chosen.algorithm_profile))
    if handoff.name == "assessment.set_name":
        interaction = SetNameInteraction(expected_revision=request.expected_revision,
            idempotency_key=request.idempotency_key, type="interaction", activity_id=activity.id,
            action="set_name", payload={"display_name": handoff.result["display_name"]})
        draft = handler.prepare(TurnSnapshot(parent=snapshot.parent, activity=activity, release=snapshot.release,
                                             next_result_revision=snapshot.next_result_revision), interaction)
        return MessagePlan((*blocks, activity_block(activity, draft)), draft=draft)
    shown = activity_block(activity, TurnDraft(next_state=activity.state))
    if handoff.name == "assessment.propose_answer":
        label = next(option.label for option in activity.state.current_question.options
                     if option.id == handoff.arguments.option_id)
        return MessagePlan((*blocks, _text(PROPOSAL_TEXT.format(label=label)), shown))
    return MessagePlan((*blocks, shown))
