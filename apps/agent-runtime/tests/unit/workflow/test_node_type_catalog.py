import json
from pathlib import Path

from agent_runtime.sessions.schemas.workflow import NODE_TYPES
from agent_runtime.workflow import registry
from agent_runtime.workflow.catalog import HANDLE_SPECS, node_type_catalog

GOLDEN = Path(__file__).resolve().parents[5] / "contracts/fixtures/workflow-node-types.json"


def test_catalog_covers_every_node_type_once_and_in_the_golden_order():
    catalog = node_type_catalog()
    assert [item["type"] for item in catalog["node_types"]] == [
        "start", "if_else", "intent_classifier", "llm", "agent", "knowledge_retrieval", "tool", "profile_propose",
        "assign", "answer"]
    assert {item["type"] for item in catalog["node_types"]} == NODE_TYPES == set(registry.REGISTRY)


def test_catalog_matches_the_golden_fixture():
    assert node_type_catalog() == json.loads(GOLDEN.read_text(encoding="utf-8"))


SAMPLES = {
    "start": {}, "if_else": {"condition": {"==": [{"var": "conv.x"}, 1]}},
    "intent_classifier": {"labels": [{"id": "a", "description": "x"}, {"id": "b", "description": "y"}]},
    "llm": {"prompt": "x"}, "agent": {}, "tool": {"tool": "assessment.start"},
    "knowledge_retrieval": {"knowledge_base_id": "kb", "query": "q"}, "profile_propose": {"fields": ["a"]},
    "assign": {"assignments": [{"variable": "conv.x", "operation": "clear"}]}, "answer": {"text": ""}}


def test_handle_specs_agree_with_what_each_node_reports_for_a_real_config():
    for node_type, spec in registry.REGISTRY.items():
        config = spec.config_model.model_validate(SAMPLES[node_type])
        expected = list(HANDLE_SPECS[node_type].get("static", ()))
        if node_type == "intent_classifier":
            expected += [label.id for label in config.labels]
        assert sorted(spec.handles(config)) == sorted(expected)


def test_x_widgets_mark_the_fields_that_need_a_custom_widget():
    by_type = {item["type"]: item["config_schema"]["properties"] for item in node_type_catalog()["node_types"]}
    assert by_type["if_else"]["condition"]["x-widget"] == "condition_builder"
    assert by_type["knowledge_retrieval"]["knowledge_base_id"]["x-widget"] == "kb_picker"
    assert by_type["tool"]["tool"]["x-widget"] == "tool_picker"
    assert by_type["agent"]["tools"]["x-widget"] == "tool_picker"


def test_new_fields_are_published_in_the_catalog():
    by_type = {item["type"]: item["config_schema"]["properties"] for item in node_type_catalog()["node_types"]}
    assert "history_messages" in by_type["intent_classifier"] and "history_messages" in by_type["llm"]
    assert "operation" in by_type["assign"]["assignments"]["items"]["properties"]
    outputs = {item["type"]: item["output_schema"]["properties"] for item in node_type_catalog()["node_types"]}
    assert "error_type" in outputs["llm"] and "error_type" in outputs["tool"]
