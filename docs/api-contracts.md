# API contracts

The FastAPI routes under `backend/medsim_backend/routes/` and the TypeScript clients under `src/auth/`, `src/clinical/`, `src/agents/`, and `src/voice/` are the contract sources. This page records the current routes without replacing their schemas.

| Route | Purpose | Notes |
| --- | --- | --- |
| `GET /health` | Runtime/provider readiness | Does not download TTS assets. |
| `POST /api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/session` | Browser session lifecycle | Cookie-backed authenticated session. |
| `GET/POST /api/progress/encounters`, `GET/DELETE /api/progress/encounters/{id}` | Authenticated encounter history | Server-owned persistence. |
| `POST /api/attempts` | Create an owner-bound attempt | Returns the attempt identity used by later clinical actions. |
| `POST /api/attempts/{attempt_id}/investigations/orders` | Record an investigation order | Results are retrieved separately. |
| `GET /api/attempts/{attempt_id}/investigations` | List ordered investigations | Attempt-bound response. |
| `GET /api/attempts/{attempt_id}/investigations/{order_id}` | Retrieve one investigation result | Attempt and order IDs are required. |
| `POST /api/attempts/{attempt_id}/examinations` | Record an examination action | Returns the recorded action identity. |
| `POST /api/attempts/{attempt_id}/diagnosis` | Record submitted diagnosis | The server owns the authoritative comparison. |
| `POST /api/attempts/{attempt_id}/prescriptions` | Record a prescription | The request preserves submitted fields. |
| `POST /api/attempts/{attempt_id}/completion` | Close an attempt | Finalization is idempotency-guarded by the client and server. |
| `POST /agent/patient/stream` | Patient text response | Authenticated, attempt-bound SSE; text is authoritative before optional speech. |
| `POST /api/local-ai/evaluate` | Debrief evaluation | Server restores case/rubric truth and owns arithmetic and critical-failure rules. |
| `POST /tts/synthesize` | Optional local patient speech | Text-only operation remains valid when TTS is disabled; no browser credentials are accepted. |

SSE frames are JSON data frames emitted by the patient-dialogue service and include correlation and completion metadata. Client request/response schemas remain the source of truth; changing paths, statuses, fields, or framing requires a separately reviewed contract change.
