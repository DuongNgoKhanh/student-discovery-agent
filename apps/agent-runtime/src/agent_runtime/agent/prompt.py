"""System messages for one agent turn: Studio persona first, then code-owned rules Studio cannot override."""
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from agent_runtime.agent.catalog import render_placeholders
from agent_runtime.agent.model import SystemMessage
from agent_runtime.sessions.schemas.release import AgentSnapshotV1

AssessmentPhase = Literal["not_started", "collecting_name", "in_progress", "completed"]


@dataclass(frozen=True)
class AgentContext:
    """What the server knows about the conversation; the model never decides these."""
    today: date
    phase: AssessmentPhase = "not_started"
    display_name: str | None = None
    current_question: Mapping[str, Any] | None = None  # {"title", "options": [{"id", "label"}]}


RULES = (
    "Quy tắc bắt buộc:\n"
    "- Luôn xưng \"mình\" và gọi học sinh là \"bạn\". Không dùng \"em\", \"thầy/cô\".\n"
    "- Chỉ nói về những việc làm được qua công cụ: làm bài khám phá tính cách, giải thích kết quả, trò chuyện "
    "về ngành nghề. Không hứa tra cứu điểm số, điểm chuẩn hay hồ sơ cá nhân.\n"
    "- Không bao giờ tự viết câu hỏi hoặc lựa chọn của bài khám phá; hệ thống tự hiển thị chúng sau khi bạn "
    "gọi công cụ.\n"
    "- Không bịa số liệu (điểm, điểm chuẩn, học phí). Không có dữ liệu từ công cụ thì nói rõ là không có.\n"
    "- Định dạng: markdown đơn giản (đậm, nghiêng, danh sách). Không dùng HTML, không chèn ảnh."
)

PHASES: dict[str, str] = {
    "not_started": "Học sinh chưa làm bài khám phá. Khi học sinh muốn làm bài, gọi assessment.start.",
    "collecting_name": ("Bài khám phá đã bắt đầu và đang chờ tên học sinh. Khi học sinh cho biết tên, gọi "
                        "assessment.set_name; nếu chưa, hỏi tên thật ngắn gọn."),
    "in_progress": ("Học sinh đang làm bài. Câu hiện tại: {question}. Nếu học sinh trả lời bằng lời, gọi "
                    "assessment.propose_answer với option_id khớp nhất. Nếu câu trả lời mơ hồ hoặc học sinh muốn "
                    "xem lại câu hỏi, viết một câu động viên ngắn rồi gọi assessment.current_question để hệ thống "
                    "hiển thị lại đủ các lựa chọn; không dùng ui.suggest_replies cho đáp án."),
    "completed": ("Học sinh đã hoàn thành bài. Khi được hỏi về kết quả, gọi result.explain và chỉ giải thích "
                  "dựa trên dữ liệu trả về."),
}


def _links_rule(allowed_domains: tuple[str, ...]) -> str:
    if not allowed_domains:
        return "- Không chèn link."
    return "- Chỉ chèn link https thuộc các domain: " + ", ".join(allowed_domains) + "."


def _phase(context: AgentContext) -> str:
    question = context.current_question
    rendered = json.dumps({"title": question["title"], "options": [
        {"option_id": option["id"], "label": option["label"]} for option in question["options"]]},
        ensure_ascii=False) if question else "không có"
    return "Trạng thái: " + PHASES[context.phase].format(question=rendered)


def system_messages(snapshot: AgentSnapshotV1, context: AgentContext) -> list[SystemMessage]:
    values = {"display_name": context.display_name or "bạn", "current_date": context.today.isoformat()}
    messages = [SystemMessage(render_placeholders(snapshot.persona.system_prompt, values)),
                SystemMessage(RULES + "\n" + _links_rule(snapshot.links.allowed_domains)),
                SystemMessage(_phase(context))]
    if context.display_name:
        # Student-supplied: quoted as data, never spliced in as an instruction.
        messages.append(SystemMessage("Tên học sinh (dữ liệu): " + json.dumps(context.display_name, ensure_ascii=False)))
    rails = snapshot.guardrails
    if rails.enabled and rails.blocked_topics:
        messages.append(SystemMessage(
            f"Không thảo luận các chủ đề: {', '.join(rails.blocked_topics)}. Nếu được hỏi về các chủ đề này, "
            f"trả lời đúng câu: \"{rails.refusal_text}\""))
    return messages
