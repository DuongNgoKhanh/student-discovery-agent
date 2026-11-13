"""Validate an agent config exactly as the runtime will load it, plus the references it makes."""
import logging
from collections.abc import Mapping, Sequence
from typing import Protocol

from pydantic import ValidationError

from agent_runtime.evaluations.services.persona import PersonaReport, PersonaRunner, stale_cases
from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.ports import ProductReleaseSource
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.tools.registry import find
from agent_runtime.tools.toolbox import check
from agent_runtime.workflow.validator import Finding, knowledge_base_ids, validate_workflow

logger = logging.getLogger(__name__)

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


_GENERIC = "Giá trị không hợp lệ."
# Codes raised by the schema layer as PydanticCustomError (release.py, catalog.py); their English text stays there.
_CUSTOM = {
    "unsupported_provider": "Nhà cung cấp mô hình không được hỗ trợ.",
    "tool_not_declared": "Công cụ này chưa được runtime khai báo.",
    "malformed_placeholder": "Biến {{...}} trong lời nhắc sai cú pháp.",
    "duplicate_tool": "Mỗi công cụ chỉ được gắn một lần.",
    "show_requires_search": "knowledge.show cần kèm knowledge.search.",
    "timeout_exceeds_turn": "Thời gian chờ và backoff của mô hình phải nằm trong giới hạn thời gian của một lượt.",
    "profile_not_allowed": "Bài khám phá phải dùng hồ sơ hoạt động nằm trong danh sách cho phép.",
    "duplicate_items": "Các mục không được trùng nhau.",
    "unsupported_schema": "Phiên bản schema không được hỗ trợ.",
    "workflow_required": "Chế độ chatflow cần có workflow.",
    "workflow_not_allowed": "Chế độ agent không dùng workflow; đổi mode sang chatflow hoặc xóa workflow.",
    "workflow_node_type_unsupported": "Loại node này chưa được hỗ trợ trong chatflow.",
    "workflow_node_id_reserved": "Id node không được trùng không gian tên dành riêng (sys, conv, profile, result).",
    "persona_input_invalid": "Mỗi lượt cần đúng một trong text hoặc interaction.",
    "workflow_variable_invalid": "Biến hội thoại không hợp lệ: kiểu, danh sách giá trị hoặc giá trị mặc định không khớp.",
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
    # None unless a chatflow snapshot parsed, its graph is clean and the cases ran. A failing mandatory case is also an
    # issue (persona_case_failed); a failing optional one is only listed here.
    persona_report: PersonaReport | None = None
    # False for a graph-only check (personas=False): `valid` then means "the graph is sound", not "ready to publish".
    personas_checked: bool = True


def _path(loc: Sequence[object]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def _issue(error: Mapping[str, object], prefix: str = "") -> Issue:
    ctx = error.get("ctx") or {}
    # A whole-model rule names the field to fix in ctx["field"]; numeric parts are list indexes.
    field = [int(part) if part.isdigit() else part for part in str(ctx.get("field", "")).split(".") if part]
    relative = _path([*error["loc"], *field])
    path = prefix + ("." + relative if relative else "") if prefix else relative
    kind = str(error["type"])
    if kind == "unknown_placeholder":
        return Issue(path=path, code=kind, message=f"Lời nhắc dùng biến chưa hỗ trợ: {ctx.get('names', '')}.")
    if kind in _CUSTOM:
        return Issue(path=path, code=kind, message=_CUSTOM[kind])
    return Issue(path=path, code=kind, message=_MESSAGES.get(kind, _GENERIC))


def _param_issues(content: Mapping[str, object], error: ValidationError) -> list[Issue]:
    """A bad tool binding is reported per params field when the tool is declared, else as one binding issue."""
    tools = content.get("tools")
    issues: list[Issue] = []
    for item in error.errors():
        loc = item["loc"]
        if len(loc) == 2 and loc[0] == "tools" and isinstance(tools, list) and isinstance(loc[1], int):
            binding = tools[loc[1]] if loc[1] < len(tools) else None
            tool = find(binding.get("name"), binding.get("version")) if isinstance(binding, dict) else None
            if tool is not None:
                try:
                    tool.params.model_validate(binding.get("params", {}))
                except ValidationError as params_error:
                    base = f"tools[{loc[1]}].params"
                    issues.extend(_issue(e, base) for e in params_error.errors())
                    continue
        issues.append(_issue(item))
    return issues


class _RefPorts:
    """What the tool modules' reference checks read; one base_fields read per knowledge base."""

    def __init__(self, experiences: ProductReleaseSource, environment: str, base_fields):
        self._experiences, self._environment, self._base_fields = experiences, environment, base_fields
        self._fields: dict[str, frozenset[str] | None] = {}

    def experience_exists(self, experience_id: str, algorithm_profile: str | None) -> bool:
        try:
            self._experiences.resolve_active_experience(self._environment, experience_id, algorithm_profile)
        except RuntimeSessionError as error:
            if error.status >= 500:
                # Release source outage: the experience may well exist, so this is not a config issue.
                raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "dependency_down"}) from None
            return False
        return True

    def kb_fields(self, kb_id: str) -> frozenset[str] | None:
        if kb_id not in self._fields:
            known = self._base_fields([kb_id]).get(kb_id)
            self._fields[kb_id] = None if known is None else frozenset(known)
        return self._fields[kb_id]


class AgentSnapshotValidator:
    def __init__(self, knowledge: KnowledgeBases | None, experiences: ProductReleaseSource, environment: str,
                 personas: PersonaRunner | None = None):
        self._knowledge, self._experiences, self._environment = knowledge, experiences, environment
        self._personas = personas

    def validate(self, content: object, personas: bool = True) -> AgentValidationResult:
        if not isinstance(content, dict):
            return AgentValidationResult(valid=False, content_hash="", issues=(
                Issue(path="", code="type_error", message="Cấu hình phải là một JSON object."),),
                personas_checked=personas)
        content_hash = calculate_content_hash(content)
        try:
            snapshot = AgentSnapshotV1.model_validate(content)
        except ValidationError as error:
            issues = self._merge(_param_issues(content, error), self._graph(content))
            if personas:
                issues = self._merge(issues, self._insufficient(content))
            return AgentValidationResult(valid=False, content_hash=content_hash, issues=tuple(issues),
                                         personas_checked=personas)
        issues = self._merge(list(self._references(snapshot)), self._graph(content))
        broken = bool(issues)  # a broken graph makes running the cases meaningless
        if personas:  # a debug run only needs the graph: the cases are the Validate button's concern
            issues = self._merge(issues, self._insufficient(content))
            issues = self._merge(issues, [Finding(path, "persona_case_stale", message)
                                          for path, message in stale_cases(snapshot)])
        report = None
        if personas and self._personas is not None and snapshot.mode == "chatflow" and not broken:
            report = self._personas.run(snapshot, content)
            issues = self._merge(issues, self._failures(report))
        return AgentValidationResult(valid=not issues, content_hash=content_hash, issues=tuple(issues),
                                     persona_report=report, personas_checked=personas)

    @staticmethod
    def _failures(report: PersonaReport) -> list[Finding]:
        found = []
        for case in report.cases:
            if case.mandatory and not case.passed:
                first = case.mismatches[0]
                found.append(Finding(first.path, "persona_case_failed",
                                     f"Persona case '{case.title}' không đạt: {first.message}"))
        return found

    @staticmethod
    def _merge(issues: list[Issue], findings: Sequence[Finding]) -> list[Issue]:
        """One issue per (path, code): what the schema layer already said, or an earlier finding, is not repeated."""
        seen = {(item.path, item.code) for item in issues}
        merged = list(issues)
        for finding in findings:
            if (finding.path, finding.code) not in seen:
                seen.add((finding.path, finding.code))
                merged.append(Issue(path=finding.path, code=finding.code, message=finding.message))
        return merged

    def _base_fields(self, kb_ids: Sequence[str]) -> Mapping[str, frozenset[str]]:
        if self._knowledge is None:
            raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "not_configured"})
        try:
            return self._knowledge.base_fields(kb_ids)
        except Exception as error:
            # Type name only: driver messages can carry the database URL.
            logger.error("agent validation: knowledge database unavailable (%s)", type(error).__name__)
            raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "dependency_down"}) from None

    def _graph(self, content: Mapping[str, object]) -> list[Finding]:
        workflow = content.get("workflow")
        if content.get("mode") != "chatflow" or not isinstance(workflow, dict):
            return []
        ids = knowledge_base_ids(workflow)
        return validate_workflow(workflow, content, self._base_fields(ids) if ids else {})

    @staticmethod
    def _insufficient(content: Mapping[str, object]) -> list[Finding]:
        if content.get("mode") != "chatflow":
            return []
        cases = content.get("persona_cases")
        mandatory = (sum(1 for item in cases if isinstance(item, dict) and item.get("mandatory") is True)
                     if isinstance(cases, list) else 0)
        return [] if mandatory >= 2 else [Finding(
            "persona_cases", "persona_cases_insufficient", "Chatflow cần ít nhất 2 persona case bắt buộc.")]

    def _references(self, snapshot: AgentSnapshotV1) -> tuple[Issue, ...]:
        ports = _RefPorts(self._experiences, self._environment, self._base_fields)
        return tuple(Issue(path=ref.path, code=ref.code, message=ref.message) for ref in check(snapshot, ports))
