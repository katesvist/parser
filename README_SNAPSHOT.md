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
- `infra/docker-compose.prod.snapshot.yml` — снапшот compose с прода
- `infra/docker-compose.n8n-workers.snapshot.yml` — снапшот n8n workers
- `infra/Caddyfile.snapshot` — снапшот Caddy

## Быстрый bootstrap env
```bash
chmod +x scripts/bootstrap-env.sh
./scripts/bootstrap-env.sh
```

Скрипт создаёт:
- `services/api/.env` из `services/api/.env.example`
- `services/parser/.env` из `services/parser/.env.example`
- `frontend/source/.env` из `frontend/source/.env.example`
- `services/parser/config/keywords.json` (если отсутствует)
