# MedSim backend

One FastAPI process provides account authentication, account-owned progress, AI patient text streaming, the attending debrief proxy, and local patient text-to-speech.

## Windows installation

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-tts.txt
Copy-Item backend/.env.example backend/.env.local
backend/.venv/Scripts/python.exe backend/server.py
```

Kokoro also uses `espeak-ng` for English out-of-dictionary fallback. Install its Windows x64 package and make sure it is available on `PATH`. The first synthesis downloads model assets into `PATIENT_TTS_MODEL_CACHE_DIR`; weights and generated audio are ignored by Git.

The optional Chatterbox provider is not part of the default requirements and is never imported while disabled. Install `chatterbox-tts==0.1.7`, set `PATIENT_TTS_ENABLE_CHATTERBOX=true`, and select it explicitly. Voice cloning is not exposed.

See [the full patient audio architecture](../docs/audio-architecture.md) for providers, devices, licensing, benchmark instructions, and troubleshooting.

## Authentication and progress

SQLite tables are initialized from `migrations/*.sql`. Authentication uses an HttpOnly session cookie and double-submit CSRF protection. Passwords are Argon2id hashes; raw sessions are not stored. Authenticated evaluations are owned by the user in `clinical_encounters`. Guests remain browser-local and are not silently merged.

Local development uses `MEDSIM_ENVIRONMENT=development` and `MEDSIM_COOKIE_SECURE=0`. Production should set `MEDSIM_ENVIRONMENT=production`, `MEDSIM_COOKIE_SECURE=1`, a persistent `MEDSIM_DATABASE_PATH`, and a strong `BACKEND_SHARED_SECRET` shared only with the frontend proxy.

## API surface

- `GET /health` — backend, attending-agent, and local-TTS configuration status; does not load a model.
- `POST /agent/patient/stream` — text-only AI patient response stream.
- `POST /tts/synthesize` — authenticated/proxied local patient WAV synthesis.
- `POST /agent/*` — attending Managed Agent lifecycle.
- `POST /api/auth/*` — account lifecycle.
- `GET/POST /api/progress/encounters` — account-owned evaluation history.

## Checks

```powershell
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
backend/.venv/Scripts/python.exe backend/tts_benchmark.py
```

The benchmark does not write an audio file. It reports the selected provider/device, load-plus-synthesis time, buffered time to first audio, output duration, real-time factor, and process memory where measurable.
