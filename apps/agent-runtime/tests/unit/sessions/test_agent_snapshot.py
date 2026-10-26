"""agent.snapshot.v1 carries the whole agent config; legacy two-field snapshots stay valid."""
import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from agent_runtime.evaluations.services.validator import ExperienceValidator, calculate_content_hash
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import CapabilitySnapshot
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.releases import validate_release
from tests.helpers.builders import agent_release

ROOT = Path(__file__).resolve().parents[5]
DEMO = json.loads((ROOT / "contracts/fixtures/agent-snapshot-demo.json").read_text(encoding="utf-8"))


def test_legacy_snapshot_gets_safe_defaults():
    snapshot = AgentSnapshotV1.model_validate({"greeting_text": "Hi", "allowed_activity_profiles": []})
    assert snapshot.model is None and snapshot.tools == ()
    assert snapshot.limits.max_tool_steps == 4 and snapshot.persona.language == "vi"
    assert "{{display_name}}" in snapshot.templates.next_question


def test_demo_snapshot_validates_through_release_import():
    release = validate_release(agent_release(content=deepcopy(DEMO)), environment="demo",
                               capabilities=CapabilitySnapshot(), validator=ExperienceValidator())
    snapshot = AgentSnapshotV1.model_validate(release.content)
    assert (snapshot.model.provider, snapshot.model.model_id) == ("gemini", "gemini-3.5-flash-lite")
    assert snapshot.tool("assessment.start").params["experiences"][0]["experience_id"] == "exp_riasec"
    assert snapshot.tool("unknown.tool") is None


def mutate(path, value):
    content = deepcopy(DEMO)
    target = content
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return content


@pytest.mark.parametrize("content", [
    mutate(("tools", 0, "name"), "shell.exec"),                                   # tool không có trong catalog
    mutate(("tools", 1, "version"), 2),                                           # version không tồn tại
    mutate(("tools", 0, "params"), {"experiences": []}),                          # params sai schema
    mutate(("tools", 0, "params", "experiences", 0, "algorithm_profile"), "x"),   # ngoài allowed_activity_profiles
    mutate(("tools", 2, "name"), "assessment.set_name"),                          # trùng tool
    mutate(("model", "ref"), "mistral/large"),                                    # provider chưa hỗ trợ
    mutate(("model", "timeout_ms"), 15000),                                       # 15s x 2 lần > turn 20s
    mutate(("persona", "system_prompt"), "Chào {{display-name}}"),                # placeholder sai cú pháp
    mutate(("templates", "next_question"), "Câu tiếp {{ }}"),                     # placeholder rỗng
    mutate(("greeting_suggestions",), ["Làm bài", "Làm bài"]),                     # gợi ý trùng
    mutate(("model", "ref"), "gemini"),                                           # sai định dạng ref
    mutate(("limits", "max_tool_steps"), 9),                                      # vượt trần
    mutate(("model", "timeout_ms"), 30001),
    mutate(("model", "timeout_ms"), 9999),                                        # Gemini cần >= 10s
    mutate(("model", "temperature"), "0.4"),                                      # strict: không nhận chuỗi
    mutate(("model", "temperature"), True),                                       # strict: không nhận bool
    mutate(("guardrails", "blocked_topics"), [f"chủ đề {i}" for i in range(21)]), # vượt 20 mục
    mutate(("persona", "system_prompt"), "Xin chào {{owner_id}}"),                # biến lạ
    mutate(("persona", "api_key"), "secret"),                                     # field lạ
])
def test_invalid_agent_config_is_rejected(content):
    with pytest.raises(ValidationError):
        AgentSnapshotV1.model_validate(content)
    # model_copy skips construction-time validation, the way an untrusted Product descriptor would arrive.
    untrusted = agent_release().model_copy(update={"content": content, "content_hash": calculate_content_hash(content)})
    with pytest.raises(RuntimeSessionError) as error:
        validate_release(untrusted, environment="demo",
                         capabilities=CapabilitySnapshot(), validator=ExperienceValidator())
    assert error.value.code == "INCOMPATIBLE_RELEASE"


def test_duplicate_experience_in_assessment_start_is_rejected():
    content = deepcopy(DEMO)
    experiences = content["tools"][0]["params"]["experiences"]
    experiences.append(dict(experiences[0], label="Bản sao"))
    with pytest.raises(ValidationError):
        AgentSnapshotV1.model_validate(content)


def test_openai_models_are_supported():
    snapshot = AgentSnapshotV1.model_validate(mutate(("model", "ref"), "openai/gpt-4.1-mini"))
    assert (snapshot.model.provider, snapshot.model.settings().model_id) == ("openai", "gpt-4.1-mini")


def test_invalid_tool_params_name_the_failing_field():
    with pytest.raises(ValidationError, match=r"experiences\.0\.label"):
        AgentSnapshotV1.model_validate(mutate(("tools", 0, "params", "experiences", 0, "label"), " "))
