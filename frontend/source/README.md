
  # Тендерный парсер веб-приложение

  This is a code bundle for Тендерный парсер веб-приложение. The original project is available at https://www.figma.com/design/Q2PrjZFHBrYFLo1mZoPYB8/%D0%A2%D0%B5%D0%BD%D0%B4%D0%B5%D1%80%D0%BD%D1%8B%D0%B9-%D0%BF%D0%B0%D1%80%D1%81%D0%B5%D1%80-%D0%B2%D0%B5%D0%B1-%D0%BF%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Frontend auth (via API)

  The login screen calls `/api/login`, which verifies credentials against
  a local `app_users` table and returns a JWT.
  Configure the frontend env (see `frontend.env.example`):
  - `VITE_API_BASE` (defaults to `/api`)

  The UI only shows a login form (registration is disabled).

  ## API server (optional)

  The project now includes a small API server under `server/api.js` that proxies
  requests to Supabase and returns normalized tender data.
  (Requires Node 18+ for built-in `fetch`.)

  1. Copy `server/api.env.example` to your server environment.
  2. Set `SUPABASE_REST_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `AUTH_JWT_SECRET`.
  3. Optionally set `API_KEYS` for service-to-service access.
  4. Start the server with `node server/api.js`.

  Login flow:
  - `POST /api/login` with `{ "email": "...", "password": "..." }`
  - API returns a JWT, which the frontend stores and sends in
    `Authorization: Bearer <token>`.
  - If `API_KEYS` is configured, you can also send `X-Api-Key: <key>` as a fallback.
  - Optional: set `AUTH_ADMIN_USERNAME`/`AUTH_ADMIN_PASSWORD` for a static admin login.

  User table:
  - Create `app_users` table and insert users manually.
  - Passwords are stored as scrypt hashes (see `server/hashPassword.js`).

  Admin role (full access):
  - Create a user in Supabase Auth (Dashboard -> Authentication -> Users).
  - Set `app_metadata.role = "admin"` for that user.
    Example SQL (run in Supabase SQL editor):
    ```
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
    where email = 'admin@example.com';
    ```

  If you want to expose it under the frontend domain as `/api`, add a reverse proxy
  rule in your web server (Caddy example):

  ```
  handle_path /api/* {
    reverse_proxy 127.0.0.1:8787
  }
  ```
