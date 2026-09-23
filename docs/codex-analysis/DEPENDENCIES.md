# Dependencies and configuration

This inventory reflects the current runtime. Older dependency claims are retained in `docs/archive/` and are not current implementation guidance.

The frontend uses React, Three.js, Zod, TypeScript, and Vite. It has no browser audio-transport dependency and never captures learner audio.

The base Python environment uses FastAPI, Uvicorn, Pydantic, HTTPX, SlowAPI, Argon2, and email-validator. It does not install a hosted-model SDK. `requirements-tts.txt` adds local Kokoro, its English G2P/runtime dependencies, and SoundFile. Chatterbox is an optional explicit installation.

Patient speech configuration uses `PATIENT_TTS_PROVIDER`, `PATIENT_TTS_DEVICE`, `PATIENT_TTS_FALLBACK`, `PATIENT_TTS_MODEL_CACHE_DIR`, `PATIENT_TTS_ENABLE_CHATTERBOX`, `PATIENT_TTS_SPEED`, and `PATIENT_TTS_LANGUAGE`. Sensitive server values include `OPENROUTER_API_KEY`, `BACKEND_SHARED_SECRET`, authentication settings, and database/session configuration; they remain server-only.

Development proxies `/api/*`, `/agent/*`, and `/tts/*` to FastAPI on port 8787. Model caches and generated audio are excluded from Git.
