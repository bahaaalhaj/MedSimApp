# Deployment and local setup

## Local development

1. Install Node.js 22.x and Python 3.12.x.
2. Run `npm ci`.
3. Create a backend virtual environment and install `backend/requirements.txt`.
4. Copy `backend/.env.example` to `backend/.env.local`; keep secrets out of Git.
5. Start FastAPI with `backend/.venv/Scripts/python.exe backend/server.py` on Windows (or the platform equivalent), then run `npm run dev`.

OpenRouter is the hosted default and requires a user-supplied server-side key for live model calls. Patient text remains usable with deterministic/safe fallback paths. Kokoro is optional for local speech: install `backend/requirements-tts.txt`, prepare its cache explicitly with `backend/prepare_kokoro.py`, and confirm `/health`. CI intentionally does none of these model/TTS steps.

## Production boundary

The temporary Windows student pilot uses [its dedicated loopback launcher](windows-student-pilot.md)
and serves `dist/` on port 8788. It does not use `vercel.json`, `middleware.ts`
or `backend/Procfile`. Those retained files describe the alternative historical
Vercel/Render deployment: the middleware and rewrites refer to the old Render
hostname, and the Procfile binds a platform-assigned port. They are not pilot
startup instructions. Their presence does not establish that deployment's current
availability. Do not substitute that backend URL into the pilot configuration.

Deploy the Vite build and FastAPI service according to the hosting environment’s secret and database controls. Set `BACKEND_SHARED_SECRET`, database/session settings, allowed origins, and provider settings on the server only. Do not expose OpenRouter or TTS credentials to browser code. SQLite runtime files, model caches, generated audio, and local `.env.local` files are operational artifacts and are excluded from the repository.

Technical deployment success does not establish clinical approval, accreditation, or suitability for real-patient care.
