from agent_runtime.agent.catalog import TOOL_DECLARATIONS
from agent_runtime.tools.registry import TOOLS, find

ORDER = ["assessment.start", "assessment.set_name", "assessment.current_question", "assessment.propose_answer",
         "result.explain", "ui.suggest_replies", "knowledge.search", "knowledge.show"]


def test_registry_declares_the_catalog_s_tools_in_order():
    assert [name for name, _ in TOOLS] == ORDER
    assert set(TOOLS) == set(TOOL_DECLARATIONS)  # removed with catalog.py in Task 5


def test_kinds_match_the_old_handoff_flags():
    for key, declaration in TOOL_DECLARATIONS.items():
        tool = TOOLS[key]
        assert (tool.kind == "handoff") == declaration.handoff
        assert tool.params is declaration.params_model and tool.arguments is declaration.arguments_model
    assert TOOLS[("ui.suggest_replies", 1)].kind == "reply"


def test_find_is_none_for_undeclared_or_malformed_keys():
    assert find("knowledge.search", 1) is TOOLS[("knowledge.search", 1)]
    assert find("knowledge.search", 2) is None and find(None, 1) is None and find("x", "1") is None
