"""The node-type catalog Studio builds its forms from (DEC-30): generated from the registry, never hand-kept."""
import json
from typing import Any

from agent_runtime.workflow import nodes as _nodes  # noqa: F401
from agent_runtime.workflow import registry

CATALOG_VERSION = "chatflow.catalog.v1"
ORDER = ("start", "if_else", "intent_classifier", "llm", "agent", "knowledge_retrieval", "tool", "profile_propose",
         "assign", "answer")
TITLES = {
    "start": ("Bắt đầu", "Điểm vào duy nhất của đồ thị."),
    "if_else": ("Rẽ nhánh", "Chọn nhánh true hoặc false theo điều kiện chỉ đọc biến."),
    "intent_classifier": ("Phân loại ý định", "Model chọn đúng một nhãn trong danh sách hoặc other."),
    "llm": ("Gọi model", "Sinh văn bản hoặc JSON từ prompt."),
    "agent": ("Agent", "Chạy vòng lặp agent với tập con tool đã bật."),
    "knowledge_retrieval": ("Truy xuất tri thức", "Tìm tài liệu trong một knowledge base, có lọc theo metadata."),
    "tool": ("Gọi tool", "Gọi trực tiếp một tool đã bật, không qua model."),
    "profile_propose": ("Đề xuất hồ sơ", "Model trích giá trị hồ sơ; server kiểm và tạo proposal, không ghi hồ sơ."),
    "assign": ("Gán biến", "Gán giá trị cho biến hội thoại conv.*."),
    "answer": ("Trả lời", "Dựng response từ template và block; kết thúc nhánh."),
}
HANDLE_SPECS: dict[str, dict[str, Any]] = {
    "start": {"static": ["next"]}, "if_else": {"static": ["true", "false"]},
    "intent_classifier": {"static": ["other", "error"], "from_config": {"array": "labels", "id_field": "id"}},
    "llm": {"static": ["success", "error"]}, "agent": {"static": ["success", "handoff", "error"]},
    "knowledge_retrieval": {"static": ["found", "empty", "error"]}, "tool": {"static": ["success", "error"]},
    "profile_propose": {"static": ["proposed", "none", "error"]}, "assign": {"static": ["next"]},
    "answer": {"static": []}}
ERROR_TYPE = {"type": "string", "enum": ["", "model_unavailable", "invalid_output", "tool_error", "kb_unavailable"]}
NAMESPACES = [
    {"name": "sys", "title": "Hệ thống", "access": "read_only", "source": "static", "variables": [
        {"name": "query", "type": "string"}, {"name": "interaction", "type": "string", "nullable": True},
        {"name": "interaction_outcome", "type": "string"}, {"name": "turn_index", "type": "number"},
        {"name": "client_blocks", "type": "string_list"}, {"name": "activity_status", "type": "string", "nullable": True}]},
    {"name": "conv", "title": "Biến hội thoại", "access": "assign_only", "source": "workflow_variables"},
    {"name": "profile", "title": "Hồ sơ học sinh", "access": "read_only", "source": "profile_catalog"},
    {"name": "result", "title": "Kết quả đánh giá", "access": "read_only", "source": "static", "variables": [
        {"name": "house_id", "type": "string", "nullable": True}, {"name": "career_groups", "type": "string_list"},
        {"name": "revision", "type": "number", "nullable": True}]},
    {"name": "node", "title": "Output của node đã chạy", "access": "read_only", "source": "node_output"}]


def _inline(schema: Any, defs: dict[str, Any]) -> Any:
    """Resolve $ref against $defs and drop pydantic's generated titles, so Studio reads one flat schema."""
    if isinstance(schema, dict):
        if "$ref" in schema:
            return _inline(defs[schema["$ref"].rsplit("/", 1)[-1]], defs)
        return {key: _inline(value, defs) for key, value in schema.items()
                if key != "$defs" and not (key == "title" and isinstance(value, str))}
    if isinstance(schema, list):
        return [_inline(item, defs) for item in schema]
    return schema


def _entry(node_type: str) -> dict[str, Any]:
    spec = registry.get(node_type)
    raw = spec.config_model.model_json_schema()
    title, description = TITLES[node_type]
    output = json.loads(json.dumps(spec.output_schema))
    if "error" in HANDLE_SPECS[node_type]["static"]:
        output["properties"] = {**output.get("properties", {}), "error_type": ERROR_TYPE}
    return {"type": node_type, "title": title, "description": description,
            "config_schema": _inline(raw, raw.get("$defs", {})), "handles": HANDLE_SPECS[node_type],
            "output_schema": output}


def node_type_catalog() -> dict[str, Any]:
    return {"catalog_version": CATALOG_VERSION, "namespaces": NAMESPACES,
            "node_types": [_entry(node_type) for node_type in ORDER]}


if __name__ == "__main__":  # regenerate the golden: python -m agent_runtime.workflow.catalog > <fixture>
    print(json.dumps(node_type_catalog(), ensure_ascii=False, indent=2))
