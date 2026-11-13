"""The Studio tool picker reads contracts/fixtures/agent-tool-catalog.json; the runtime generates it."""
import json

from agent_runtime.tools.catalog import FIXTURE, catalog_document


def test_fixture_is_what_the_registry_generates():
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == catalog_document(), (
        "run: python -m agent_runtime.tools.catalog")


def test_entries_carry_what_studio_renders():
    search = next(item for item in catalog_document()["tools"] if item["name"] == "knowledge.search")
    assert search["kind"] == "query" and search["editor"] == "knowledge.search" and search["has_params"]
    assert search["params_schema"]["properties"]["auto_filter_fields"]["maxItems"] == 10
    explain = next(item for item in catalog_document()["tools"] if item["name"] == "result.explain")
    assert (explain["editor"], explain["has_params"], explain["params_schema"]) == ("none", False, None)
