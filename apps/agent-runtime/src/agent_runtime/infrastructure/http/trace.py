"""Transport adapter for server-generated correlation IDs only."""
from agent_runtime.sessions.trace import trace_context


def request_trace_context(meta):
    return trace_context(meta[0], meta[1])
