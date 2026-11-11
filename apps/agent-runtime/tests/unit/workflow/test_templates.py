from agent_runtime.workflow.templates import placeholders, render


def lookup_of(values):
    return values.get


def test_renders_values_and_null_becomes_empty():
    values = {"conv.stage": "explore", "profile.province": None, "sys.turn_index": 3, "conv.done": True,
              "profile.groups": ["a", "b"]}
    assert render("Giai đoạn {{conv.stage}}, tỉnh [{{ profile.province }}], lượt {{sys.turn_index}}",
                  lookup_of(values)) == "Giai đoạn explore, tỉnh [], lượt 3"
    assert render("{{conv.done}} {{profile.groups}} {{kb.title}}", lookup_of(values)) == "true a, b "


def test_inserted_values_are_data_and_never_expanded_again():
    values = {"sys.query": "{{profile.phone}} và {{conv.stage}}", "profile.phone": "0900", "conv.stage": "x"}
    assert render("Hỏi: {{sys.query}}", lookup_of(values)) == "Hỏi: {{profile.phone}} và {{conv.stage}}"


def test_text_without_a_namespace_dot_is_left_alone():
    assert render("Chào {{display_name}}!", lookup_of({})) == "Chào {{display_name}}!"


def test_placeholders_are_unique_and_ordered():
    assert placeholders("{{a.b}} {{c.d}} {{a.b}} {{x}}") == ("a.b", "c.d")
