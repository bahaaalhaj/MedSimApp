# Vercel student demo (separate from the Windows pilot)

This branch adds an explicit `vercel-guest-demo` deployment. It runs the existing
MedSim case selection, text interview, investigations, diagnosis, prescriptions,
85-point formative assessment and browser guest history. It does not deploy a
replacement mock. No cloud resource or deployment is created by these instructions.

## What stays local

`backend/server.py`, `backend/pilot_server.py`, Vite development and the Windows
start/stop scripts retain accounts, SQLite history and optional Kokoro audio.
Their ignored configuration and assets are not changed. Ordinary builds use
`dist`; `npm run build:demo` uses **`dist-demo`**, omits the public music asset,
and starts with accounts/audio disabled. The frontend checks server capabilities
before mounting; a build/server mode mismatch fails visibly.

The demo entry is `api/index.py`, not `backend.server`. Its dependency list is the
`api/requirements.txt` beside its entry (and `api/.python-version`); Windows retains
`backend/requirements*.txt`. This nearest manifest avoids the root Ruff-only
`pyproject.toml` shadowing function dependencies. Demo startup
does not import authentication/SQLite, TTS, Kokoro or Torch. No account/history or
TTS routes are registered. No audio context, synthesis request, music or audio
controls are used in the demo. Audio components and assets remain in the repository.

## Shared state and limits

- Six-hour **fixed** attempt expiry, including completed evaluations; reads,
  replay and writes do not extend it. At most 32 unexpired attempts per signed
  guest. The demo rejects further creation rather than silently evicting one.
- All state uses Redis, with no memory fallback. Cookie identity is HMAC signed
  with an environment-provided 32-byte key shared across instances. Cookies are
  host-only, `Secure`, `HttpOnly`, `SameSite=Lax` and prefixed `__Host-`.
  Browser IDs, IP/UA and forwarded headers cannot authorize an attempt.
- Every attempt operation uses an owner check. Exact Host and matching
  Origin/Referer protect unsafe requests; cross-site requests and ambiguous
  headers are rejected. There are no wildcard preview origins.
- Short transactions use a five-second token-owned Redis lock and revision CAS.
  A lost lock cannot commit or release its successor. Redis waits in async
  dialogue/evaluation paths run off the application event loop.
- Thirty-second logical patient/evaluation leases fence late invocations.
  Recovery clears expired busy flags. Evaluation runs in the invocation, without
  relying on a background task or shield surviving termination. Successfully
  persisted evaluations are replayed unchanged across instances.
- A maximum of 100 request IDs per encounter bounds the replay journal. Successful
  replies persist before SSE delivery and retain replay/ACK/evidence semantics.
  A failed/interrupted demo request ID is never dispatched again. Recover first;
  if no reply was recorded, a **new manual submission** uses a fresh ID. There is
  no automatic retry. This favors avoiding duplicate inference after an ambiguous
  serverless interruption; it cannot prove whether an upstream server processed
  a request whose reply was lost. Expiry/Redis loss also ends idempotency retention.
- Hosted admission is shared across instances: **one active completion**, at most
  **6/minute globally**, **3/minute per signed guest**, **40/day globally** (UTC
  fixed windows). Patient and optional evaluator completions both count. Rejected
  admission fails immediately; there is no global wait queue. Active admission
  expires after 15 seconds if the invocation dies. This is a supervised demo,
  not unlimited classroom capacity. These limits do not guarantee upstream quota.
- The pinned free model and zero-price request caps remain unchanged, with no
  completion retries, model chain or paid fallback. Demo patient inner/semantic
  budgets are 7.8/8.0 seconds; ordinary defaults remain 3.0/3.2 and Windows pilot
  overrides remain 7.8/8.0. Evaluator budget remains 3.5 seconds and deterministic
  fallback retains server grading authority. Storage/startup/delivery add time
  outside the semantic provider budget. Pooling/TLS preparation does not establish
  provider reliability. Configured evaluator readiness does not perform metadata
  warmup and is not independent upstream availability/model confirmation.

Only server-owned evidence version 2 and acknowledged dialogue version 1 are
accepted for new demo attempts. New examination remains Not assessed; raw maximum
85/data gathering 50 and all other weights/thresholds are unchanged. Clinical
facts, references, scoring and historical local records are not migrated/regraded.

## Manual Upstash setup — account-owned Free database

1. Sign in to your own [Upstash Console](https://console.upstash.com/). Open Redis,
   choose **Create Database**, name it for this demo and select a primary region
   near the chosen Vercel function region. Select **Free** at the plan step.
   Stop if Free is unavailable; do not enable billing, auto-upgrade or a paid plan.
2. Confirm the database appears in your account and is not an anonymous temporary
   database. Do **not** use the anonymous `start-redis` endpoint or a three-day DB.
   Account-owned service retention/Free limits still follow Upstash's terms;
   check the dashboard before each pilot.
3. In database details copy the HTTPS **REST URL** and full read/write **REST token**
   directly into Vercel's server environment fields. The implementation requires
   EVAL, GET/SET, sorted-set, hash, expiry and PING commands; a read-only token
   cannot work. Never paste values into chat, Git, screenshots, frontend variables
   or a committed environment file.

See [official setup](https://upstash.com/docs/redis/overall/getstarted),
[REST command format](https://upstash.com/docs/redis/features/restapi) and
[Lua EVAL](https://upstash.com/docs/redis/commands/scripting/eval).

## Manual Vercel preview setup

Create a **separate Vercel project** for this branch. Do not replace or redeploy
an existing pilot project. Import `bahaaalhaj/MedSimApp`, choose branch
`feat/vercel-guest-demo`, root directory `.`, Vite framework and Node 22.x.
The checked-in configuration selects `npm run build:demo`, output `dist-demo`,
Python 3.12 and a 30-second function duration. Use Preview scope initially and
keep preview access protection enabled where available. Do not promote to
Production or invite students before acceptance. Account/plan restrictions are
external deployment prerequisites, not something this branch enables or purchases.

Required **server-only** settings (enter values in Vercel, not chat):

| Variable | Required setting |
| --- | --- |
| `MEDSIM_DEPLOYMENT_MODE` | `vercel-guest-demo` |
| `MEDSIM_DEMO_ORIGINS` | Comma-separated exact HTTPS origins, no slash/wildcard; use the stable branch preview alias actually shown by Vercel |
| `MEDSIM_DEMO_NAMESPACE` | Unique 1–48 character name using letters/digits/underscore/hyphen; separate preview from any future production demo |
| `MEDSIM_DEMO_GUEST_SIGNING_SECRET` | 32 cryptographically random bytes encoded as 64 hex characters; stable across instances/deployments of this demo |
| `UPSTASH_REDIS_REST_URL` | Account-owned database HTTPS REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Full read/write REST token |
| `MEDSIM_LLM_PROVIDER` | `openrouter` |
| `OPENROUTER_API_KEY` | Existing approved server-owned OpenRouter key, entered directly in the dashboard |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3.5-super-vl:free` |
| `OPENROUTER_FALLBACK_MODELS` | Empty |
| `OPENROUTER_PRO_FALLBACK_ENABLED` | `false` |
| `OPENROUTER_ALLOW_PAID_MODELS` | `false` |
| `OPENROUTER_MAX_RETRIES` | `0` |
| `MEDSIM_LOCAL_LLM_ENABLED` | `false` |

Generate the guest key locally using an OS cryptographic generator and transfer
it directly to the dashboard/password manager. Do not reuse Windows signing or
backend shared secrets. No `BACKEND_SHARED_SECRET`, SQLite path, session-signing
key, local TTS/model path or credential-valued `VITE_*` setting is needed here.
Do not change ignored local configuration to supply these cloud settings.

If the first preview URL is not known before creation, the backend must remain
closed: set only a known project origin initially, copy Vercel's **stable branch
preview alias** from the deployment, add that exact origin to Preview environment
settings, redeploy, then open the alias. Immutable deployment URLs change on
redeployment; they are rejected unless explicitly included. Never solve this by
allowing `*.vercel.app` or trusting `X-Forwarded-Host`. Check actual function Host
behavior in preview; the app deliberately does not infer trusted origins from
arbitrary proxy headers.

`vercel.json` replaces the obsolete Render proxy for this separate deployment.
The old credential-forwarding Edge middleware is removed. `/api`, `/agent` and
`/health` go to the Python function. Only production output is public; unsupported
paths return 404. MedSim navigation uses the existing hash routes, so no broad
SPA rewrite to source/private paths is needed. Required manifests are function
files, not frontend assets. Function exclusions omit auth/TTS/local entry points,
private records, environment files, models, logs, tests and frontend sources.

The 237-character exclusion rule is a default-deny layout: only `api/index.py`,
the four named root backend modules and Python files in the backend package,
routes and services remain eligible. Ordinary runtime/pilot/diagnostic entries,
hidden files, nested asset directories and non-Python files are excluded. Only
the three exact server manifests are restored through `includeFiles`; broad
includes would override exclusions and are prohibited by tests. `.vercelignore`
remains defense in depth, not a substitute for function packaging rules.

`npm run verify:vercel` validates the **complete** configuration against the pinned
official schema, including its 256-character limit for both glob strings. It runs
in CI and before `build:demo`. Packaging tests use Vercel's own glob implementation,
including include-after-exclude behavior. See [schema provenance](../scripts/verify/schemas/README.md)
and [the deployment-blocker fix report](vercel-packaging-fix-20261118.md).

Current official references:
[Python runtime/dependencies/streaming/bundling](https://vercel.com/docs/functions/runtimes/python),
[function and routing configuration](https://vercel.com/docs/project-configuration/vercel-json).
The application also supports invocation-owned provider lifecycles when a
serverless adapter does not deliver ASGI startup/shutdown. Actual platform
packaging/ingress/SSE still require the preview checks below.

## Acceptance before sharing a link

No hosted model calls are required for implementation tests. A future live
acceptance must be explicitly budgeted; do not use these instructions as
authorization for bulk inference or evaluator calls.

1. Inspect the actual Vercel build/function bundle. Confirm only the demo entry
   and required manifests are present, no SQLite/auth/TTS/model assets or secrets,
   and startup succeeds with the real Redis. GET `/health` and `/api/capabilities`
   must report demo/audio false and fail clearly when Redis is unavailable.
2. In a new browser profile, check guest-only entry, no login/registration,
   music/volume/replay/audio controls, no AudioContext/synthesis/music request.
   In a separate ordinary Windows session, confirm normal audio controls and
   local Kokoro/text fallback remain available. Do not restart active students.
3. Enter a case, ask an authored History question (no inference), verify complete
   text and exactly one terminal `done`, refresh, Back/Forward, recover the same
   attempt and ensure no duplicate transcript evidence. Test lost receipt/replay.
4. Use another isolated browser profile with the same URL: copied attempt IDs
   must return 404. Verify different guest namespaces/history. Inspect cookie
   flags, reject foreign Origin/Host and forged forwarded headers. Direct source,
   manifest, environment/database and `/tts` URLs must return 404.
5. Order/release results, submit diagnosis/prescription/completion and evaluate
   with a specifically authorized optional evaluator budget (or an offline test
   provider). Confirm authoritative evidence, 85-point maximum, historical local
   reviews untouched, and cached debrief replay across instances. Abort an
   evaluation, recover after lease expiry and verify no permanent busy flag.
6. Only after separate authorization, perform a minimal semantic hosted turn with
   fresh IDs: require grounded text and terminal success, report upstream identity
   separately from configuration. HTTP 200 alone is never success. Check streaming
   delivery on the actual Vercel origin and real Redis latency/Free limits.

## Expiry, clearing and rollback

Attempts, creation-idempotency keys and owner indexes expire in six hours.
Short transaction locks expire in five seconds; busy operation leases are checked
against their 30-second deadline on the next operation. Provider admission expires
in 15 seconds, minute counters within two minutes, daily counters within two days.
Browser-saved guest reviews are separate and do not expire with Redis attempts.
Closing a browser may drop its session cookie; that can end recovery access even
before server expiry. Rotating the signing key deliberately invalidates guest
ownership; do not rotate during students' encounters.

To clear just this demo, stop sharing/disable its deployment, inspect keys with
SCAN matching `medsim:demo:{<namespace>}:*` in the **dedicated demo database**, then
delete only those selected keys in bounded batches. Include attempts, owner and
creation indexes and admission counters. Never FLUSH a shared database. Clear
browser guest history separately through the application/browser when desired.
Changing namespace isolates a new demo but leaves old keys until their TTLs;
changing namespace alone is not immediate deletion.

In the dedicated database's console CLI, start with `SCAN 0 MATCH
medsim:demo:{<namespace>}:* COUNT 100`, repeat with each returned cursor until
zero, review the returned key names, then use `DEL <reviewed-key-1>
<reviewed-key-2>` in small batches. Substitute the configured namespace and actual
reviewed keys; these are not literal angle-bracket arguments. Do not put REST
credentials into a terminal command or shell history.

Rollback by disabling this separate Vercel project/preview or selecting its last
verified deployment and matching environment. Keep the Windows project, database,
credentials, Kokoro assets and scripts untouched. Never direct a demo deployment
to the historical Render backend. Do not merge this branch automatically.

## Local reproduction

Use a disposable real Redis listening on loopback, not the production Upstash DB.
CI starts a Redis service and requires these tests (no dictionary mock):

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:16379'
$env:MEDSIM_LLM_PROVIDER = 'openrouter'
$env:OPENROUTER_API_KEY = ''
$env:MEDSIM_LOCAL_LLM_ENABLED = 'false'
$env:PATIENT_TTS_PROVIDER = 'disabled'
$env:PATIENT_TTS_FALLBACK = 'disabled'
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
npm test
npm run verify
npm run build
npm run security:scan-frontend
npm run build:demo
node scripts/verify/frontend-answer-leakage.ts dist-demo
```

These are shell-process test settings; they do not edit local environment files.
Redis tests clean only their random test namespace. Ordinary local operation
continues using its in-memory store. Public acceptance remains manual.
