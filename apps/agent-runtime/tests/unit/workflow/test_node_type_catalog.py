import json
from pathlib import Path

from agent_runtime.sessions.schemas.workflow import NODE_TYPES
from agent_runtime.workflow import registry
from agent_runtime.workflow.catalog import HANDLE_SPECS, ORDER, TITLES, node_type_catalog

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


def test_every_registered_node_type_is_in_the_hand_kept_catalog_tables():
    # A new node type must be added to ORDER, TITLES and HANDLE_SPECS (and SAMPLES below), then the golden
    # regenerated: python -m agent_runtime.workflow.catalog > contracts/fixtures/workflow-node-types.json
    registered = set(registry.REGISTRY)
    assert len(ORDER) == len(set(ORDER))
    assert set(ORDER) == registered and set(TITLES) == registered and set(HANDLE_SPECS) == registered
    assert set(SAMPLES) == registered


def test_handle_specs_agree_with_what_each_node_reports_for_a_real_config():
    for node_type, spec in registry.REGISTRY.items():
        config = spec.config_model.model_validate(SAMPLES[node_type])
        handles = HANDLE_SPECS[node_type]
        expected = list(handles.get("static", ()))
        if "from_config" in handles:  # handles named by the config, e.g. the classifier's label ids
            source = handles["from_config"]
            expected += [getattr(item, source["id_field"]) for item in getattr(config, source["array"])]
        assert sorted(spec.handles(config)) == sorted(expected), node_type


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
