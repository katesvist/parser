#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

copy_if_missing() {
  local src="$1"
  local dst="$2"

  if [[ ! -f "$src" ]]; then
    echo "[skip] template not found: $src"
    return 0
  fi

  if [[ -f "$dst" && "$FORCE" -eq 0 ]]; then
    echo "[keep] already exists: $dst"
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  chmod 600 "$dst" 2>/dev/null || true
  echo "[create] $dst"
}

ensure_file_if_missing() {
  local dst="$1"
  local content="$2"

  if [[ -f "$dst" && "$FORCE" -eq 0 ]]; then
    echo "[keep] already exists: $dst"
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  printf "%s\n" "$content" > "$dst"
  echo "[create] $dst"
}

echo "Bootstrapping env/runtime files in: $ROOT_DIR"

# Normalize frontend template name.
if [[ ! -f "$ROOT_DIR/frontend/source/.env.example" && -f "$ROOT_DIR/frontend/source/frontend.env.example" ]]; then
  cp "$ROOT_DIR/frontend/source/frontend.env.example" "$ROOT_DIR/frontend/source/.env.example"
  echo "[create] frontend/source/.env.example (from frontend.env.example)"
fi

# Create .env files from templates.
copy_if_missing "$ROOT_DIR/services/api/.env.example" "$ROOT_DIR/services/api/.env"
copy_if_missing "$ROOT_DIR/services/parser/.env.example" "$ROOT_DIR/services/parser/.env"
copy_if_missing "$ROOT_DIR/frontend/source/.env.example" "$ROOT_DIR/frontend/source/.env"

# Ensure keywords config exists (ingest depends on this file path in env).
ensure_file_if_missing "$ROOT_DIR/services/parser/config/keywords.json" "[]"

cat <<'OUT'

Bootstrap completed.

Next step:
1) Fill real values in:
   - services/api/.env
   - services/parser/.env
   - frontend/source/.env
2) Verify domains and CORS:
   - VITE_API_BASE
   - CORS_ORIGINS
   - SUPABASE_REST_URL / SUPABASE_SERVICE_ROLE_KEY
OUT
