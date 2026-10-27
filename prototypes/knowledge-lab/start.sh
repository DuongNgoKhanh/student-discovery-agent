#!/usr/bin/env bash
# Local knowledge lab: disposable pgvector Postgres, runtime on :18101, signing proxy + lab UI on :8788.
#   bash prototypes/knowledge-lab/start.sh        start everything (Ctrl+C stops runtime and lab)
#   bash prototypes/knowledge-lab/start.sh reset  drop the lab database container (all documents)
# Embedding: GOOGLE_API_KEY from your shell or apps/agent-runtime/.env uses gemini-embedding-2; without one the
# lab indexes with the fake embedding and the runtime endpoint answers keyword-only (degraded).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUNTIME="$ROOT/apps/agent-runtime"
SECRETS="$HERE/.env.local"
DB_CONTAINER=sda-knowledge-lab-db
DB_PORT="${LAB_DB_PORT:-15434}"
RUNTIME_PORT="${LAB_RUNTIME_PORT:-18101}"

if [[ "${1:-}" == "reset" ]]; then
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  echo "Removed $DB_CONTAINER."
  exit 0
fi

if [[ ! -f "$SECRETS" ]]; then
  umask 077
  key() { python3 -c 'import base64,os;print(base64.b64encode(os.urandom(32)).decode())'; }
  pw() { python3 -c 'import secrets;print(secrets.token_hex(16))'; }
  {
    echo "DB_PASSWORD=$(pw)"
    echo "RUNTIME_PASSWORD=$(pw)"
    echo "INDEXER_PASSWORD=$(pw)"
    echo "KEYRING={\"local\":\"$(key)\"}"
    echo "CURSOR_KEY=$(key)"
  } >"$SECRETS"
fi
# shellcheck disable=SC1090
source <(sed -E 's/^([A-Z_]+)=(.*)$/\1='"'"'\2'"'"'/' "$SECRETS")

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$DB_CONTAINER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -p "127.0.0.1:$DB_PORT:5432" pgvector/pgvector:pg16 >/dev/null
fi
for _ in $(seq 1 30); do docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

URL() { echo "postgresql+psycopg://$1:$2@127.0.0.1:$DB_PORT/postgres"; }
OWNER_URL="$(URL postgres "$DB_PASSWORD")"
RUNTIME_URL_DB="$(URL kb_runtime "$RUNTIME_PASSWORD")"
INDEXER_URL="$(URL kb_indexer "$INDEXER_PASSWORD")"

# Migrate, then give the runtime and indexer their least-privileged login roles (the same grants production uses).
(cd "$RUNTIME" && .venv/bin/python - "$OWNER_URL" "$RUNTIME_PASSWORD" "$INDEXER_PASSWORD" <<'PY'
import sys
from sqlalchemy import text
from agent_runtime.infrastructure.db.grants import grant_execution_roles, grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import build_engine

url, runtime_password, indexer_password = sys.argv[1:]
upgrade_database(url)
engine = build_engine(url)
with engine.begin() as connection:
    if connection.scalar(text("SELECT to_regclass('knowledge.document_revisions')")) is None:
        sys.exit("DB của lab được tạo bằng migration cũ (thiếu schema knowledge). Chạy: start.sh reset")
    for role, password in (("kb_runtime", runtime_password), ("kb_indexer", indexer_password), ("kb_cleanup", None)):
        exists = connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role})
        login = f"LOGIN PASSWORD '{password}'" if password else "NOLOGIN"
        connection.exec_driver_sql(f"{'ALTER' if exists else 'CREATE'} ROLE {role} {login}")
    grant_execution_roles(connection, "kb_runtime", "kb_cleanup")
    grant_knowledge_roles(connection, "kb_runtime", "kb_indexer")
engine.dispose()
PY
)

export RUNTIME_ENVIRONMENT=demo RUNTIME_DATABASE_URL="$RUNTIME_URL_DB" RUNTIME_INTERNAL_KEYRING="$KEYRING" \
  RUNTIME_CURSOR_SIGNING_KEY="$CURSOR_KEY"
(cd "$RUNTIME" && exec .venv/bin/uvicorn agent_runtime.main:app --host 127.0.0.1 --port "$RUNTIME_PORT" \
  --no-access-log) &
RUNTIME_PID=$!
trap 'kill $RUNTIME_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do curl --noproxy "*" -fs "http://127.0.0.1:$RUNTIME_PORT/healthz" >/dev/null && break; sleep 1; done
cd "$RUNTIME"
LAB_KEYRING="$KEYRING" LAB_RUNTIME_URL="http://127.0.0.1:$RUNTIME_PORT" LAB_OWNER_DATABASE_URL="$OWNER_URL" \
  LAB_INDEXER_DATABASE_URL="$INDEXER_URL" LAB_RUNTIME_DATABASE_URL="$RUNTIME_URL_DB" \
  .venv/bin/python "$HERE/lab.py"
