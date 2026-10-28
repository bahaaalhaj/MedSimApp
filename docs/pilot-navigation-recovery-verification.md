# Pilot navigation, recovery and audio investigation — 2026-10-28

This is the follow-up to `windows-student-pilot-verification.md`. The work began
with the earlier pilot implementation already modified/untracked. Those changes
were preserved. Read the pasted request, repository `AGENTS.md`, Git status,
both Windows pilot reports and affected source/consumers before editing. No
commit, push, reset, public tunnel, hostname change, provider/model/deadline
change, or clinical/scoring edit was performed.

## Evidence and causes

| Reported issue | Established evidence | Remaining uncertainty |
| --- | --- | --- |
| Browser Back goes outside the expected flow | `Store.setScreen()` only changed an in-memory field. No URL/history integration existed. Reproduced at the application layer; regression exercises the actual Store/history adapter. | Browser UI behavior still needs acceptance testing. |
| Refresh loses evaluation/encounter context | Store started at splash; no route/checkpoint restore existed. Backend already cached evaluation results but exposed no retrieval route. Refresh reconstruction now exercises real Store code against a scripted HTTP boundary. | Unsynced actions and unsubmitted form drafts cannot be recovered from the server. |
| Mobile evaluation did not complete | Old hook had a 12-second client connection timeout with no functional retry. Server evaluation busy state lacked cancellation/exception cleanup. A disconnected caller could strand it. Cancellation/exception failures are reproduced in regression tests. | No log identifies which failure occurred on the reported phone. Do not attribute this to a device. |
| Provider-related evaluation delay | Retained `backend/data/pilot/stderr.log` contains `evaluation-fallback`, category `evaluation-timeout`, at **12:09:28 UTC**, server request ID **ef034fe6-e564-4784-ac76-8f99438c3add**. This means optional enrichment timed out; it does not establish a failed deterministic result or identify a device. | No matching client trace was retained. The 3.5-second enrichment budget and deterministic fallback remain unchanged. |
| Delayed patient audio | Text entry was blocked while optional audio was preparing. Autoplay resume was awaited without an explicit usable gesture recovery. Current configured offline smoke: cold **57.483 s** (initialization **55.230 s**, synthesis **2.158 s**); warm **1.992 s** (synthesis **1.900 s**); cache **0.002 s**. Valid WAV durations **1.825/1.925 s**. Previous cold run was 119.410 s. | Real autoplay restrictions, network/download/decode/playback and queue contention on the reported phone are unmeasured. Run order and machine/cache conditions differ between cold measurements. |
| Shared audio interference | TTS supersession was keyed globally by case ID. Two attempts on the same case could invalidate one another's queued request. A queued two-attempt test now passes with attempt-scoped supersession. | The reported laptop/mobile observations were sequential; this is a separate discovered defect, not proof of their cause. |
| Reopen skips login | Signed session restoration is intentional, separate from encounter recovery. Auth cookies survive ordinary refresh and, depending on Remember/browser settings, reopening. | Real HTTPS browser cookie behavior remains unverified in this run. |

The retained log also has resource 404s and two login 401s; it contains no
device-correlated SSE/TTS failure trace. New diagnostics return a server-generated
UUID in `X-MedSim-Request-Id`, retain numeric `Server-Timing` through the pilot
boundary and log selected route templates/status/durations. They do not log
request bodies, cookies, credentials, attempt URL values or dialogue. Client
evaluation errors show the support ID. Existing provider diagnostics keep their
safe error categories. Audio timing details separate request-to-headers,
download and decode; server headers separate initialization/synthesis when
available. Request-to-headers includes server work and transport, not pure
synthesis. Scripted playback tests are not physical-device timing measurements.

## Navigation inventory and policy

All 11 screens remain in the singleton Store: splash, onboarding, auth, home,
gpRoom, library, brief, encounter, endConfirm, debrief and history. No routing or
state library was added. `/#/<screen>` routes work with the restricted static
server. `case`/`review` parameters select a public case or an owner-authorized
saved review; attempt references remain in history state, outside the URL.

| Control | Behavior |
| --- | --- |
| Welcome/auth arrow | Back to splash; reuse a matching preceding entry, otherwise replace the current route. |
| Onboarding Back/Next | Previous/next step; steps have history entries and refreshable step parameters. |
| GP room “Back to corridor” | Back to home/profile. |
| Library Back | Back to GP room. |
| Saved history Back | Back to home/profile. |
| End-confirm Back | Back to the active room. |
| Live debrief Back | Back to GP room. |
| Saved debrief Back | Back to saved history. |
| Top-bar wordmark/profile and breadcrumbs | Explicit destination navigation; meaningful active-work exit prompts. Finished-room destinations explain the debrief restriction. |
| Examine button/E | Push one overlay entry. Browser Back closes it; Forward reopens it. |
| Examine Close/Escape/backdrop | Reuse the preceding room entry when present; direct overlay entry closes in place. |
| Examine tabs; diagnosis “go to Rx” | Local tab state, no browser entry per tab. Reopening defaults to History. |
| Result details; image close | Local disclosure/viewer state; current ResultsTab has no populated image URLs. No new browser entries. |
| Login/register tabs and guest notice | Local form selection; no history entry per edit or tab. |

Evidence/chat updates and server-attempt binding do not push history entries.
Rejected Back exits restore the current history index. In-app Back uses a matching
preceding entry or replaces its fallback destination, avoiding a reverse-link
loop. Leaving/replacing meaningful unfinished work prompts; logout/guest exit
also warn. Identity invalidation itself cannot be cancelled. No `beforeunload`
dependency was introduced. Direct encounter links cannot silently create a new
patient. Returning to a finished encounter explains why only its debrief is
available. Unknown fragments normalize to the welcome screen.

## Recovery, identity and grading

Only a route/case/attempt reference is retained in owner-namespaced tab storage.
Refresh reconstructs learner-visible state from `GET /api/attempts/{id}/recovery`.
The endpoint authorizes the current account or signed guest, checks case version,
and explicitly selects safe fields: observed transcript without audits, already
shown predefined answers, recorded actions, released investigation snapshots,
and grading status/result. It never returns the raw attempt, hidden case manifest,
rubric or private dialogue audit. Unreleased order snapshots stay withheld.

The browser does not submit restored transcripts or cached scores as grading
authority. Existing validated action APIs remain idempotent; grading uses server
evidence. A pending grading task is shielded from an HTTP caller disconnect,
concurrent retry joins it, exceptions clear the busy flag, and completed results
are retrieved before another POST. Grading and save retries are separate. Server
SQLite review insertion and browser guest review insertion deduplicate by owner
and server attempt, without migrating/deleting existing records. Already duplicated
historical records are untouched.

Account sessions: **24 hours**, Remember me **30 days**, registration remembers.
Pilot cookies remain Secure, HttpOnly for identities, host-only and SameSite=Lax.
Auth initialization shows a loading view without redirecting a pending session.
Visibility/pageshow and a visible minute timer revalidate sessions. A failed
logout reports that the session is still active; successful logout revokes it,
clears private in-memory/recovery/audio state and gates old Back entries. Expired
or revoked sessions are rejected server-side. Different guests and accounts on
the same tunnel remain separate owners; sharing one browser profile still shares
its cookies and guest history by design.

Active attempts remain process-local: **six-hour absolute TTL**, **32 per owner**.
Restart loses them and rotates the anonymous signing key. A remembered account
and SQLite saved reviews survive. A root reopen offers a same-tab recovery
reference when available; it never starts/resumes a clinical encounter merely
because authentication succeeded. New tabs are not an encounter-discovery API.

## Changes in this follow-up

New files:

- `src/game/pilotNavigation.ts`, `src/game/attemptRecovery.ts` — history and safe reconstruction.
- `src/agents/debriefClient.ts` — retrieval, synchronization and evaluation contract validation.
- `scripts/test/pilot-navigation.test.ts`, `scripts/test/debrief-recovery.test.ts` — actual bundled application logic with controlled browser/network surfaces.
- `backend/tests/test_recovery.py` — real routes, owners, sessions, disconnects, idempotence and TTS scope/headers.
- This report.

Modified application files:

- `src/App.tsx`, `src/game/store.ts`, `src/game/types.ts` — guarded bootstrap, route/overlay state, checkpoint, recovery/exit UI and investigation resumption.
- `src/auth/AuthProvider.tsx` — revalidation, stale bootstrap response guard, honest logout and private-state cleanup.
- `src/components/auth/AuthScreen.tsx`, `OnboardingScreen.tsx`, `CaseLibraryScreen.tsx`, `GPRoomScreen.tsx`, `HistoryScreen.tsx`, `EndConfirmScreen.tsx`, `EncounterScreen.tsx`, `DebriefScreen.tsx` — arrows, lifecycle and actionable recovery/retry.
- `src/components/debrief/GradingProgress.tsx`, `EvaluationDetails.tsx` — honest pending state and visible fallback provenance. Removed timer-driven claims of completed grading stages.
- `src/agents/useLocalDebrief.ts`, `src/clinical/investigationApi.ts`, `src/data/evalHistory.ts` — cancellation/retry and guest-save deduplication.
- `src/voice/ConversationState.ts`, `OrderedAudioQueue.ts`, `WebAudioPlayback.ts`, `conversation.ts`, `conversationStore.ts`, `conversationTypes.ts`, `localPatient.ts`, `ttsSynthesis.ts`; `src/components/DockedPatientAudioPanel.tsx`, `three/FloatingPatientAudioPanel.tsx` — text during synthesis, explicit Enable, decoded replay cache, restored conversation without repeated greeting/evidence, timing and cancellation.
- `backend/medsim_backend/services/attempt_service.py`, `patient_dialogue_service.py`, `evaluation_service.py`; `routes/attempts.py`, `routes/diagnostics.py`; `diagnostic_logging.py`, `pilot.py`; `backend/tts/providers.py`; `backend/auth_system.py` — safe recovery, grading lifecycle, correlation/timing, attempt-scoped speech and review deduplication.
- Existing tests `scripts/test/auth.test.ts`, `consultation-timing.test.ts`, `frontend-component-contract.test.ts`, `patient-grounded-flow.test.ts`, and `backend/tests/test_route_contract.py` updated for the coherent new contracts.
- `docs/windows-student-pilot.md` updated with route, session and recovery limits. Previous preparation report remains historical evidence.

The earlier pilot entry point/scripts/security/tests and all unrelated initial
changes remain in place. Provider configuration, actual SQLite rows, secrets,
case content and clinical scoring were preserved.

## Current checks and acceptance boundary

Logs are local, ignored files under `backend/data/`, not served assets. No real
account records were used by tests; backend tests use temporary SQLite and block
external Python networking. No hosted completion calls were made.

| Check | Actual result in this follow-up |
| --- | --- |
| Frontend behavioral/contract suite | **127 passed, 0 failed**, final run 13.615 s. Includes bundled actual Store/history/debrief code, cancellation and scripted audio gesture coverage. |
| Backend suite | **238 passed, 0 failed**, final run **140.330 s**; isolated database, scripted inference and blocked external networking. Covers owner isolation, expiry/revocation/logout, recovery, interrupted evaluation, idempotence, audio scope and pilot security. |
| Type-check and production build | **Passed** (`npm run build` includes `tsc -b`); Vite 20.59 s. Existing large-chunk warning remains; emitted JS is approximately 1.57 MB. |
| Repository verification | **All 4 passed**: data integrity, Three scene, rubric citations and clinical cases. |
| Frontend lint | **Passed** for `src` and `scripts`. |
| Focused backend Ruff | **Passed** for `backend/medsim_backend`, `backend/tts/providers.py` and `backend/tests/test_recovery.py`. Ruff is installed on the host PATH, not in the backend virtualenv. |
| Full backend Ruff | **20 inherited findings remain**, matching the prior preparation baseline; full backend lint is not green. |
| Tracked-source safety scan | **Passed**, 334 tracked paths. This tracked-only scan does not independently cover untracked new files. New paths were reviewed and exercised by the other checks. |
| Production clinical leakage scan | **Passed**, 0 of 292 server-only truth strings exposed across 1,572,488 JS bytes. This is a finite sentinel scan, not proof of absence of every possible clinical leak. |
| Production credential-value scan | **Passed** against configured backend shared-secret/OpenRouter key values; values withheld, private environment file unchanged. |
| PowerShell parsing | Both start/stop scripts **passed** parsing; they were not relaunched in this follow-up. Earlier script lifecycle results remain historical. |
| Real socket streaming | Automated loopback Uvicorn test receives the first SSE chunk while the generator is held, then receives completion after release. Real deterministic patient SSE also passes. This is not a public ngrok test. |
| Configured offline Kokoro | **Passed** valid WAV checks: cold **57.483 s**, warm **1.992 s**, cached **0.002 s**. Existing local assets only; no download, local language model or hosted completion. Playback audibility remains untested. |
| Diff integrity | **Passed**, `git diff --check`. |

Final frontend and backend logs are `backend/data/navigation-node-tests.log` and
`backend/data/navigation-backend-tests.log`; build and local speech measurements
are `backend/data/navigation-build.log` and `backend/data/recovery-kokoro-smoke.log`.

Chrome automation was rejected with exactly **“Computer Use was not approved to
use Google Chrome”**; no more specific reason was given. There were no browser
connector tabs. No listener existed on **8788** or **4040** during this run, so
there was no available running pilot/ngrok path to reuse. No public hostname was
guessed or changed. No pilot process was restarted. Automated socket SSE checks
and in-process HTTPS TestClient checks do not prove ngrok/browser/real-device
behavior. Desktop browser, mobile viewport, actual HTTPS cookies/SSE and audible
Android/iOS playback remain **unverified**. This report does **not** declare the
pilot ready.

## Restart commands (operator action)

Schedule the restart after students finish: unsaved active attempts will be lost.
Keep the existing ngrok hostname and configuration. From the repository root:

```powershell
$PilotHost = Read-Host 'Existing ngrok hostname only (no https:// or path)'
powershell -NoProfile -File .\scripts\stop-pilot.ps1
powershell -NoProfile -File .\scripts\start-pilot.ps1 -PilotHost $PilotHost
```

To deliberately run without audio, add `-TextOnly` to the start command; it is
not an automatic provider switch. The script type-checks/builds, scans and makes
an online SQLite backup before launch. The service remains **127.0.0.1:8788**.
The already configured tunnel must forward to that port, preserving Host and
using the same exact HTTPS hostname. No tunnel-start command was executed.

```powershell
.\backend\.venv\Scripts\python.exe .\backend\pilot_smoke.py --pilot-host $PilotHost
powershell -NoProfile -File .\scripts\stop-pilot.ps1
```

The smoke makes no completion/TTS/account requests. Stop the separately managed
ngrok terminal with Ctrl+C when ending exposure; the stop script does not kill it.

## قائمة تحقق يدوية قصيرة

نفّذها على الحاسوب والهاتف عبر **رابط HTTPS الحالي نفسه**، وبحسابين أو ملفّي
متصفح منفصلين. سجّل وقت الخطأ وRequest ID، من دون كلمات مرور أو Cookies.

1. **الصوت:** ابدأ حالة واضغط Enable audio ثم Replay. جرّب الكتم، مستوى الصوت، Skip وإعادة التشغيل. اسأل سؤالاً آخر أثناء تجهيز الصوت؛ يجب أن يبقى النص قابلاً للاستخدام. غادر الغرفة وتأكد من توقف صوت المريض السابق. افتح Audio timing وسجّل الفرق بين التشغيل البارد والدافئ.
2. **التقييم:** أكمل التشخيص ثم Finish consultation. راقب حالة الانتظار ثم النتيجة ومصدرها. عند فشل الاتصال استخدم Retry evaluation؛ يجب ألا تتكرر الوصفات أو النتيجة المحفوظة. إذا فشل الحفظ فقط استخدم Retry saving review.
3. **التحديث:** حدّث الصفحة أثناء اللقاء، وأثناء انتظار التقييم، وبعد اكتماله. يجب استعادة السياق الصحيح أو ظهور سبب واضح لتعذّر الاستعادة، من دون إنشاء مريض جديد.
4. **كل الأسهم:** جرّب Welcome، خطوات التعريف، Back to corridor، سهم المكتبة، سهم السجل، Back to the room، وسهم التقييم الحي والمحفوظ. جرّب الشعار والصورة الشخصية ومسار التنقل، وأزرار Close وEscape والخلفية في Examine. ارفض رسالة مغادرة لقاء غير مكتمل وتأكد من بقائك فيه.
5. **Back/Forward:** تنقّل بين الغرفة والمكتبة والملخص واللقاء؛ افتح Examine ثم جرّب Back وForward. يجب إغلاق النافذة ثم فتحها، من دون حلقات أو إدخال سجل لكل رسالة دردشة. اللقاء المنتهي يشرح الانتقال إلى التقييم بدلاً من إعادة تشغيله.
6. **الجلسة:** أعد فتح الرابط وأنت مسجّل؛ يجوز تجاوز تسجيل الدخول، لكن لا يبدأ لقاء تلقائياً. نفّذ Logout وأعد فتح الرابط ثم Back؛ يجب طلب تسجيل الدخول وألا تظهر بيانات خاصة قابلة للاستخدام. جرّب ضيفين بنفس الرابط وتأكد من العزل.
7. **لقاء غير متاح:** احفظ تقييماً أولاً، ثم أعد تشغيل الخدمة في وقت آمن أو اختبر لقاءً منتهي الصلاحية. افتح مرجع اللقاء القديم؛ يجب ظهور شرح وخيارات Retry recovery وSaved history وChoose a case. يجب بقاء السجل المحفوظ للحساب.

في DevTools على الحاسوب جرّب أيضاً عرضاً ضيقاً مثل 390×844، وافحص Secure و
HttpOnly وSameSite=Lax وغياب Domain في Cookies، وتدفق SSE عبر النفق. عرض ضيق
لا يثبت توافق الصوت مع Android/iOS؛ أكّد ذلك على الهاتف الحقيقي.

## Limits and thesis wording

Describe this as a desktop-first formative prototype with optional local speech,
server-owned deterministic evidence grading and optional provider enrichment.
Observed consultation timing is descriptive, not a score. Recovery is bounded
by owner/session, tab reference, case version and process lifetime; account
authentication, active encounter recovery and saved history are different features.
Do not describe the system as clinically validated, fully mobile-validated,
durable active-session storage, or a guaranteed live-AI evaluator. Pending-stage
animation was not evidence that those clinical analyses had run; it is now removed.
The existing case/governance and physician-validation limitations remain.
