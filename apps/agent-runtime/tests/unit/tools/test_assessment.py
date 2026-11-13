"""Assessment tools through the Toolbox: phase checks the model sees as tool errors."""
from types import SimpleNamespace

from agent_runtime.tools.kit import Answered, HandedOff, Ref, Refused, TurnWorld
from agent_runtime.tools.toolbox import Toolbox, check
from tests.unit.workflow.helpers import agent as demo_agent

CARD = {"house": {"house_id": "h1", "name": "Nhà Sáng Tạo"}, "strengths": ["sáng tạo"], "tendencies": ["tò mò"],
        "career_groups": ["Thiết kế"], "quote": "Cứ thử đi."}


def activity(status, options=("o1", "o2")):
    question = SimpleNamespace(options=[SimpleNamespace(id=o, label=o.upper()) for o in options])
    return SimpleNamespace(state=SimpleNamespace(status=status, display_name="Minh",
                                                 current_question=question if status == "in_progress" else None))


def box(status=None, result_card=None):
    view = SimpleNamespace(agent=demo_agent(), activity=activity(status) if status else None, result_card=result_card)
    return Toolbox(TurnWorld(view))


def offered_experience():
    return demo_agent().tool("assessment.start").params["experiences"][0]["experience_id"]


def test_start_hands_off_for_an_offered_experience_when_none_is_open():
    outcome = box().call("assessment.start", {"experience_id": offered_experience()})
    assert isinstance(outcome, HandedOff) and outcome.handoff.result == {"status": "started"}


def test_start_refuses_an_unknown_experience_with_the_offered_ones():
    outcome = box().call("assessment.start", {"experience_id": "nope"})
    assert outcome.error["error"] == "unknown_experience" and offered_experience() in outcome.error["available"]


def test_start_refuses_while_an_assessment_is_open():
    outcome = box("in_progress").call("assessment.start", {"experience_id": offered_experience()})
    assert outcome == Refused({"error": "assessment_in_progress", "phase": "in_progress"})


def test_set_name_only_while_collecting_and_only_a_valid_name():
    assert box("in_progress").call("assessment.set_name", {"display_name": "Minh"}) == Refused(
        {"error": "not_collecting_name", "phase": "in_progress"})
    assert box("collecting_name").call("assessment.set_name", {"display_name": "M1nh"}).error["error"] == "invalid_name"
    outcome = box("collecting_name").call("assessment.set_name", {"display_name": "Minh"})
    assert outcome.handoff.result == {"status": "saved", "display_name": "Minh"}


def test_question_tools_need_a_current_question_and_a_known_option():
    assert box("completed").call("assessment.current_question", {}) == Refused(
        {"error": "no_current_question", "phase": "completed"})
    assert box("in_progress").call("assessment.propose_answer", {"option_id": "o9"}) == Refused(
        {"error": "unknown_option", "options": ["o1", "o2"]})
    assert isinstance(box("in_progress").call("assessment.propose_answer", {"option_id": "o2"}), HandedOff)


def test_explain_reads_the_current_card_or_reports_no_result():
    assert box("in_progress").call("result.explain", {}) == Refused({"error": "no_result", "phase": "in_progress"})
    assert box("completed", CARD).call("result.explain", {}) == Answered({
        "house": "Nhà Sáng Tạo", "house_id": "h1", "strengths": ["sáng tạo"], "tendencies": ["tò mò"],
        "career_groups": ["Thiết kế"], "quote": "Cứ thử đi."})


def test_start_description_lists_the_offered_experiences():
    (definition,) = box().offer({"assessment.start"})
    assert "Các bài hiện có: " + offered_experience() in definition.description


class Ports:
    def __init__(self, *, exists=True, fields=frozenset({"school", "tuition"})):
        self.exists, self.fields = exists, fields

    def experience_exists(self, experience_id, algorithm_profile):
        return self.exists

    def kb_fields(self, kb_id):
        return self.fields


def test_start_reports_an_unconfigured_experience():
    issues = check(demo_agent(), Ports(exists=False))
    index = [b.name for b in demo_agent().tools].index("assessment.start")
    assert Ref(f"tools[{index}].params.experiences[0].experience_id", "experience_not_configured",
               f"Bài khám phá '{offered_experience()}' chưa được cấu hình.") in issues
