# Migration Plan: n8n/Supabase/API stack -> 84.54.28.57 (qoqon.io)

This is a step-by-step checklist to move the server "inner stack" to the new server.
Frontend migration is intentionally excluded for now.

## 1) Prepare the new server
- Install Docker and docker-compose.
- Create `/root/n8n-install` on the new server.

## 2) Copy the project files from the old server
Suggested approach: copy the entire `n8n-install` directory, then update configs.

Minimum files/folders to copy:
- `/root/n8n-install/.env`
- `/root/n8n-install/docker-compose.yml`
- `/root/n8n-install/Caddyfile`
- `/root/n8n-install/parser-api/` (api.js, hashPassword.js, .env)
- `/root/n8n-install/supabase/` (or the docker volumes for Postgres)
- `/root/n8n-install/shared/` (if used)
- `/root/n8n-install/n8n/` (if used)
- `/root/n8n-install/caddy-addon/` (if used)

Tip: copying the full `n8n-install` tree is usually the safest and fastest.

## 3) Update domain-related settings

### In `.env`
- `USER_DOMAIN_NAME="qoqon.io"`
- `LETSENCRYPT_EMAIL="your-email"`
- Replace all `*_HOSTNAME="*.kanarskaia.online"` with `*.qoqon.io`
- `SUPABASE_PUBLIC_URL="https://supabase.qoqon.io"`
- `API_EXTERNAL_URL="https://supabase.qoqon.io"` (if used by your setup)
- `SITE_URL="https://supabase.qoqon.io"` (or the actual Studio URL)
- `CORS_ORIGINS` will be updated later when frontend domain is known

### In `Caddyfile`
- Replace all hostnames with `*.qoqon.io`
- Make sure the API hostname is present:
  - `supabase-api.qoqon.io` -> reverse_proxy `127.0.0.1:8787`

## 4) DNS for qoqon.io
Create A-records for all required subdomains -> `84.54.28.57`.
Do not create AAAA (IPv6) records, to avoid certificate issuance failures.

## 5) Start services
On the new server:
```
cd /root/n8n-install
docker compose up -d
docker compose restart caddy
```

## 6) Quick checks
- `https://supabase.qoqon.io`
- `https://supabase-api.qoqon.io/health`

## 7) Frontend later
Once frontend domain is ready, update:
- `CORS_ORIGINS` in `/root/n8n-install/parser-api/.env`
- `VITE_API_BASE` and `VITE_API_KEY` in the frontend `.env`

