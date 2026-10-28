"""Validate an agent config exactly as the runtime will load it, plus the references it makes."""
from collections.abc import Mapping, Sequence
from typing import Protocol

from pydantic import ValidationError

from agent_runtime.agent.catalog import KnowledgeSearchParams, KnowledgeShowParams, StartAssessmentParams
from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.ports import ProductReleaseSource
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.release import AgentSnapshotV1

# Card fields read record metadata by name (agent/knowledge_tools.py `_card`). Besides the knowledge base's own
# fields only `source_url` is a meaningful built-in; `title` is not in metadata, so displaying it would be empty.
_BUILTIN_DISPLAY_FIELDS = frozenset({"source_url"})

_MESSAGES = {
    "missing": "Thiếu trường bắt buộc.",
    "extra_forbidden": "Trường không được hỗ trợ.",
    "string_too_short": "Không được để trống.",
    "string_too_long": "Nội dung quá dài.",
    "string_pattern_mismatch": "Định dạng không hợp lệ.",
    "greater_than_equal": "Giá trị quá nhỏ.",
    "less_than_equal": "Giá trị quá lớn.",
    "int_type": "Phải là số nguyên.",
    "too_long": "Quá nhiều mục.",
    "too_short": "Cần ít nhất một mục.",
    "literal_error": "Giá trị không được hỗ trợ.",
}


class KnowledgeBases(Protocol):
    def base_fields(self, kb_ids: Sequence[str]) -> Mapping[str, frozenset[str]]: ...


class Issue(ContractModel):
    path: str
    code: str
    message: str


class AgentValidationResult(ContractModel):
    valid: bool
    content_hash: str
    issues: tuple[Issue, ...]


def _path(loc: Sequence[object]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def _message(error: Mapping[str, object]) -> str:
    if error["type"] == "value_error":
        return str(error["msg"]).removeprefix("Value error, ")
    return _MESSAGES.get(str(error["type"]), str(error["msg"]))


class AgentSnapshotValidator:
    def __init__(self, knowledge: KnowledgeBases | None, experiences: ProductReleaseSource, environment: str):
        self._knowledge, self._experiences, self._environment = knowledge, experiences, environment

    def validate(self, content: object) -> AgentValidationResult:
        if not isinstance(content, dict):
            return AgentValidationResult(valid=False, content_hash="", issues=(
                Issue(path="", code="type_error", message="Cấu hình phải là một JSON object."),))
        content_hash = calculate_content_hash(content)
        try:
            snapshot = AgentSnapshotV1.model_validate(content)
        except ValidationError as error:
            issues = tuple(Issue(path=_path(e["loc"]), code=e["type"], message=_message(e)) for e in error.errors())
            return AgentValidationResult(valid=False, content_hash=content_hash, issues=issues)
        issues = self._references(snapshot)
        return AgentValidationResult(valid=not issues, content_hash=content_hash, issues=issues)

    def _references(self, snapshot: AgentSnapshotV1) -> tuple[Issue, ...]:
        issues: list[Issue] = []
        index = {binding.name: i for i, binding in enumerate(snapshot.tools)}
        start = snapshot.tool("assessment.start")
        if start:
            for k, item in enumerate(StartAssessmentParams.model_validate(start.params).experiences):
                try:
                    self._experiences.resolve_active_experience(self._environment, item.experience_id,
                                                                item.algorithm_profile)
                except RuntimeSessionError:
                    issues.append(Issue(path=f"tools[{index['assessment.start']}].params.experiences[{k}].experience_id",
                                        code="experience_not_configured",
                                        message=f"Bài khám phá '{item.experience_id}' chưa được cấu hình."))
        search = snapshot.tool("knowledge.search")
        if search:
            params = KnowledgeSearchParams.model_validate(search.params)
            if self._knowledge is None:
                raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "not_configured"})
            try:
                fields = self._knowledge.base_fields([params.knowledge_base_id])
            except Exception:
                raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "dependency_down"}) from None
            at = f"tools[{index['knowledge.search']}].params"
            known = fields.get(params.knowledge_base_id)
            if known is None:
                issues.append(Issue(path=f"{at}.knowledge_base_id", code="knowledge_base_not_found",
                                    message=f"Không tìm thấy knowledge base '{params.knowledge_base_id}'."))
            else:
                for k, name in enumerate(params.auto_filter_fields):
                    if name not in known:
                        issues.append(Issue(path=f"{at}.auto_filter_fields[{k}]", code="field_not_found",
                                            message=f"Knowledge base không có trường '{name}'."))
                show = snapshot.tool("knowledge.show")
                if show:
                    for k, item in enumerate(KnowledgeShowParams.model_validate(show.params).display):
                        if item.field not in known and item.field not in _BUILTIN_DISPLAY_FIELDS:
                            issues.append(Issue(path=f"tools[{index['knowledge.show']}].params.display[{k}].field",
                                                code="field_not_found",
                                                message=f"Knowledge base không có trường '{item.field}'."))
        return tuple(issues)
