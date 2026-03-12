#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
SCHEMA_FILE="$ROOT_DIR/database/postgres_schema_only.sql"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "Container $DB_CONTAINER is not running."
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Schema file not found: $SCHEMA_FILE"
  exit 1
fi

echo "Waiting for PostgreSQL in $DB_CONTAINER ..."
until docker exec -i "$DB_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do
  sleep 2
done

echo "Applying schema-only dump ..."
cat "$SCHEMA_FILE" \
  | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres

echo "Applying parser migrations ..."
for f in "$ROOT_DIR"/services/parser/migrations/*.sql; do
  echo " - $(basename "$f")"
  cat "$f" | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres
done

echo "DB schema + migrations applied."
