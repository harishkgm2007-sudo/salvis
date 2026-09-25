# Salvis Backend (Phase 1)

FastAPI + SQLAlchemy 2.0 + PostgreSQL backend for the Salvis smart-savings
platform: user auth (email + Google), goal vaults, ledgers, and multi-device sync.

## Stack

- **API:** FastAPI (Python 3.12), served by uvicorn
- **DB:** PostgreSQL 16 (SQLAlchemy 2.0 ORM, psycopg3). SQLite works for local dev.
- **Auth:** bcrypt password hashing, JWT (HS256) access + refresh tokens, Google
  OAuth `id_token` verification against Google's JWKS
- **Migrations:** Alembic (autogenerate)
- **Sync:** full-snapshot pull + push/merge with last-write-wins by server clock
- **Tests:** pytest + TestClient (in-memory SQLite)

## Layout

```
app/
  config.py          env-backed settings (pydantic-settings)
  database.py        engine + session + SQLAlchemy Base
  core/security.py   bcrypt + JWT
  core/google.py     Google id_token verification
  models/            users, profiles, vaults, transactions, bank_accounts, sync_devices
  schemas/           request/response models (pydantic)
  api/               routers: auth, vaults, transactions, profiles, bank-accounts, sync
  main.py            app factory, CORS, router wiring
tests/               pytest suite
alembic/             migration environment
Dockerfile
docker-compose.yml   api + postgres
```

## Quick start (local, SQLite)

```
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt

set DATABASE_URL=sqlite:///./salvis.db
set JWT_SECRET=dev-secret
set GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

uvicorn app.main:app --reload --port 8000
```

- Interactive API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/healthz

## Quick start (Docker + PostgreSQL)

```
docker compose up --build
```

`AUTO_CREATE_TABLES=true` creates tables on boot for dev. For production set it
to `false` and use migrations:

```
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

## Auth API

| Method | Path              | Body                                       |
| ------ | ----------------- | ------------------------------------------ |
| POST   | /api/auth/register | name, email, password (>=6 chars)          |
| POST   | /api/auth/login    | identifier (email/nickname/SALVIS-id/phone), password |
| POST   | /api/auth/google   | id_token (from Google Identity Services)   |
| POST   | /api/auth/refresh  | refresh_token                              |
| GET    | /api/auth/me       | Bearer access token                        |

All data endpoints require `Authorization: Bearer <access_token>`.

## Data endpoints

- `/api/vaults` — CRUD; `POST /{id}/deposit` and `POST /{id}/withdraw`
  update the ledger and auto-complete the vault at 100%.
- `/api/transactions` — list, optionally filtered by `vault_id`.
- `/api/profiles` — personal/family/joint/custom sub-profiles.
- `/api/bank-accounts` — linked bank records (last4 only, never full numbers).
- `/api/sync/snapshot` — full pull of the user's data.
- `/api/sync/merge` — push local records (with client-generated `id` and
  `updated_at`); conflicts resolve last-write-wins. Returns the fresh snapshot.

## Money handling

Amounts are stored as `NUMERIC(14,2)` (PostgreSQL) to avoid float drift. The
API serializes them as JSON numbers for the web client.

## Next step (frontend integration)

The live PWA still reads/writes `localStorage` via `js/storage.js`. The
follow-up is an `ApiClient` adapter that:
1. Swaps the Google GSI callback / password login for `/api/auth/*` and stores
   JWT tokens instead of the legacy session object.
2. Writes through to `/api/*` endpoints and keeps a localStorage write-through
   cache for offline edits.
3. Uses `/api/sync/merge` on load and after every mutation so data follows the
   user across devices.

## Public scraper deployment

GitHub Pages serves only the static frontend. Deploy the FastAPI service separately so the public Pages app can call `/api/scrape-product`. The repository includes a `render.yaml` blueprint for a free Render web service. After Render creates the service, set `window.SALVIS_API_URL` in `Salvis.html` to the service origin, without `/api/scrape-product`, for example:

```html
<script>window.SALVIS_API_URL = '<your-render-service-host>';</script>
```

The frontend also switches URL vaults to manual-price fallback when no public API URL is configured, so static deployments remain usable.
