"""Execution-only durable session state, immutable generations and deferred references."""

from alembic import op

revision = "0001_session_persistence"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Frozen DDL: do not import mutable application metadata into historical revisions.
    op.execute("""
        REVOKE ALL ON SCHEMA execution FROM PUBLIC;
        CREATE TABLE execution.release_snapshots (
            environment text NOT NULL, kind text NOT NULL CHECK (kind IN ('agent', 'experience')),
            release_id text NOT NULL, content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
            content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
            delivery_schema_version text NOT NULL, definition_schema_version text, algorithm_profile text,
            engine_version text, is_demo boolean NOT NULL, imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY (environment, kind, release_id),
            CHECK ((kind = 'agent' AND definition_schema_version IS NULL AND algorithm_profile IS NULL
                    AND engine_version IS NULL)
                OR (kind = 'experience' AND definition_schema_version IS NOT NULL AND engine_version IS NOT NULL))
        );
        CREATE TABLE execution.conversations (
            id text PRIMARY KEY, owner_id text NOT NULL, environment text NOT NULL,
            status text NOT NULL CHECK (status IN ('active', 'ended', 'expired')),
            revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
            agent_environment text NOT NULL, agent_kind text NOT NULL CHECK (agent_kind = 'agent'),
            agent_release_id text NOT NULL,
            capability_snapshot jsonb NOT NULL CHECK (jsonb_typeof(capability_snapshot) = 'object'),
            display_name text, active_activity_id text, created_at timestamptz NOT NULL,
            expires_at timestamptz NOT NULL, ended_at timestamptz,
            content_retention_seconds bigint NOT NULL CHECK (content_retention_seconds BETWEEN 0 AND 9007199254740991),
            CHECK (agent_environment = environment), CHECK (expires_at > created_at),
            CHECK ((status = 'ended' AND ended_at IS NOT NULL AND ended_at >= created_at AND ended_at < expires_at)
                OR (status <> 'ended' AND ended_at IS NULL)),
            FOREIGN KEY (agent_environment, agent_kind, agent_release_id)
                REFERENCES execution.release_snapshots (environment, kind, release_id)
                ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TABLE execution.activities (
            id text PRIMARY KEY, conversation_id text NOT NULL, experience_id text NOT NULL, type text NOT NULL,
            view_schema_version integer NOT NULL CHECK (view_schema_version IN (1, 2)),
            algorithm_profile text, engine_version text NOT NULL,
            experience_environment text NOT NULL,
            experience_kind text NOT NULL CHECK (experience_kind = 'experience'), experience_release_id text NOT NULL,
            status text NOT NULL CHECK (status IN ('collecting_name', 'in_progress', 'completed', 'ended', 'expired')),
            revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
            state_schema_version integer NOT NULL CHECK (state_schema_version IN (1, 2)),
            state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
            created_at timestamptz NOT NULL, closed_at timestamptz,
            FOREIGN KEY (conversation_id) REFERENCES execution.conversations(id)
                ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
            FOREIGN KEY (experience_environment, experience_kind, experience_release_id)
                REFERENCES execution.release_snapshots(environment, kind, release_id)
                ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        );
        ALTER TABLE execution.conversations ADD CONSTRAINT conversations_active_activity_fk
            FOREIGN KEY (active_activity_id) REFERENCES execution.activities(id) DEFERRABLE INITIALLY DEFERRED;
        CREATE TABLE execution.messages (
            message_id text PRIMARY KEY, conversation_id text NOT NULL,
            ordinal bigint NOT NULL CHECK (ordinal BETWEEN 0 AND 9007199254740991),
            committed_conversation_revision bigint NOT NULL
                CHECK (committed_conversation_revision BETWEEN 0 AND 9007199254740991),
            turn_id text, role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            blocks jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'), text text,
            interaction jsonb CHECK (interaction IS NULL OR jsonb_typeof(interaction) = 'object'),
            committed_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (conversation_id, ordinal),
            FOREIGN KEY (conversation_id) REFERENCES execution.conversations(id)
                ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TABLE execution.result_snapshots (
            result_id text PRIMARY KEY, activity_id text NOT NULL,
            result_revision bigint NOT NULL CHECK (result_revision BETWEEN 1 AND 9007199254740991),
            source_activity_revision bigint NOT NULL CHECK (source_activity_revision BETWEEN 1 AND 9007199254740991),
            validity text NOT NULL CHECK (validity IN ('valid', 'superseded')),
            result_projection jsonb NOT NULL CHECK (jsonb_typeof(result_projection) = 'object'),
            card_projection jsonb NOT NULL CHECK (jsonb_typeof(card_projection) = 'object'),
            share_projection jsonb NOT NULL CHECK (jsonb_typeof(share_projection) = 'object'),
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (activity_id, result_revision),
            FOREIGN KEY (activity_id) REFERENCES execution.activities(id)
                ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TABLE execution.operation_outcomes (
            owner_id text NOT NULL, operation text NOT NULL, resource_scope text NOT NULL, key text NOT NULL,
            request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'), conversation_id text NOT NULL,
            response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
            response_data jsonb NOT NULL CHECK (jsonb_typeof(response_data) = 'object'),
            committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY (owner_id, operation, resource_scope, key),
            FOREIGN KEY (conversation_id) REFERENCES execution.conversations(id)
                ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
        );
        CREATE TABLE execution.runtime_traces (
            event_id text PRIMARY KEY, request_id text NOT NULL, trace_id text,
            conversation_id text, activity_id text, result_id text,
            action text NOT NULL, step text NOT NULL, outcome text NOT NULL, error_code text,
            before_revision bigint CHECK (before_revision BETWEEN 0 AND 9007199254740991),
            after_revision bigint CHECK (after_revision BETWEEN 0 AND 9007199254740991),
            environment text, agent_release_id text, experience_release_id text,
            algorithm_profile text, engine_version text, latency_ms bigint CHECK (latency_ms >= 0),
            provider text, fallback boolean, timestamp timestamptz NOT NULL DEFAULT clock_timestamp()
        );
        CREATE INDEX conversations_owner_lookup ON execution.conversations (owner_id, id);
        CREATE INDEX conversations_expiry ON execution.conversations (expires_at) WHERE status = 'active';
        CREATE INDEX conversations_cleanup ON execution.conversations
            (((coalesce(ended_at, expires_at) AT TIME ZONE 'UTC')
                + content_retention_seconds * interval '1 second'))
            WHERE status IN ('ended', 'expired');
        CREATE INDEX activities_conversation ON execution.activities (conversation_id, id);
        CREATE UNIQUE INDEX activities_one_open_per_conversation ON execution.activities (conversation_id)
            WHERE status IN ('collecting_name', 'in_progress');
        CREATE INDEX outcomes_conversation ON execution.operation_outcomes (conversation_id);
        CREATE INDEX traces_retention ON execution.runtime_traces (timestamp);

        CREATE FUNCTION execution.reject_release_update() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, execution AS $$
        BEGIN
            RAISE EXCEPTION 'release snapshots are immutable' USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER release_snapshot_immutable BEFORE UPDATE ON execution.release_snapshots
            FOR EACH ROW EXECUTE FUNCTION execution.reject_release_update();

        CREATE FUNCTION execution.guard_result_generation() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, execution AS $$
        BEGIN
            IF (to_jsonb(NEW) - 'validity') IS DISTINCT FROM (to_jsonb(OLD) - 'validity') THEN
                RAISE EXCEPTION 'result generation is immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER result_generation_immutable BEFORE UPDATE ON execution.result_snapshots
            FOR EACH ROW EXECUTE FUNCTION execution.guard_result_generation();

        CREATE FUNCTION execution.check_active_activity() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, execution AS $$
        BEGIN
            IF TG_TABLE_NAME = 'conversations' THEN
                IF EXISTS (SELECT 1 FROM execution.conversations c WHERE c.id = NEW.id
                    AND c.active_activity_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM execution.activities a
                        WHERE a.id = c.active_activity_id AND a.conversation_id = c.id)) THEN
                    RAISE EXCEPTION 'active activity must belong to its conversation' USING ERRCODE = '23503';
                END IF;
            ELSE
                IF EXISTS (SELECT 1 FROM execution.conversations c
                    WHERE c.active_activity_id = COALESCE(NEW.id, OLD.id) AND NOT EXISTS (
                        SELECT 1 FROM execution.activities a
                        WHERE a.id = c.active_activity_id AND a.conversation_id = c.id)) THEN
                    RAISE EXCEPTION 'active activity must belong to its conversation' USING ERRCODE = '23503';
                END IF;
            END IF;
            RETURN NULL;
        END $$;
        CREATE CONSTRAINT TRIGGER conversation_active_activity_guard
            AFTER INSERT OR UPDATE ON execution.conversations DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION execution.check_active_activity();
        CREATE CONSTRAINT TRIGGER activity_parent_guard
            AFTER INSERT OR UPDATE OR DELETE ON execution.activities DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION execution.check_active_activity();

        CREATE FUNCTION execution.check_current_result() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, execution AS $$
        BEGIN
            IF TG_TABLE_NAME = 'activities' THEN
                IF EXISTS (SELECT 1 FROM execution.activities a WHERE a.id = NEW.id
                    AND a.state->>'current_result_id' IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM execution.result_snapshots r
                        WHERE r.result_id = a.state->>'current_result_id' AND r.activity_id = a.id)) THEN
                    RAISE EXCEPTION 'current result must belong to its activity' USING ERRCODE = '23503';
                END IF;
            ELSE
                IF EXISTS (SELECT 1 FROM execution.activities a
                    WHERE a.state->>'current_result_id' = COALESCE(NEW.result_id, OLD.result_id) AND NOT EXISTS (
                        SELECT 1 FROM execution.result_snapshots r
                        WHERE r.result_id = a.state->>'current_result_id' AND r.activity_id = a.id)) THEN
                    RAISE EXCEPTION 'current result must belong to its activity' USING ERRCODE = '23503';
                END IF;
            END IF;
            RETURN NULL;
        END $$;
        CREATE CONSTRAINT TRIGGER activity_current_result_guard
            AFTER INSERT OR UPDATE ON execution.activities DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION execution.check_current_result();
        CREATE CONSTRAINT TRIGGER result_activity_guard
            AFTER INSERT OR UPDATE OR DELETE ON execution.result_snapshots DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION execution.check_current_result();
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE execution.conversations DROP CONSTRAINT conversations_active_activity_fk;
        DROP TABLE execution.runtime_traces, execution.operation_outcomes, execution.messages,
            execution.result_snapshots, execution.activities, execution.conversations, execution.release_snapshots;
        DROP FUNCTION execution.check_current_result(), execution.check_active_activity(),
            execution.guard_result_generation(), execution.reject_release_update();
    """)
