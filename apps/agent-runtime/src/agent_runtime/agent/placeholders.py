"""Snapshot-level constants that are not tools: model providers and the persona prompt's {{placeholders}}."""
import re
from collections.abc import Mapping

SUPPORTED_MODEL_PROVIDERS = frozenset({"gemini", "openai", "vllm", "openrouter"})  # adapters: infrastructure/llm/model_registry.py
PROMPT_VARIABLES = frozenset({"display_name", "current_date"})
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def render_placeholders(text: str, values: Mapping[str, str]) -> str:
    """Substitute {{name}} placeholders whose name is in values; others stay literal."""
    return PLACEHOLDER.sub(lambda match: values.get(match.group(1), match.group(0)), text)
