# MedSim backend

FastAPI owns authentication, server-bound encounter attempts, investigation snapshots, provider-neutral patient text streaming, hybrid evaluation, and local Kokoro speech.

## API surface

- `GET /health` — safe configured-provider, patient, evaluator, and TTS readiness.
- `POST /api/attempts` — idempotently creates one owner-bound case/version/variant attempt.
- `POST /agent/patient/stream` — attempt-bound SSE patient text; no browser prompt/history fields.
- `POST /api/local-ai/evaluate` — one evidence-only hybrid evaluation with deterministic fallback.
- `POST /tts/synthesize` — local patient WAV synthesis.
- `POST /api/auth/*` and `GET/POST /api/progress/encounters` — account and history services.

Copy `.env.example` to `.env.local`, manually add `OPENROUTER_API_KEY`, and run `scripts/check-openrouter.ps1`. Authored and clearly unavailable questions return immediately; ambiguous text gets one Mini attempt with a maximum 3-second patient deadline. Pro stays allowlisted but disabled and is never chained after Mini. Failure immediately uses authored or safe-unknown text. The separate 7-second general timeout applies to optional evaluator enrichment.

`MEDSIM_DATABASE_PATH` is resolved from the repository application root when it
is relative, so `backend/data/medsim.db` is the same path whether the backend is
started from the repository root or `backend/`. Absolute database paths are used
as given. SQLite runtime files and journals are intentionally untracked.

Run `backend/.venv/Scripts/python.exe backend/prepare_kokoro.py` once before MedSim. Runtime validates the cache and forces offline mode before Kokoro can initialize. Use `backend/.venv/Scripts/python.exe backend/prepare_authored_audio.py --case-id im-003` to explicitly prepare one case's greeting and authored answers, or `--all` for all 72 cases. Prepared WAV files use a bounded content-addressed cache at `~/.cache/medsim/tts` by default; no username or repository path is embedded. Login and text interaction do not initialize Kokoro, and runtime never downloads missing assets. `/health` reports `deferred`, `loading`, `ready`, or `failed` plus persistent-cache statistics.

The optional offline scripts require both `MEDSIM_LLM_PROVIDER=llama_cpp` and `MEDSIM_LOCAL_LLM_ENABLED=true` and retain the 2.5 GB physical-memory gate. Kokoro remains CPU-only on the supported 8 GB profile. Patient text is stored before synthesis; a TTS failure does not remove grading evidence.

See [AI architecture](../docs/local-ai-architecture.md) and [audio architecture](../docs/audio-architecture.md).
