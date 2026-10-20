"""Catch lost constraints, broad grants, mutable snapshots and split commits on real PostgreSQL."""

import importlib
import os
import subprocess
import sys
from datetime import datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

pytestmark = pytest.mark.integration


def infrastructure(database):
    migrate = importlib.import_module("agent_runtime.infrastructure.db.migrate")
    session = importlib.import_module("agent_runtime.infrastructure.db.session")
    migrate.upgrade_database(database.url)
    return session.build_engine(database.url), session.RuntimeUnitOfWork


def seed(session):
    session.execute(text("""
        INSERT INTO execution.release_snapshots
            (environment, kind, release_id, content_hash, content, delivery_schema_version, is_demo,
             definition_schema_version, engine_version)
        VALUES ('demo', 'agent', 'agent-1', :hash, '{}', 'agent.snapshot.v1', true, NULL, NULL),
               ('demo', 'experience', 'experience-1', :hash, '{}', 'experience.snapshot.v1', true, '1.0', 'engine-1')
    """), {"hash": "sha256:" + "a" * 64})
    for conversation in ("conversation-1", "conversation-2"):
        session.execute(text("""
            INSERT INTO execution.conversations
                (id, owner_id, environment, status, revision, agent_environment, agent_kind, agent_release_id,
                 capability_snapshot, created_at, expires_at, content_retention_seconds)
            VALUES (:id, 'owner-1', 'demo', 'active', 0, 'demo', 'agent', 'agent-1', '{}',
                    '2026-10-20 00:00:00+00', '2026-10-20 01:00:00+00', 86400)
        """), {"id": conversation})
    for index in (1, 2):
        session.execute(text("""
            INSERT INTO execution.activities
                (id, conversation_id, experience_id, type, view_schema_version, engine_version,
                 experience_environment, experience_kind, experience_release_id, status, revision,
                 state_schema_version, state, created_at)
            VALUES (:id, :conversation, 'experience', 'personality_assessment', 1, 'engine-1',
                    'demo', 'experience', 'experience-1', 'collecting_name', 0, 1, '{}',
                    '2026-10-20 00:00:00+00')
        """), {"id": f"activity-{index}", "conversation": f"conversation-{index}"})


def seed_result(session, result_id="result-1", activity_id="activity-1"):
    session.execute(text("""
        INSERT INTO execution.result_snapshots
            (result_id, activity_id, result_revision, source_activity_revision, validity,
             result_projection, card_projection, share_projection)
        VALUES (:result, :activity, 1, 1, 'valid', '{}', '{}', '{}')
    """), {"result": result_id, "activity": activity_id})


def test_migration_is_repeatable_and_isolated(test_database):
    engine, uow = infrastructure(test_database)
    try:
        with uow(engine).begin() as session:
            seed(session)
        importlib.import_module("agent_runtime.infrastructure.db.migrate").upgrade_database(test_database.url)
        with engine.connect() as connection:
            assert connection.execute(text("SELECT value FROM product.sentinel")).scalar_one() == "preserve me"
            assert connection.execute(text("SELECT count(*) FROM execution.conversations")).scalar_one() == 2
            assert connection.execute(text("SELECT version_num FROM execution.alembic_version")).scalar_one() == (
                "0001_session_persistence"
            )
            assert connection.execute(text("SELECT to_regclass('public.alembic_version')")).scalar_one() is None
    finally:
        engine.dispose()


def test_runtime_role_cannot_touch_product_or_mutate_release(test_database):
    engine, uow = infrastructure(test_database)
    grants = importlib.import_module("agent_runtime.infrastructure.db.grants")
    try:
        with uow(engine).begin() as session:
            seed(session)
        with engine.begin() as connection:
            grants.grant_execution_roles(connection, test_database.runtime_role, test_database.cleanup_role)
        denied = [
            "SELECT * FROM product.sentinel", "UPDATE product.sentinel SET value = 'bad'",
            "UPDATE execution.release_snapshots SET content = '{\"bad\":true}'",
            "DELETE FROM execution.release_snapshots", "CREATE TABLE execution.bad (id text)",
            "UPDATE execution.alembic_version SET version_num = 'bad'",
        ]
        for statement in denied:
            with pytest.raises(DBAPIError) as denied_error:
                with engine.begin() as connection:
                    connection.exec_driver_sql(f'SET LOCAL ROLE "{test_database.runtime_role}"')
                    connection.exec_driver_sql(statement)
            assert denied_error.value.orig.sqlstate == "42501"
        with engine.begin() as connection:
            connection.exec_driver_sql(f'SET LOCAL ROLE "{test_database.runtime_role}"')
            assert connection.execute(text("SELECT count(*) FROM execution.release_snapshots")).scalar_one() == 2
            connection.execute(text("UPDATE execution.conversations SET revision = 1 WHERE id = 'conversation-1'"))
            connection.execute(text("""
                INSERT INTO execution.release_snapshots
                    (environment, kind, release_id, content_hash, content, delivery_schema_version, is_demo)
                VALUES ('demo', 'agent', 'agent-2', :hash, '{}', 'agent.snapshot.v1', true)
            """), {"hash": "sha256:" + "b" * 64})
        # Even the migration/table owner cannot bypass snapshot immutability accidentally.
        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                connection.execute(text("UPDATE execution.release_snapshots SET is_demo = false"))
    finally:
        engine.dispose()


@pytest.mark.parametrize("statement", [
    "UPDATE execution.conversations SET revision = -1 WHERE id = 'conversation-1'",
    "UPDATE execution.conversations SET revision = 9007199254740992 WHERE id = 'conversation-1'",
    "UPDATE execution.activities SET revision = -1 WHERE id = 'activity-1'",
    "UPDATE execution.conversations SET content_retention_seconds = -1 WHERE id = 'conversation-1'",
    "UPDATE execution.conversations SET expires_at = created_at WHERE id = 'conversation-1'",
    "UPDATE execution.conversations SET agent_release_id = 'missing' WHERE id = 'conversation-1'",
    "UPDATE execution.conversations SET active_activity_id = 'activity-2' WHERE id = 'conversation-1'",
    "UPDATE execution.activities SET state = '{\"current_result_id\":\"missing\"}' WHERE id = 'activity-1'",
    """INSERT INTO execution.activities SELECT 'another-activity', conversation_id, experience_id, type,
         view_schema_version, algorithm_profile, engine_version, experience_environment, experience_kind,
         experience_release_id, status, revision, state_schema_version, state, created_at, closed_at
         FROM execution.activities WHERE id = 'activity-1'""",
])
def test_fk_and_revision_constraints(test_database, statement):
    engine, uow = infrastructure(test_database)
    try:
        with uow(engine).begin() as session:
            seed(session)
        with pytest.raises(IntegrityError):
            with uow(engine).begin() as session:
                session.execute(text(statement))
    finally:
        engine.dispose()


def test_mutable_state_and_outcome_rollback_together(test_database):
    engine, uow = infrastructure(test_database)
    try:
        with uow(engine).begin() as session:
            seed(session)
        with pytest.raises(RuntimeError, match="abort"):
            with uow(engine).begin() as session:
                session.execute(text("UPDATE execution.activities SET revision = 1 WHERE id = 'activity-1'"))
                session.execute(text("""
                    INSERT INTO execution.operation_outcomes
                        (owner_id, operation, resource_scope, key, request_hash, conversation_id,
                         response_status, response_data)
                    VALUES ('owner-1', 'end', 'conversation-1', 'key-1', :hash, 'conversation-1', 200, '{}')
                """), {"hash": "sha256:" + "c" * 64})
                raise RuntimeError("abort")
        with uow(engine).begin() as session:
            assert session.execute(text("SELECT revision FROM execution.activities WHERE id = 'activity-1'")).scalar_one() == 0
            assert session.execute(text("SELECT count(*) FROM execution.operation_outcomes")).scalar_one() == 0
    finally:
        engine.dispose()


def test_database_clock_is_fresh_inside_transaction(test_database):
    engine, uow = infrastructure(test_database)
    clock = importlib.import_module("agent_runtime.infrastructure.db.session").DatabaseClock()
    try:
        with uow(engine).begin() as session:
            first = clock.now(session)
            session.execute(text("SELECT pg_sleep(0.02)"))
            second = clock.now(session)
            assert second > first
            assert first.tzinfo is not None and first.utcoffset().total_seconds() == 0
            assert isinstance(second, datetime)
    finally:
        engine.dispose()


def test_deferred_references_use_final_rows_and_allow_cascaded_deletion(test_database):
    engine, uow = infrastructure(test_database)
    try:
        with uow(engine).begin() as session:
            seed(session)
            # Both references are temporarily invalid, then resolved before commit.
            session.execute(text("UPDATE execution.conversations SET active_activity_id = 'pending' WHERE id = 'conversation-1'"))
            session.execute(text("UPDATE execution.conversations SET active_activity_id = 'activity-1' WHERE id = 'conversation-1'"))
            session.execute(text("""UPDATE execution.activities SET state = '{"current_result_id":"result-1"}'
                                    WHERE id = 'activity-1'"""))
            seed_result(session)
        with uow(engine).begin() as session:
            session.execute(text("DELETE FROM execution.conversations WHERE id = 'conversation-1'"))
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM execution.activities WHERE id = 'activity-1'")).scalar_one() == 0
            assert connection.execute(text("SELECT count(*) FROM execution.result_snapshots")).scalar_one() == 0
            assert connection.execute(text("SELECT count(*) FROM execution.release_snapshots")).scalar_one() == 2
            assert connection.execute(text("SELECT value FROM product.sentinel")).scalar_one() == "preserve me"
        # Deferred trigger events also skip parent/child rows inserted and deleted in the same transaction.
        with uow(engine).begin() as session:
            session.execute(text("UPDATE execution.conversations SET active_activity_id = 'activity-2' WHERE id = 'conversation-2'"))
            session.execute(text("""UPDATE execution.activities SET state = '{"current_result_id":"result-2"}'
                                    WHERE id = 'activity-2'"""))
            seed_result(session, "result-2", "activity-2")
            session.execute(text("DELETE FROM execution.conversations WHERE id = 'conversation-2'"))
    finally:
        engine.dispose()


@pytest.mark.parametrize("statement", [
    """UPDATE execution.activities SET state = '{"current_result_id":"result-1"}' WHERE id = 'activity-2'""",
    "DELETE FROM execution.result_snapshots WHERE result_id = 'result-1'",
    """UPDATE execution.activities SET conversation_id = 'conversation-2' WHERE id = 'activity-1'""",
])
def test_cross_parent_links_and_orphaning_current_result_are_rejected(test_database, statement):
    engine, uow = infrastructure(test_database)
    try:
        with uow(engine).begin() as session:
            seed(session)
            seed_result(session)
            session.execute(text("UPDATE execution.activities SET status = 'completed'"))
            session.execute(text("UPDATE execution.conversations SET active_activity_id = 'activity-1' WHERE id = 'conversation-1'"))
            session.execute(text("""UPDATE execution.activities SET state = '{"current_result_id":"result-1"}'
                                    WHERE id = 'activity-1'"""))
        with pytest.raises(IntegrityError) as error:
            with uow(engine).begin() as session:
                session.execute(text(statement))
        assert error.value.orig.sqlstate == "23503"
    finally:
        engine.dispose()


def test_result_generations_are_immutable_but_validity_can_change(test_database):
    engine, uow = infrastructure(test_database)
    try:
        with uow(engine).begin() as session:
            seed(session)
            seed_result(session)
        with uow(engine).begin() as session:
            session.execute(text("UPDATE execution.result_snapshots SET validity = 'superseded'"))
        with pytest.raises(IntegrityError) as error:
            with uow(engine).begin() as session:
                session.execute(text("UPDATE execution.result_snapshots SET card_projection = '{\"changed\": true}'"))
        assert error.value.orig.sqlstate == "23514"
        with engine.connect() as connection:
            assert connection.execute(text("SELECT validity FROM execution.result_snapshots")).scalar_one() == "superseded"
    finally:
        engine.dispose()


def test_cleanup_role_can_purge_content_and_keeps_independent_traces(test_database):
    engine, uow = infrastructure(test_database)
    grants = importlib.import_module("agent_runtime.infrastructure.db.grants")
    try:
        with uow(engine).begin() as session:
            seed(session)
            seed_result(session)
            session.execute(text("UPDATE execution.conversations SET active_activity_id = 'activity-1' WHERE id = 'conversation-1'"))
            session.execute(text("""UPDATE execution.activities SET state = '{"current_result_id":"result-1"}'
                                    WHERE id = 'activity-1'"""))
            session.execute(text("""INSERT INTO execution.runtime_traces (event_id, request_id, conversation_id, action, step, outcome)
                                    VALUES ('event-1', 'request-1', 'conversation-1', 'create', 'commit', 'success')"""))
        with engine.begin() as connection:
            grants.grant_execution_roles(connection, test_database.runtime_role, test_database.cleanup_role)
        with engine.begin() as connection:
            connection.exec_driver_sql(f'SET LOCAL ROLE "{test_database.cleanup_role}"')
            connection.execute(text("DELETE FROM execution.conversations WHERE id = 'conversation-1'"))
            assert connection.execute(text("SELECT count(*) FROM execution.result_snapshots")).scalar_one() == 0
            assert connection.execute(text("SELECT count(*) FROM execution.runtime_traces")).scalar_one() == 1
        with pytest.raises(DBAPIError) as error:
            with engine.begin() as connection:
                connection.exec_driver_sql(f'SET LOCAL ROLE "{test_database.cleanup_role}"')
                connection.execute(text("SELECT * FROM product.sentinel"))
        assert error.value.orig.sqlstate == "42501"
    finally:
        engine.dispose()


def test_migration_cli_requires_its_own_configuration(test_database):
    env = {**os.environ, "RUNTIME_DATABASE_URL": test_database.url, "DATABASE_URL": test_database.url}
    env.pop("RUNTIME_MIGRATION_DATABASE_URL", None)
    command = [sys.executable, "-m", "agent_runtime.infrastructure.db.migrate", "upgrade"]
    missing = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
    assert missing.returncode == 2
    assert missing.stderr.strip() == "RUNTIME_MIGRATION_DATABASE_URL is required"
    session = importlib.import_module("agent_runtime.infrastructure.db.session")
    engine = session.build_engine(test_database.url)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT to_regnamespace('execution')")).scalar_one() is None
        env["RUNTIME_MIGRATION_DATABASE_URL"] = test_database.url
        upgraded = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
        assert upgraded.returncode == 0, "explicit CLI migration failed"
        with engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM execution.alembic_version")).scalar_one() == (
                "0001_session_persistence"
            )
            assert connection.execute(text("SELECT value FROM product.sentinel")).scalar_one() == "preserve me"
    finally:
        engine.dispose()
