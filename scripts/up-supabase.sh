#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/env/stack.env" ]]; then
  echo "Missing env/stack.env. Run ./scripts/bootstrap-env.sh first."
  exit 1
fi

if [[ ! -f "$ROOT_DIR/infra/supabase/docker/.env" ]]; then
  echo "Missing infra/supabase/docker/.env. Run ./scripts/bootstrap-env.sh first."
  exit 1
fi

set -a
source "$ROOT_DIR/env/stack.env"
set +a

PROJECT_NAME="${PROJECT_NAME:-tender-stack}"
STACK_NETWORK="${STACK_NETWORK:-${PROJECT_NAME}_default}"
export PROJECT_NAME STACK_NETWORK

docker network create "$STACK_NETWORK" >/dev/null 2>&1 || true

docker compose \
  -p "$PROJECT_NAME" \
  -f "$ROOT_DIR/infra/supabase/docker/docker-compose.yml" \
  up -d

echo "Supabase stack started."
