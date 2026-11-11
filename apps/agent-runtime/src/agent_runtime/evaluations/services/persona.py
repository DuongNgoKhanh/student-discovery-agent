"""Persona cases in stub mode (FR-WFL-15): every model node answers from ``llm_stubs``, so a run is deterministic.

A case is a student type with the turns it expects. The graph runs through the same executor as a debug run; the
model is never configured, so a model node without a stub falls back and the case fails (fail closed).
"""
import logging
from collections.abc import Mapping
from typing import Any

from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.workflow import PersonaCase, PersonaExpect
from agent_runtime.sessions.services.debug_runs import DebugRunService

logger = logging.getLogger(__name__)

MODEL_NODE_TYPES = frozenset({"intent_classifier", "llm", "profile_propose", "agent"})


class Mismatch(ContractModel):
    path: str  # the expectation that did not hold, e.g. persona_cases[1].turns[0].expect.path
    message: str


class CaseReport(ContractModel):
    id: str
    title: str
    mandatory: bool
    passed: bool
    mismatches: tuple[Mismatch, ...] = ()


class PersonaReport(ContractModel):
    """Only what is decided by the snapshot: no run ids, times or tokens, so two runs compare equal."""
    cases: tuple[CaseReport, ...]


def _path_message(expected: list[str], actual: list[str]) -> str:
    for step, (want, got) in enumerate(zip(expected, actual, strict=False), 1):
        if want != got:
            return f"Bước {step}: kỳ vọng node '{want}', thực tế '{got}'."
    if len(expected) > len(actual):
        return (f"Bước {len(actual) + 1}: kỳ vọng node '{expected[len(actual)]}' "
                f"nhưng lượt đã dừng sau {len(actual)} node.")
    return f"Bước {len(expected) + 1}: thực tế còn chạy node '{actual[len(expected)]}' ngoài kỳ vọng."


def _compare(at: str, expect: PersonaExpect, result: Mapping[str, Any], conv: Mapping[str, Any]) -> list[Mismatch]:
    out: list[Mismatch] = []
    if result["status"] == "fallback" and expect.status != "fallback":
        reason = result.get("fallback_reason") or "không rõ"
        out.append(Mismatch(path=at, message=f"Lượt rơi vào dự phòng ({reason}); thường do node model thiếu stub hoặc snapshot chưa cấu hình model."))
    if expect.path is not None and list(expect.path) != result["path"]:
        out.append(Mismatch(path=f"{at}.expect.path", message=_path_message(list(expect.path), result["path"])))
    shown = {block["type"] for block in result["blocks"]}
    for name in expect.blocks_present:
        if name not in shown:
            out.append(Mismatch(path=f"{at}.expect.blocks_present", message=f"Thiếu block '{name}' trong phản hồi."))
    for name in expect.blocks_absent:
        if name in shown:
            out.append(Mismatch(path=f"{at}.expect.blocks_absent", message=f"Không được có block '{name}'."))
    for key, want in expect.conv.items():
        if conv.get(key) != want:
            out.append(Mismatch(path=f"{at}.expect.conv.{key}",
                                message=f"conv.{key}: kỳ vọng {want!r}, thực tế {conv.get(key)!r}."))
    proposals = sum(1 for effect in result["effects"] if effect["kind"] == "profile_proposal")
    if expect.proposals is not None and proposals != expect.proposals:
        out.append(Mismatch(path=f"{at}.expect.proposals",
                            message=f"Số proposal: kỳ vọng {expect.proposals}, thực tế {proposals}."))
    if expect.status is not None and result["status"] != expect.status:
        out.append(Mismatch(path=f"{at}.expect.status",
                            message=f"Trạng thái: kỳ vọng {expect.status}, thực tế {result['status']}."))
    return out


class PersonaRunner:
    def __init__(self, debug: DebugRunService):
        self._debug = debug

    def run(self, snapshot: AgentSnapshotV1, content: dict) -> PersonaReport:
        defaults = {item.name: item.default for item in snapshot.workflow.variables} if snapshot.workflow else {}
        return PersonaReport(cases=tuple(self._case(content, defaults, index, case)
                                         for index, case in enumerate(snapshot.persona_cases)))

    def _case(self, content: dict, defaults: Mapping[str, Any], index: int, case: PersonaCase) -> CaseReport:
        state, conv = case.initial_state, {**defaults, **case.initial_state.conv}
        mismatches: list[Mismatch] = []
        for step, turn in enumerate(case.turns):
            at = f"persona_cases[{index}].turns[{step}]"
            request: dict[str, Any] = {"llm_stubs": turn.llm_stubs, "state": {
                "profile": state.profile, "result": state.result, "conv": conv, "activity": state.activity}}
            if turn.input.text is not None:
                request["message"] = turn.input.text
            else:
                request["interaction"] = turn.input.interaction.model_dump(exclude_none=True)
            try:
                result = self._debug.run(content, request)
            except Exception as error:  # an engine error or a bad fake state is a failed case, never a pass
                logger.error("persona case %s failed to run: %s", case.id, type(error).__name__)
                mismatches.append(Mismatch(path=at, message="Lượt không chạy được (lỗi engine hoặc trạng thái giả lập)."))
                break
            for run in result["node_runs"]:  # a wired ``error`` edge would otherwise hide a model node with no stub
                if run["type"] in MODEL_NODE_TYPES and run["node_id"] not in turn.llm_stubs:
                    mismatches.append(Mismatch(path=f"{at}.llm_stubs",
                                               message=f"Node model '{run['node_id']}' đã chạy nhưng chưa có stub."))
            for effect in result["effects"]:  # the run only proposes: conv.* is the one thing a turn hands on
                if effect["kind"] == "assign_conv":
                    conv = {**conv, effect["variable"]: effect["value"]}
            mismatches += _compare(at, turn.expect, result, conv)
        return CaseReport(id=case.id, title=case.title, mandatory=case.mandatory, passed=not mismatches,
                          mismatches=tuple(mismatches))


def stale_cases(snapshot: AgentSnapshotV1) -> list[tuple[str, str]]:
    """``(path, message)`` for expectations that name a node or variable the graph no longer has (DEC-29)."""
    if snapshot.workflow is None:
        return []
    kinds = {node.id: node.type for node in snapshot.workflow.nodes}
    declared = {variable.name for variable in snapshot.workflow.variables}
    out: list[tuple[str, str]] = []
    for index, case in enumerate(snapshot.persona_cases):
        for step, turn in enumerate(case.turns):
            at = f"persona_cases[{index}].turns[{step}]"
            for position, node_id in enumerate(turn.expect.path or ()):
                if node_id not in kinds:
                    out.append((f"{at}.expect.path[{position}]", f"Node '{node_id}' không còn trong đồ thị."))
            for node_id in turn.llm_stubs:
                if kinds.get(node_id) not in MODEL_NODE_TYPES:
                    out.append((f"{at}.llm_stubs.{node_id}", f"'{node_id}' không phải node gọi model trong đồ thị."))
            for name in turn.expect.conv:
                if name not in declared:
                    out.append((f"{at}.expect.conv.{name}", f"Biến conv.{name} chưa được khai báo."))
    return out
