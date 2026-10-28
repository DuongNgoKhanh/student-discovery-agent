import json
from pathlib import Path

import pytest

from agent_runtime.agent.validation import AgentSnapshotValidator
from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.sessions.errors import RuntimeSessionError

SEED = json.loads((Path(__file__).resolve().parents[5] / "infra/local-releases/agent.json").read_text(encoding="utf-8"))


class Bases:
    def __init__(self, found=None, error=None):
        self.found, self.error = found or {}, error

    def base_fields(self, kb_ids):
        if self.error:
            raise self.error
        return {kb: fields for kb, fields in self.found.items() if kb in kb_ids}


class Experiences:
    def __init__(self, known=("exp_riasec",), error=None):
        self.known, self.error = known, error

    def resolve_active_experience(self, environment, experience_id, algorithm_profile):
        if self.error:
            raise self.error
        if experience_id not in self.known:
            raise RuntimeSessionError(422, "EXPERIENCE_NOT_CONFIGURED")


def kb_of(content):
    tool = next(t for t in content["tools"] if t["name"] == "knowledge.search")
    return tool["params"]["knowledge_base_id"]


def start_experience(content):
    tool = next(t for t in content["tools"] if t["name"] == "assessment.start")
    return tool["params"]["experiences"][0]["experience_id"]


def validator(bases=None, experiences=None):
    return AgentSnapshotValidator(bases if bases is not None else Bases({kb_of(SEED): frozenset({"school", "major"})}),
                                  experiences or Experiences((start_experience(SEED),)), "demo")


def test_seed_config_is_valid_and_hash_matches():
    result = validator().validate(SEED)
    assert result.valid, result.issues
    assert result.content_hash == calculate_content_hash(SEED)


@pytest.mark.parametrize("patch,path,code", [
    (lambda c: c.pop("greeting_text"), "greeting_text", "missing"),
    (lambda c: c["model"].update(temperature=5), "model.temperature", "less_than_equal"),
    (lambda c: c["persona"].update(system_prompt="Chào {{ten}}"), "persona.system_prompt", "unknown_placeholder"),
    (lambda c: c["tools"].append({"name": "web.browse", "version": 1}), f"tools[{len(SEED['tools'])}]", "tool_not_declared"),
])
def test_schema_problems_map_to_field_paths(patch, path, code):
    content = json.loads(json.dumps(SEED))
    patch(content)
    issues = validator().validate(content).issues
    assert any(i.path == path and i.code == code for i in issues), issues
    assert all(i.message for i in issues)


def test_unknown_knowledge_base_and_experience_are_reported_together():
    content = json.loads(json.dumps(SEED))
    result = validator(bases=Bases({}), experiences=Experiences(())).validate(content)
    assert any(i.code == "knowledge_base_not_found" for i in result.issues), result.issues
    assert any(i.code == "experience_not_configured" for i in result.issues), result.issues
    assert result.valid is False


def test_unknown_auto_filter_field_and_display_field_are_reported():
    content = json.loads(json.dumps(SEED))
    search = next(t for t in content["tools"] if t["name"] == "knowledge.search")
    search["params"]["auto_filter_fields"] = ["school", "ghost"]
    content["tools"].append({"name": "knowledge.show", "version": 1, "params": {"display": [
        {"field": "major", "label": "Ngành"}, {"field": "source_url", "label": "Nguồn"},
        {"field": "title", "label": "Tên"}]}})
    issues = validator().validate(content).issues
    paths = {(i.path.split(".params.")[1], i.code) for i in issues}
    assert paths == {("auto_filter_fields[1]", "field_not_found"), ("display[2].field", "field_not_found")}, issues


def test_non_object_content_is_one_root_issue():
    result = validator().validate(["x"])
    assert not result.valid and result.issues[0].path == ""


def test_knowledge_database_failure_is_a_service_error_not_a_pass(caplog):
    with caplog.at_level("ERROR"), pytest.raises(RuntimeSessionError) as error:
        validator(bases=Bases(error=OSError("postgresql://user:secret@db/kb down"))).validate(SEED)
    assert error.value.status == 503
    assert "OSError" in caplog.text
    assert "secret" not in caplog.text and "postgresql" not in caplog.text


def test_release_source_outage_is_a_service_error_not_an_issue():
    down = Experiences(error=RuntimeSessionError(502, "PRODUCT_UNAVAILABLE"))
    with pytest.raises(RuntimeSessionError) as error:
        validator(experiences=down).validate(SEED)
    assert error.value.status == 503


def _issues(patch):
    content = json.loads(json.dumps(SEED))
    patch(content)
    return validator().validate(content).issues


def _vietnamese(issue):
    return any(ch in issue.message for ch in "ăâêôơưđáàảãạéèíóòúùýÁÀ") and "must" not in issue.message


def test_schema_value_errors_have_specific_codes_and_vietnamese_messages():
    cases = [
        (lambda c: c["model"].update(ref="nope/some-model"), "model", "unsupported_provider"),
        (lambda c: c["tools"].append({"name": "web.browse", "version": 1}), f"tools[{len(SEED['tools'])}]",
         "tool_not_declared"),
        (lambda c: c["persona"].update(system_prompt="Chào {{ten}}"), "persona.system_prompt", "unknown_placeholder"),
        (lambda c: c["persona"].update(system_prompt="Chào {{ten"), "persona.system_prompt", "malformed_placeholder"),
    ]
    for patch, path, code in cases:
        matches = [i for i in _issues(patch) if i.path == path and i.code == code]
        assert matches, (code, _issues(patch))
        assert _vietnamese(matches[0]), matches[0]
    unknown = next(i for i in _issues(cases[2][0]) if i.code == "unknown_placeholder")
    assert "ten" in unknown.message


def test_every_issue_message_is_vietnamese_never_english_fallback():
    def break_all(c):
        c["tools"].append(c["tools"][0])
        c["allowed_activity_profiles"] = []
    for issue in _issues(break_all):
        assert issue.message and "must" not in issue.message and "tool " not in issue.message, issue


def test_params_errors_get_per_field_paths():
    def patch(c):
        next(t for t in c["tools"] if t["name"] == "knowledge.search")["params"]["top_k"] = 99
    index = next(i for i, t in enumerate(SEED["tools"]) if t["name"] == "knowledge.search")
    issues = _issues(patch)
    assert any(i.path == f"tools[{index}].params.top_k" and i.code == "less_than_equal" and _vietnamese(i)
               for i in issues), issues
    assert not any(i.path == f"tools[{index}]" for i in issues)
