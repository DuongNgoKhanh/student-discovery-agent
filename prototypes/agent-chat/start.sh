#!/usr/bin/env bash
# Local agent chat prototype: disposable Postgres, runtime on :18100 reading releases/, signing proxy + UI on :8787.
#   bash prototypes/agent-chat/start.sh        start everything (Ctrl+C stops runtime, indexer and proxy)
#   bash prototypes/agent-chat/start.sh reset  drop the chat database container (all conversations)
# Model key: GOOGLE_API_KEY / OPENAI_API_KEY from your shell or apps/agent-runtime/.env. Without one the agent
# answers with the snapshot's fallback template, which is still useful for checking the flow.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUNTIME="$ROOT/apps/agent-runtime"
SECRETS="$HERE/.env.local"
DB_CONTAINER=sda-agent-chat-db
DB_PORT="${SDA_CHAT_DB_PORT:-15433}"
RUNTIME_PORT="${SDA_CHAT_RUNTIME_PORT:-18100}"

# No key in the shell: take GOOGLE_API_KEY from the local stack's .local-docker/.env (this checkout, else the main
# checkout when running from a git worktree). Only that one variable is read; the value is never printed.
if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
  MAIN_ROOT="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)/.." && pwd)"
  for candidate in "$ROOT/.local-docker/.env" "$MAIN_ROOT/.local-docker/.env"; do
    if [[ -f "$candidate" ]]; then
      value="$(sed -n -E 's/^GOOGLE_API_KEY=(.*)$/\1/p' "$candidate" | tail -n 1)"
      if [[ -n "$value" ]]; then export GOOGLE_API_KEY="$value"; echo "GOOGLE_API_KEY lấy từ $candidate"; break; fi
    fi
  done
fi

if [[ "${1:-}" == "reset" ]]; then
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  echo "Removed $DB_CONTAINER."
  exit 0
fi

key() { python3 -c 'import base64,os;print(base64.b64encode(os.urandom(32)).decode())'; }
umask 077
if [[ ! -f "$SECRETS" ]]; then
  {
    echo "DB_PASSWORD=$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
    echo "KEYRING={\"local\":\"$(key)\"}"
    echo "CURSOR_KEY=$(key)"
  } >"$SECRETS"
fi
# Secrets added after the first release are appended only when missing, so an existing .env.local keeps working.
add_secret() { grep -q "^$1=" "$SECRETS" || echo "$1=$2" >>"$SECRETS"; }
add_secret STUDIO_DB_PASSWORD "$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
add_secret STUDIO_RUNTIME_KEY "$(key)"
add_secret STUDIO_SECRET_KEY "$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
add_secret STUDIO_ADMIN_PASSWORD "$(python3 -c 'import secrets;print(secrets.token_urlsafe(12))')"
chmod 600 "$SECRETS"
# shellcheck disable=SC1090
source <(sed -E 's/^([A-Z_]+)=(.*)$/\1='"'"'\2'"'"'/' "$SECRETS")

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$DB_CONTAINER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -p "127.0.0.1:$DB_PORT:5432" pgvector/pgvector:pg16 >/dev/null
fi
for _ in $(seq 1 30); do docker exec "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

DB_URL="postgresql+psycopg://postgres:$DB_PASSWORD@127.0.0.1:$DB_PORT/postgres"
(cd "$RUNTIME" && .venv/bin/python -c 'import sys
from agent_runtime.infrastructure.db.migrate import upgrade_database
upgrade_database(sys.argv[1])' "$DB_URL")
# Pre-production migrations are edited in place, so a DB created by an older 0001 is never upgraded.
if ! (cd "$RUNTIME" && .venv/bin/python -c 'import sys
from sqlalchemy import create_engine, text
with create_engine(sys.argv[1]).connect() as c:
    ok = all(c.scalar(text("SELECT to_regclass(:t)"), {"t": t}) for t in ("execution.responses", "knowledge.document_revisions", "knowledge.imports"))
    sys.exit(0 if ok else 1)' "$DB_URL"); then
  echo "DB của prototype được tạo bằng migration cũ (thiếu execution.responses hoặc schema knowledge, knowledge.imports)." >&2
  echo "Chạy: bash prototypes/agent-chat/start.sh reset   (xóa hội thoại cũ), rồi chạy lại start.sh." >&2
  exit 1
fi

# Least-privilege knowledge roles; Studio logs in as kb_studio and may write content columns only.
(cd "$RUNTIME" && STUDIO_DB_PASSWORD="$STUDIO_DB_PASSWORD" .venv/bin/python -c 'import os, sys
import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url
url = make_url(sys.argv[1]).set(drivername="postgresql").render_as_string(hide_password=False)
with psycopg.connect(url, autocommit=True) as c:
    for role in ("kb_runtime", "kb_indexer"):
        if not c.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone():
            c.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
    verb = "ALTER" if c.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", ("kb_studio",)).fetchone() else "CREATE"
    c.execute(sql.SQL(verb + " ROLE kb_studio LOGIN PASSWORD {}").format(sql.Literal(os.environ["STUDIO_DB_PASSWORD"])))' "$DB_URL")
(cd "$RUNTIME" && RUNTIME_MIGRATION_DATABASE_URL="$DB_URL" .venv/bin/python -m agent_runtime.cli.knowledge_provision \
  --runtime-role kb_runtime --indexer-role kb_indexer --studio-role kb_studio)

# Demo KB: real embeddings when a Google key is available, otherwise the offline fake (search runs keyword-only).
SEED_FLAGS=(); INDEX_FLAGS=()
if [[ -z "${GOOGLE_API_KEY:-}" ]] && ! grep -qs '^GOOGLE_API_KEY=.' "$RUNTIME/.env"; then
  SEED_FLAGS=(--embedding-model fake-embedding); INDEX_FLAGS=(--fake-embedding)
  echo "Không có GOOGLE_API_KEY: KB demo dùng fake embedding."
fi
(cd "$RUNTIME" && RUNTIME_KNOWLEDGE_SEED_DATABASE_URL="$DB_URL" \
  .venv/bin/python -m agent_runtime.cli.knowledge_seed "${SEED_FLAGS[@]}")
(cd "$RUNTIME" && RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL="$DB_URL" \
  .venv/bin/python -m agent_runtime.cli.knowledge_indexer --once "${INDEX_FLAGS[@]}")

export RUNTIME_ENVIRONMENT=demo RUNTIME_DATABASE_URL="$DB_URL" RUNTIME_INTERNAL_KEYRING="$KEYRING" \
  RUNTIME_CURSOR_SIGNING_KEY="$CURSOR_KEY" RUNTIME_LOCAL_RELEASES_DIR="$HERE/releases" \
  RUNTIME_STUDIO_KEYRING="{\"studio\":\"$STUDIO_RUNTIME_KEY\"}"
(cd "$RUNTIME" && exec .venv/bin/uvicorn agent_runtime.main:app --host 127.0.0.1 --port "$RUNTIME_PORT" \
  --no-access-log) &
RUNTIME_PID=$!
# Long-running indexer so edits made in Studio are indexed while chatting.
(cd "$RUNTIME" && RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL="$DB_URL" \
  exec .venv/bin/python -m agent_runtime.cli.knowledge_indexer "${INDEX_FLAGS[@]}") &
INDEXER_PID=$!
trap 'kill $RUNTIME_PID $INDEXER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do curl --noproxy "*" -fs "http://127.0.0.1:$RUNTIME_PORT/healthz" >/dev/null && break; sleep 1; done
MODELS=gemini-embedding-2; [[ ${#INDEX_FLAGS[@]} -gt 0 ]] && MODELS=fake-embedding
umask 077
cat >"$HERE/studio.env" <<EOF
DATABASE_URL=postgresql://postgres:$DB_PASSWORD@127.0.0.1:$DB_PORT/postgres
SECRET_KEY=$STUDIO_SECRET_KEY
ADMIN_PASSWORD=$STUDIO_ADMIN_PASSWORD
NODE_ENV=development
KNOWLEDGE_DATABASE_URL=postgresql://kb_studio:$STUDIO_DB_PASSWORD@127.0.0.1:$DB_PORT/postgres
KNOWLEDGE_EMBEDDING_MODELS=$MODELS
RUNTIME_INTERNAL_URL=http://127.0.0.1:$RUNTIME_PORT
STUDIO_RUNTIME_SIGNING_KEY=$STUDIO_RUNTIME_KEY
STUDIO_RUNTIME_SIGNING_KID=studio
EOF
chmod 600 "$HERE/studio.env"
echo "Studio env: $HERE/studio.env (xem README, mục Knowledge Studio)"
SDA_CHAT_KEYRING="$KEYRING" SDA_CHAT_RUNTIME_URL="http://127.0.0.1:$RUNTIME_PORT" python3 "$HERE/proxy.py"
