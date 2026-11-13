from agent_runtime.tools.registry import TOOLS, find

ORDER = ["assessment.start", "assessment.set_name", "assessment.current_question", "assessment.propose_answer",
         "result.explain", "ui.suggest_replies", "knowledge.search", "knowledge.show"]


def test_registry_declares_the_catalog_s_tools_in_order():
    assert [name for name, _ in TOOLS] == ORDER


def test_handoff_tools_are_exactly_the_assessment_flow():
    assert {name for (name, _), tool in TOOLS.items() if tool.kind == "handoff"} == {
        "assessment.start", "assessment.set_name", "assessment.current_question", "assessment.propose_answer"}
    assert TOOLS[("ui.suggest_replies", 1)].kind == "reply"


def test_find_is_none_for_undeclared_or_malformed_keys():
    assert find("knowledge.search", 1) is TOOLS[("knowledge.search", 1)]
    assert find("knowledge.search", 2) is None and find(None, 1) is None and find("x", "1") is None
