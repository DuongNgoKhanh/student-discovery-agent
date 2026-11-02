"""Core table interfaces consumed by repositories (DDL lives in Alembic)."""

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, Table, Text, text
from sqlalchemy.dialects.postgresql import JSONB

from .base import metadata


def timestamp(name: str, *, nullable: bool = False, default: bool = False) -> Column:
    return Column(name, DateTime(timezone=True), nullable=nullable,
                  server_default=text("clock_timestamp()") if default else None)


release_snapshots = Table(
    "release_snapshots", metadata,
    Column("environment", Text, primary_key=True), Column("kind", Text, primary_key=True),
    Column("release_id", Text, primary_key=True), Column("content_hash", Text, nullable=False),
    Column("content", JSONB, nullable=False), Column("delivery_schema_version", Text, nullable=False),
    Column("definition_schema_version", Text), Column("algorithm_profile", Text), Column("engine_version", Text),
    Column("is_demo", Boolean, nullable=False), timestamp("imported_at", default=True),
)

conversations = Table(
    "conversations", metadata,
    Column("id", Text, primary_key=True), Column("owner_id", Text, nullable=False),
    Column("environment", Text, nullable=False), Column("status", Text, nullable=False),
    Column("revision", BigInteger, nullable=False), Column("agent_environment", Text, nullable=False),
    Column("agent_kind", Text, nullable=False), Column("agent_release_id", Text, nullable=False),
    Column("capability_snapshot", JSONB, nullable=False), Column("display_name", Text),
    Column("active_activity_id", Text), timestamp("created_at"), timestamp("expires_at"),
    timestamp("ended_at", nullable=True), Column("content_retention_seconds", BigInteger, nullable=False),
)

activities = Table(
    "activities", metadata,
    Column("id", Text, primary_key=True), Column("conversation_id", Text, nullable=False),
    Column("experience_id", Text, nullable=False), Column("type", Text, nullable=False),
    Column("view_schema_version", Integer, nullable=False), Column("algorithm_profile", Text),
    Column("engine_version", Text, nullable=False), Column("experience_environment", Text, nullable=False),
    Column("experience_kind", Text, nullable=False), Column("experience_release_id", Text, nullable=False),
    Column("status", Text, nullable=False), Column("revision", BigInteger, nullable=False),
    Column("state_schema_version", Integer, nullable=False), Column("state", JSONB, nullable=False),
    timestamp("created_at"), timestamp("closed_at", nullable=True),
)

messages = Table(
    "messages", metadata,
    Column("message_id", Text, primary_key=True), Column("conversation_id", Text, nullable=False),
    Column("ordinal", BigInteger, nullable=False), Column("committed_conversation_revision", BigInteger, nullable=False),
    Column("turn_id", Text), Column("role", Text, nullable=False), Column("blocks", JSONB, nullable=False),
    Column("text", Text), Column("interaction", JSONB), timestamp("committed_at", default=True),
)

result_snapshots = Table(
    "result_snapshots", metadata,
    Column("result_id", Text, primary_key=True), Column("activity_id", Text, nullable=False),
    Column("result_revision", BigInteger, nullable=False), Column("source_activity_revision", BigInteger, nullable=False),
    Column("validity", Text, nullable=False), Column("result_projection", JSONB, nullable=False),
    Column("card_projection", JSONB, nullable=False), Column("share_projection", JSONB, nullable=False),
    Column("evidence", JSONB, nullable=False), timestamp("created_at", default=True),
)

operation_outcomes = Table(
    "operation_outcomes", metadata,
    Column("owner_id", Text, primary_key=True), Column("operation", Text, primary_key=True),
    Column("resource_scope", Text, primary_key=True), Column("key", Text, primary_key=True),
    Column("request_hash", Text, nullable=False), Column("conversation_id", Text, nullable=False),
    Column("response_status", Integer, nullable=False), Column("response_data", JSONB, nullable=False),
    timestamp("committed_at", default=True),
)

responses = Table(
    "responses", metadata,
    Column("id", Text, primary_key=True), Column("conversation_id", Text, nullable=False),
    Column("owner_id", Text, nullable=False), Column("idempotency_key", Text, nullable=False),
    Column("request_hash", Text, nullable=False), Column("status", Text, nullable=False),
    Column("base_revision", BigInteger, nullable=False), Column("input_message_id", Text, nullable=False),
    Column("error_code", Text), Column("response_data", JSONB, nullable=False),
    timestamp("created_at", default=True), timestamp("completed_at", nullable=True),
)

runtime_traces = Table(
    "runtime_traces", metadata,
    Column("event_id", Text, primary_key=True), Column("request_id", Text, nullable=False), Column("trace_id", Text),
    Column("conversation_id", Text), Column("activity_id", Text), Column("result_id", Text),
    Column("action", Text, nullable=False), Column("step", Text, nullable=False), Column("outcome", Text, nullable=False),
    Column("error_code", Text), Column("before_revision", BigInteger), Column("after_revision", BigInteger),
    Column("environment", Text), Column("agent_release_id", Text), Column("experience_release_id", Text),
    Column("algorithm_profile", Text), Column("engine_version", Text), Column("latency_ms", BigInteger),
    Column("provider", Text), Column("fallback", Boolean), Column("fallback_reason", Text),
    Column("agent_steps", Integer), Column("input_tokens", Integer), Column("output_tokens", Integer),
    Column("knowledge", JSONB), timestamp("timestamp", default=True),
)
