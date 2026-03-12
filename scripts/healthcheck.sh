#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/env/stack.env" ]]; then
  set -a
  source "$ROOT_DIR/env/stack.env"
  set +a
fi

PROJECT_NAME="${PROJECT_NAME:-tender-stack}"
API_PORT="${API_PORT:-8787}"

echo "== parser-api /health =="
curl -fsS "http://127.0.0.1:${API_PORT}/health" && echo

echo "== supabase-kong /rest/v1 =="
KONG_CODE="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:8000/rest/v1/")"
echo "HTTP $KONG_CODE"
if [[ "$KONG_CODE" != "200" && "$KONG_CODE" != "401" ]]; then
  echo "Unexpected Kong status: $KONG_CODE"
  exit 1
fi

echo "== supabase-db status =="
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep supabase-db || true

echo "== app services =="
docker compose -p "$PROJECT_NAME" -f "$ROOT_DIR/compose/stack.app.yml" ps
