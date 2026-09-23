# Backend schema boundary

The executable request schemas live in `backend/medsim_backend/schemas.py`; authentication and progress models live in `backend/auth_system.py`. Pydantic models reject unknown fields where encounter/evidence payloads are safety-sensitive and bound strings, lists, IDs, timestamps, and transcript sizes.

The core identity chain is `attemptId → caseId + caseVersion + variantSeed`. Investigation, examination, diagnosis, prescription, completion, transcript, and evaluation evidence are attempt-bound. The evaluation request is evidence-only from the browser; the evaluation service restores the authoritative case, rubric, weights, diagnosis, critical rules, references, and server-recorded orders before scoring.

SQLite authentication/progress storage is created by the existing migrations in `backend/auth_system.py`. `MEDSIM_DATABASE_PATH` may be absolute or repository-relative; runtime database, journal, cache, and generated-audio files are operational artifacts and are not tracked.

This page documents ownership and boundaries, not a second schema. Route status codes, field names, and SSE framing remain defined by the executable routes and their contract tests.
