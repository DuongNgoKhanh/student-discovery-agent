"""Chatflow agent content shared by the chatflow integration suites."""
from tests.helpers.chat import _agent_content


def chatflow_content(workflow):
    content = _agent_content()  # the demo agent, with its start tool pointed at the test experience
    content.update({"mode": "chatflow", "workflow": workflow,
                    "persona_cases": [{"id": f"c{i}", "title": "x", "mandatory": True,
                                       "turns": [{"input": {"text": "hi"}}]} for i in (1, 2)]})
    return content


STAGE = {"name": "stage", "type": "enum", "values": ["welcome", "explore"], "default": "welcome"}
FLOW = {"entry": "start", "variables": [STAGE],
        "nodes": [{"id": "start", "type": "start"},
                  {"id": "begin", "type": "assign", "config": {"assignments": [{"variable": "conv.stage", "value": "explore"}]}},
                  {"id": "ask", "type": "intent_classifier", "config": {"labels": [
                      {"id": "hoi_hoc_phi", "description": "hỏi học phí"}, {"id": "lam_bai", "description": "làm bài"}]}},
                  {"id": "reply", "type": "answer", "config": {"text": "Giai đoạn {{conv.stage}}"}}],
        "edges": [{"id": "e1", "source": "start", "source_handle": "next", "target": "begin"},
                  {"id": "e2", "source": "begin", "source_handle": "next", "target": "ask"},
                  {"id": "e3", "source": "ask", "source_handle": "hoi_hoc_phi", "target": "reply"},
                  {"id": "e4", "source": "ask", "source_handle": "lam_bai", "target": "reply"},
                  {"id": "e5", "source": "ask", "source_handle": "other", "target": "reply"}]}
