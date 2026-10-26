from agent_runtime.agent.catalog import render_placeholders


def test_known_placeholder_is_substituted():
    assert render_placeholders("Chào {{ display_name }}!", {"display_name": "Minh"}) == "Chào Minh!"


def test_unknown_placeholder_stays_literal():
    assert render_placeholders("Hi {{owner_id}} {{display_name}}", {"display_name": "Minh"}) == "Hi {{owner_id}} Minh"
