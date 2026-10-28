#!/usr/bin/env bash
set -euo pipefail

SDA_LOCAL_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SDA_LOCAL_ROOT"

docker_cli() {
  if docker buildx version >/dev/null 2>&1; then
    docker "$@"
  elif [[ -x /tmp/sda-docker-cli/cli-plugins/docker-buildx ]]; then
    docker --config /tmp/sda-docker-cli "$@"
  else
    docker "$@"
  fi
}

init_env() {
  python3 - <<'PY'
import base64
import os
import secrets
from pathlib import Path

path = Path('.local-docker/.env')
path.parent.mkdir(exist_ok=True)
try:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
except FileExistsError:
    print('Using existing .local-docker/.env')
else:
    values = {
        'SDA_LOCAL_PORT': '3000',
        'SDA_LOCAL_RUNTIME_PORT': '18000',
        'SDA_LOCAL_MINIO_PORT': '19001',
        'SDA_LOCAL_DB_PASSWORD': secrets.token_hex(16),
        'SDA_LOCAL_SECRET_KEY': secrets.token_hex(32),
        'SDA_LOCAL_ADMIN_PASSWORD': 'Admin1!' + secrets.token_hex(12),
        'SDA_LOCAL_MINIO_PASSWORD': secrets.token_hex(24),
        'SDA_LOCAL_USER_EMAIL': 'developer@example.com',
        'SDA_LOCAL_USER_PASSWORD': 'Dev1!' + secrets.token_hex(12),
    }
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(''.join(f'{key}={value}\n' for key, value in values.items()))
    print('Created private local credentials in .local-docker/.env')

# Secrets added after the first release are appended only when missing, so an existing .env keeps working.
key32 = lambda: base64.b64encode(os.urandom(32)).decode()
later = {
    'SDA_LOCAL_KB_STUDIO_PASSWORD': lambda: secrets.token_hex(16),
    'SDA_LOCAL_STUDIO_RUNTIME_KEY': key32,
    'SDA_LOCAL_RUNTIME_INTERNAL_KEY': key32,
    'SDA_LOCAL_RUNTIME_CURSOR_KEY': key32,
    'SDA_LOCAL_RUNTIME_PRODUCT_KEY': key32,
}
present = {line.split('=', 1)[0] for line in path.read_text().splitlines() if '=' in line}
missing = {key: make() for key, make in later.items() if key not in present}
if missing:
    with path.open('a') as stream:
        if not path.read_text().endswith('\n'):
            stream.write('\n')  # A hand-edited last line without newline would swallow the first key.
        stream.write(''.join(f'{key}={value}\n' for key, value in missing.items()))
    print('Added', ', '.join(missing), 'to .local-docker/.env')
PY
}

compose() {
  docker_cli compose --project-name sda-full-local --env-file .local-docker/.env -f docker-compose.full-local.yaml "$@"
}

build_stack() {
  docker_cli buildx version >/dev/null 2>&1 || {
    printf 'Docker Buildx is required for UI/API named build contexts. See docs/operations/local-stack.md\n' >&2
    exit 1
  }
  compose build web-ui studio-api studio-api-migrate agent-runtime
}

case "${1:-help}" in
  init) init_env; compose config --quiet ;;
  build) init_env; build_stack ;;
  up)
    init_env
    if [[ "${2:-}" != --no-build ]]; then build_stack; fi
    compose up -d --no-build --wait --wait-timeout 60 db minio
    compose --profile tools run --rm --no-deps studio-api-migrate
    compose --profile tools run --rm --no-deps studio-api-seed-agent
    compose --profile tools run --rm --no-deps minio-init
    compose --profile tools run --rm --no-deps runtime-provision
    compose up -d --no-build --wait --wait-timeout 60
    # A gateway that was already running keeps its old nginx config; the conf is bind-mounted, so check and reload it.
    compose exec -T gateway nginx -t -q && compose exec -T gateway nginx -s reload
    compose ps
    ;;
  down) compose down ;;
  ps) compose ps ;;
  logs) compose logs -f "${2:-studio-api}" ;;
  smoke) python3 scripts/local-api-smoke.py ;;
  *) printf 'Usage: bash scripts/local-stack.sh {init|build|up [--no-build]|down|ps|logs [service]|smoke}\n' ;;
esac
