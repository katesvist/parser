# Репо Тендеров (prod актуальный)

Снимок собран: 2026-03-11/12.

Источник backend:
- прод-сервер `5.180.174.19` (`/root/n8n-install/parser-api`, `/root/n8n-install/tender-parser`)

Источник frontend:
- `frontend/source` — исходники из локальной папки `Тендеры прод/t-react`
- `frontend/build` — текущий деплой-бандл (`tender.rigintel.ai`)

## Структура
- `services/api` — актуальный `parser-api` с прода
- `services/parser` — актуальный `tender-parser` (ingest/docs/analytics) с прода
- `frontend/source` — исходники фронта
- `frontend/build` — собранный фронт-бандл (`index.html` + `/assets`)
- `database/postgres_schema_only.sql` — структура БД без данных (`pg_dump --schema-only`)
- `infra/supabase/docker` — локальный Supabase/Postgres stack (compose + init SQL + kong/vector config)
- `infra/docker-compose.prod.snapshot.yml` — снапшот compose с прода
- `infra/docker-compose.n8n-workers.snapshot.yml` — снапшот n8n workers
- `infra/Caddyfile.snapshot` — снапшот Caddy
- `compose/stack.app.yml` — app-слой (`parser-api`, `docling`, `worker-ingest`, `worker-docs`, `worker-analytics`)
  - опционально `frontend` (profile `frontend`), сборка на сервере из `frontend/source`
- `env/stack.env.example` — общие параметры стека (project/network/ports/domains)

## Быстрый bootstrap env
```bash
chmod +x scripts/bootstrap-env.sh
./scripts/bootstrap-env.sh
```

Скрипт создаёт:
- `env/stack.env` из `env/stack.env.example`
- `infra/supabase/docker/.env` из `infra/supabase/docker/.env.example`
- `services/api/.env` из `services/api/.env.example`
- `services/parser/.env` из `services/parser/.env.example`
- `frontend/source/.env` из `frontend/source/.env.example`
- `services/parser/config/keywords.json` (если отсутствует)

## Разворот backend на новом сервере (без данных)
```bash
git clone git@github.com:katesvist/parser.git
cd parser

chmod +x scripts/*.sh
./scripts/bootstrap-env.sh
```

Заполнить реальные значения в:
- `env/stack.env`
- `infra/supabase/docker/.env`
- `services/api/.env`
- `services/parser/.env`

Запуск:
```bash
./scripts/up-supabase.sh
./scripts/apply-db-schema.sh
./scripts/up-app.sh
./scripts/healthcheck.sh
```

Чтобы фронт тоже деплоился на сервере, в `env/stack.env`:
- `FRONTEND_ENABLED=1`
- `FRONTEND_PORT=8088` (или свой)
- `FRONTEND_VITE_API_BASE=/api` (или полный URL API)

После этого `./scripts/up-app.sh` сам соберёт фронт-контейнер из `frontend/source` и поднимет его.

## Важно по сетям
- По умолчанию `PROJECT_NAME=tender-stack`.
- По умолчанию `STACK_NETWORK=tender-stack_default`.
- App-слой подключается в эту же сеть, чтобы видеть Supabase/Kong/Postgres.

## Что не хранится в репо
- runtime-данные PostgreSQL (`infra/supabase/docker/volumes/db/data`) не включаются;
- в репо только структура БД (`database/postgres_schema_only.sql`) и миграции.
