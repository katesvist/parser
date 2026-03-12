#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/env/stack.env" ]]; then
  echo "Missing env/stack.env. Run ./scripts/bootstrap-env.sh first."
  exit 1
fi

if [[ ! -f "$ROOT_DIR/services/api/.env" || ! -f "$ROOT_DIR/services/parser/.env" ]]; then
  echo "Missing service env files. Run ./scripts/bootstrap-env.sh first."
  exit 1
fi

set -a
source "$ROOT_DIR/env/stack.env"
set +a

PROJECT_NAME="${PROJECT_NAME:-tender-stack}"
STACK_NETWORK="${STACK_NETWORK:-${PROJECT_NAME}_default}"
export PROJECT_NAME STACK_NETWORK

docker network create "$STACK_NETWORK" >/dev/null 2>&1 || true

COMPOSE_ARGS=(
  -p "$PROJECT_NAME"
  -f "$ROOT_DIR/compose/stack.app.yml"
)

if [[ "${FRONTEND_ENABLED:-0}" == "1" ]]; then
  COMPOSE_ARGS+=(--profile frontend)
fi

docker compose \
  "${COMPOSE_ARGS[@]}" \
  up -d --build

if [[ "${FRONTEND_ENABLED:-0}" == "1" ]]; then
  echo "App stack started (parser-api + docling + workers + frontend)."
else
  echo "App stack started (parser-api + docling + workers)."
fi
