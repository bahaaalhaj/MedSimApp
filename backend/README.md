# MedSim backend

## Authentication and progress

The FastAPI process owns account authentication and authenticated training
history. It uses SQLite locally through `auth_system.py`; SQL is isolated in
`migrations/001_auth.sql`, so a later PostgreSQL repository can replace the
SQLite repository without changing the HTTP or frontend contracts.

Tables are initialized reproducibly when the server starts:

- `users`: profile identity and Argon2id password hash.
- `auth_sessions`: hashed opaque session tokens, expiry, last use, and revocation.
- `clinical_encounters`: completed evaluation snapshots owned by `user_id`.

Install and start on Windows:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe backend/server.py
```

The migration runner applies every unapplied `backend/migrations/*.sql` file
and records it in `schema_migrations`; no manual table creation is required.
For local HTTPS-free development use `MEDSIM_ENVIRONMENT=development` and
`MEDSIM_COOKIE_SECURE=0`. Production/Render defaults cookies to secure, and
should explicitly use `MEDSIM_ENVIRONMENT=production` and
`MEDSIM_COOKIE_SECURE=1`; keep `MEDSIM_COOKIE_SAMESITE=lax` unless the
frontend and API truly live on different sites, in which case `none` also
requires HTTPS. Set `MEDSIM_DATABASE_PATH` to persistent storage in production.

Authentication uses an HttpOnly session cookie and a separate double-submit
CSRF cookie/header. Login and registration are rate-limited. Passwords and raw
session tokens are never stored or logged. The existing shared backend secret
protects proxy access but is not treated as user identity.

Authenticated evaluations are stored in `clinical_encounters` and all queries
derive ownership from the verified cookie session. Guests never receive a
database user: their history is stored under
`medsim:guest:<anonymous-id>:eval-history` in that browser. Legacy
`gr_eval_history` data is left untouched and is not merged automatically.

To reset only local development account/progress data, stop the backend and
remove the exact file configured by `MEDSIM_DATABASE_PATH` (the default is
`backend/data/medsim.db`), then restart to reapply migrations. Do not remove the
whole `backend/data` directory if it contains other files.

Current limitations: password reset and email verification are not yet
implemented; SQLite is intended for a single local/server instance; guest data
does not sync between devices and is not migrated into an account.

API surface:

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/auth/me`, `GET /api/auth/session`
- `GET/POST /api/progress/encounters`
- `GET/DELETE /api/progress/encounters/{encounter_id}`

Two Python processes power the simulator:

1. **FastAPI server** (`server.py`) — Managed Agents proxy (`/agent/*`), patient-text-chat SSE (`/agent/patient/stream`), and the LiveKit token mint (`/voice/token`). Lives at `127.0.0.1:8787`.
2. **LiveKit voice worker** (`voice_agent.py`) — joins every room created by `/voice/token`, runs Deepgram Nova-3 STT → Claude Haiku 4.5 → Cartesia Sonic-2 TTS over WebRTC.

Both must be running for real-time voice to work.

## Install

The two processes use **separate venvs** so the worker's deps don't tangle with the FastAPI server's.

```bash
cd backend

# Server venv — small, just FastAPI + Anthropic + livekit-api.
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

# Voice worker venv — pulls in livekit-agents + Deepgram/Cartesia/Silero plugins.
python -m venv .venv-voice
.venv-voice/Scripts/python.exe -m pip install -r voice_agent_requirements.txt
```

## Configure

Copy `.env.example` to `.env.local` and fill in:

- `ANTHROPIC_API_KEY` — Managed Agent + patient persona LLM.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — from LiveKit Cloud.
- `DEEPGRAM_API_KEY` — streaming STT.
- `CARTESIA_API_KEY` — streaming TTS.
- `MEDSIM_AGENT_ID`, `MEDSIM_ENV_ID` — leave blank on first run, paste back from `/agent/bootstrap`.

## Run

```bash
# Terminal 1 — FastAPI
.venv/Scripts/python.exe server.py

# Terminal 2 — voice worker
.venv-voice/Scripts/python.exe voice_agent.py dev
```

The worker logs `registered worker` once it's connected to LiveKit Cloud. From then on, any room created via `POST /voice/token` will dispatch a worker into it; the worker reads the persona payload from room metadata and starts the patient.

## Endpoints

- `GET  /health` — backend + agent + voice config status.
- `POST /voice/token` — body `{caseId, systemPrompt, initialLine, gender}`. Pre-creates a LiveKit room with the persona payload as metadata, returns `{token, url, roomName}`.
- `POST /agent/*` — Managed Agents proxy for the medsim-attending. See inline docs in `server.py`.
- `POST /agent/patient/stream` — text-only patient persona SSE; used by the right-sidebar text chat.
