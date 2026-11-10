"""Shared by the nodes that call the model: settings, history window and the failure mapping."""
from dataclasses import replace

from agent_runtime.agent.model import ChatMessage, ModelReply, ModelSettings, ModelUnavailable, TextDeltaSink
from agent_runtime.workflow.nodes.base import NodeCancelled, NodeContext, NodeError


def node_settings(ctx: NodeContext, override: str | None = None, *, temperature: float | None = None,
                  max_output_tokens: int | None = None) -> ModelSettings:
    model = ctx.ports.agent.model
    if model is None:
        raise NodeError("model_unavailable", cause="not_configured")
    changes = {key: value for key, value in (("model_id", override), ("temperature", temperature),
                                             ("max_output_tokens", max_output_tokens)) if value is not None}
    return replace(model.settings(), **changes)


def history_window(ctx: NodeContext, count: int) -> list[ChatMessage]:
    limit = min(count, ctx.ports.agent.limits.history_messages)
    return list(ctx.ports.history)[-limit:] if limit else []


def invoke(ctx: NodeContext, messages: list[ChatMessage], settings: ModelSettings,
           on_text_delta: TextDeltaSink | None = None) -> ModelReply:
    reply = ctx.model.invoke(messages, (), settings, on_text_delta)
    if isinstance(reply, ModelUnavailable):
        if reply.reason == "cancelled":
            raise NodeCancelled()
        raise NodeError("model_unavailable", cause=reply.reason)
    return reply
