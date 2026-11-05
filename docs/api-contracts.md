# API contracts

The FastAPI routes under `backend/medsim_backend/routes/` and the TypeScript clients under `src/auth/`, `src/clinical/`, `src/agents/`, and `src/voice/` are the contract sources. This page records the current routes without replacing their schemas.

| Route | Purpose | Notes |
| --- | --- | --- |
| `GET /health` | Liveness in pilot mode; richer diagnostics outside it | Pilot health makes no provider request and proves no model readiness. |
| `POST /api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/session` | Browser session lifecycle | Cookie-backed authenticated session. |
| `GET/POST /api/progress/encounters`, `GET/DELETE /api/progress/encounters/{id}` | Authenticated encounter history | Server-owned persistence. |
| `POST /api/attempts` | Create an owner-bound attempt | Returns the attempt identity used by later clinical actions. |
| `POST /api/attempts/{attempt_id}/investigations/orders` | Record an investigation order | Results are retrieved separately. |
| `GET /api/attempts/{attempt_id}/investigations` | List ordered investigations | Attempt-bound response. |
| `GET /api/attempts/{attempt_id}/investigations/{order_id}` | Retrieve one investigation result | Attempt and order IDs are required. |
| `POST /api/attempts/{attempt_id}/examinations` | Legacy examination evidence compatibility | Retained for old clients/history; no current UI control. New assessment policy excludes examination from grading. |
| `POST /api/attempts/{attempt_id}/diagnosis` | Record submitted diagnosis | The server owns the authoritative comparison. |
| `POST /api/attempts/{attempt_id}/prescriptions` | Record a prescription | The request preserves submitted fields. |
| `POST /api/attempts/{attempt_id}/completion` | Close an attempt | Finalization is idempotency-guarded by the client and server. |
| `GET /api/attempts/{attempt_id}/recovery` | Owner-bound active recovery | Six hours in memory; not durable across restart. |
| `POST /api/attempts/{attempt_id}/dialogue/acknowledgements` | Idempotent client receipt | Owner-bound `{requestId}`; no duplicate evidence or inference. |
| `POST /agent/patient/stream` | Patient text response | Authenticated, attempt-bound SSE; text is authoritative before optional speech. |
| `POST /api/local-ai/evaluate` | Debrief evaluation | Server restores case/rubric truth and owns arithmetic and critical-failure rules. |
| `POST /tts/synthesize` | Optional local patient speech | Text-only operation remains valid when TTS is disabled; no browser credentials are accepted. |

SSE frames are JSON data frames emitted by the patient-dialogue service and include correlation and completion metadata. Client request/response schemas remain the source of truth; changing paths, statuses, fields, or framing requires a separately reviewed contract change.

New attempts carry the server-owned `gradingPolicy=examination-excluded-v1`.
Evaluation adds optional `assessment_scope` metadata listing excluded criteria,
their original weights and reasons; these are **Not assessed**, outside the scored
`criteria` array. Scored maxima sum to 85 (data gathering 50) with other rule
weights unchanged. Responses for old attempts and saved evaluations need not
contain this optional metadata and retain their original rubric/denominators.
No examination evidence field, compatibility endpoint or database record was removed.

Current browser creation negotiates optional `dialogueDeliveryVersion: 1`. Its SSE terminal includes `correlationId` and `requiresAcknowledgement`; request IDs are required and cannot be reused for a different question. Server recording precedes SSE receipt. Until acknowledged, the recovery view includes `pendingDialogueRequestIds` and correlated transcript rows; fresh turns/evaluation return 409. Replay of the same cached request is allowed. Recovery adopts text before sending a receipt and opens Chat. Receipts acknowledge client text acceptance, not reading, rendering or audio. Legacy attempts omit this negotiation and retain compatibility. Cached/saved evaluations return unchanged, without regrading.

Pilot dialogue uses 7.8/8.0 seconds; ordinary defaults are 3.0/3.2. The evaluator outer budget remains 3.5 seconds. Canonical `potentially-harmful` orders now activate the existing investigation no-credit rule and formative feedback. No clinical record, penalty or weight changed; newly generated evaluations may differ from historical results. See [current scoped report](pilot-preparation-20261105.md).
