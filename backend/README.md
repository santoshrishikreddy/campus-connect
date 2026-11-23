# Campus Connect API

FastAPI endpoints backed by Supabase Auth and PostgreSQL. The API follows the handoff contract: the registration request contains only `event_id`; the server derives the attendee from the verified bearer session. PostgreSQL locks the event row while checking capacity, so simultaneous registrations cannot overbook an event.

## Setup

1. Install dependencies with `python -m pip install -r requirements.txt`.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `backend/.env` or the process environment.
3. Run `schema.sql` in the Supabase SQL Editor. It creates the schema, auth profile trigger, ownership policies, uniqueness constraint, and atomic registration RPC.
4. Start the API from this directory with `python app.py` (port 8000 by default), or `uvicorn app:app --reload`. Interactive docs are at `/docs`.

## Deploy to Render

If this backend folder is its own repository, create a Render **Blueprint** from it; `render.yaml` defines the service, build/start commands, health check, and prompts for the two Supabase settings. If this folder is inside a monorepo, create a **Python Web Service** from the repository and set **Root Directory** to `backend`, then use these settings:

- **Build Command:** `python -m pip install -r requirements.txt`
- **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
- **Health Check Path:** `/health`

In the service's **Environment** settings, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using the values from your Supabase project. `.env` is ignored by Git; use `.env.example` as the local template and never upload real credentials. Apply `schema.sql` to the Supabase project before using the API. Render supplies the `PORT` value at runtime.

## Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/` | No | API overview |
| GET | `/health` | No | Process health |
| GET | `/api/events` | No | List public events |
| GET | `/api/events/{event_id}` | No | Get one event |
| POST | `/api/events` | Bearer | Create an event owned by the signed-in user; body: `title`, optional `capacity`, `status` |
| PATCH | `/api/events/{event_id}` | Bearer | Update an event owned by the signed-in organizer |
| DELETE | `/api/events/{event_id}` | Bearer | Delete an event owned by the signed-in organizer |
| GET | `/api/registrations` | Bearer | List the signed-in user's registrations |
| POST | `/api/registrations` | Bearer | Register current user; body: `{"event_id":"<uuid>"}` |
| DELETE | `/api/registrations/{registration_id}` | Bearer | Cancel own registration |

Send authenticated requests with `Authorization: Bearer <Supabase access token>` and JSON requests with `Content-Type: application/json`. Registration succeeds with `201`; duplicate registrations or full events return `409`. The server ignores client-supplied user identity because the registration schema accepts only `event_id`.
