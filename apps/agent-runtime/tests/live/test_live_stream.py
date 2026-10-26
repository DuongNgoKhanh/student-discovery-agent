"""One streamed agent turn against real Gemini. Costs one request; never runs in CI by default."""
import json
import os
from datetime import date
from pathlib import Path

import pytest

from agent_runtime.agent.loop import TextDelta, run_agent_turn
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel
from agent_runtime.sessions.schemas.release import AgentSnapshotV1

pytestmark = [pytest.mark.live_llm,
              pytest.mark.skipif(not os.environ.get("GOOGLE_API_KEY"), reason="GOOGLE_API_KEY not set")]
ROOT = Path(__file__).resolve().parents[4]


class NoTools:
    def execute(self, name, arguments):
        return {"error": "not_available"}


def test_gemini_streams_text_and_completes():
    snapshot = AgentSnapshotV1.model_validate(json.loads(
        (ROOT / "contracts/fixtures/agent-snapshot-demo.json").read_text("utf-8")))
    deltas = []
    turn = run_agent_turn(snapshot, GeminiChatModel(os.environ["GOOGLE_API_KEY"]), NoTools(),
                          AgentContext(today=date.today()), [], "Chào bạn, bạn giúp gì được cho mình?",
                          on_event=lambda event: isinstance(event, TextDelta) and deltas.append(event.text))
    assert turn.fallback is None, turn.fallback
    assert deltas and turn.blocks and turn.blocks[0].type in {"markdown", "text"}
