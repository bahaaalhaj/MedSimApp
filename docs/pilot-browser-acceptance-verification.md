# Windows pilot browser follow-up — 28 October 2026

This continues the implementation and historical results in
[pilot navigation/recovery](pilot-navigation-recovery-verification.md) and
[pilot operating instructions](windows-student-pilot.md). Earlier passing tests
are not evidence for this final candidate. Public HTTPS and physical phone
acceptance remain outstanding; this report does not declare the pilot ready.

## Reproduced causes and focused fixes

- The floating music button covered the profile button with longer account
  names. Music now participates in header layout. At 390×844 the old header also
  placed profile/logout outside the viewport; the header now wraps and keeps
  those controls available, with the breadcrumb on a separate row.
- The candidate conversation cleanup depended on an attempt ID that changes
  when the backend binds the attempt. Opening Examine early could therefore
  dispose the same patient's conversation. EncounterScreen now initializes the
  conversation independently of the 3D bubble and uses the stable variant seed
  for its lifetime. Scoped cleanup cannot dispose a replacement conversation.
- Drei's installed PointerLockControls uses a document click listener by
  default. Clicking profile could acquire pointer lock, swallow a subsequent
  click, and reject a lock request against an unmounted canvas. Acquisition is
  now restricted to canvas clicks. No scene geometry/case content was changed.

The preceding work retained in this change provides one production origin,
strict loopback/host/origin checks, signed anonymous ownership cookies, safe
SQLite backups/start-stop scripts, fragment navigation, owner-authorized active
attempt recovery, cancellable client requests, pending/cached evaluation reuse,
idempotent history saving, truthful progress, explicit audio enable/replay and
bounded decoded-audio reuse. Clinical facts, scoring, provider configuration and
deadlines remain unchanged. No local language model was installed or started.

These reproduced defects are not proof of the original phone's exact failure.
The retained older optional-enrichment timeout is also not correlated evidence
for that phone session. Account login, active encounter recovery and saved
history have different lifetimes. Active attempts remain in memory (six hours,
32 per owner), and restart loses them. Saved account history remains in SQLite.

## Computer-use capability and rejection

The previous call was `mcp__cua_repl.js` selecting Chrome with
`cua.getApp({windowId: 67118})`. It returned exactly **“Computer Use was not
approved to use Google Chrome.”** No rejected native-browser call was retried.

Inspection of the installed `@oai/sky` computer-use policy implementation shows
that this message is emitted when the per-app elicitation does not return
`accept`. Its approval metadata identifies connector `computer-use`, approval
kind `mcp_tool_call`, and session/optional persistent scope. Organization policy
denials have different messages. The message alone does not distinguish a user
decline, cancellation or automatic review. Earlier attribution to automatic
review was too specific.

This is the VS Code extension environment. OpenAI's
[IDE browser documentation](https://learn.chatgpt.com/docs/browser?surface=ide)
says the built-in Browser is unavailable in the IDE/CLI. No documented VS Code
Chrome-approval toggle was established, so ChatGPT desktop settings were not
prescribed or changed. No global approval/security configuration was changed.

The explicitly authorized alternative uses isolated Playwright Chromium
156.0.8078.4, with its own context and temporary profile. The already cached
Chromium executable and existing tooling package were used: no browser download,
personal Chrome attachment or new project dependency. The opt-in runner is
`scripts/browser/pilot-acceptance.mjs`; its private credentials, screenshots and
detailed evidence are under ignored `backend/data/browser-acceptance/`.

## Runtime and exposure

The existing hostname was recovered from local history. The existing ngrok
installation/authentication configuration was checked without printing credentials.
No alternative hostname was created. There were no pilot/ngrok listeners or
active students before startup. The existing Windows start script successfully
validated, built, scanned, made an integrity-checked online SQLite backup, and
started the configured optional-Kokoro pilot on **127.0.0.1:8788**.

A subsequent controlled stop/restart also passed, with logs archived privately
and another integrity-checked backup before startup. The final backup is
`backend/data/pilot-backups/medsim-20261028T142654162989Z.db`. The post-restart
production smoke passed. A fresh isolated browser confirmed that the old attempt
returned 404, its page explained unavailability, and **Saved history reopened the
persisted account debrief without inference or synthesis**. The first isolated
Chromium launch for this post-restart check timed out; one later launch completed
the check. This was a browser-process startup timeout, not a provider retry.

One authorized ngrok launch using the existing hostname, loopback target and
`--inspect=false` was **rejected before execution: “blocked by policy.”** The
tool supplied no more specific reason. No alternate invocation was attempted.
There was no resulting tunnel process/listener. A read-only HTTPS health attempt
to the existing hostname failed with `RemoteProtocolError`; this is not an
application HTTP success or an ngrok/browser acceptance result.

## Verification boundaries

| Check | Actual result |
| --- | --- |
| Offline backend suite | **238 passed**, disposable SQLite and blocked external connections; backend code unchanged since that run |
| Final frontend suite | **127 passed** |
| Repository verification | **4/4 passed** |
| TypeScript and production Vite build | **Passed**; existing large-chunk warning retained |
| ESLint | **Passed** |
| Focused Ruff | **Passed** |
| Secret/artifact and configured-secret-value scans | Passed before foundation commit; repeated for final staged candidate |
| Public HTTPS | **Not verified**: ngrok launch blocked; health transport failed |
| Real Android/iOS audibility | **Not verified**; manual acceptance required |

The production Chromium journey passed welcome/onboarding arrows,
library/profile/history arrows, logo and profile, overlay Back/Forward,
Close/Escape/backdrop, cancel/confirm departure, active refresh without creating
another attempt, session reopen, logout/Back protection and explicit unavailable
attempt recovery. Narrow-viewport profile/library and completed/saved-debrief
navigation passed. Two anonymous browsers with identical peer/UA and a second
account could not retrieve each other's attempts; saved-review cross-account
access returned 404 and unauthenticated guest access returned 401. The browser
unavailable-attempt scenario uses a deliberately absent reference; actual TTL
expiration is covered by the backend suite.

The final full loopback browser journey passed after the last audio/header
adjustment with no uncaught page errors. Canvas-only pointer capture and camera
movement were checked, with front/left/right captures inspected. Opening Examine
with E released pointer lock, and overlay Escape closed Examine. Synthetic CDP
Escape did not invoke Chromium's native pointer-release accelerator, so physical
Escape release remains a manual browser check. The main runner and separate
`pilot-restart-check.mjs` use isolated profiles throughout.

The single live semantic turn returned HTTP 200 but **no successful SSE done**:
`response-timeout`, no actual model identity returned. It was not retried. The
single evaluation returned **deterministic-fallback**, category
`evaluation-timeout`, provider `deterministic`. The backend was observed with
`evaluationActive=true` and no cached result before reload; refreshing recovered
the result with **one evaluation POST**. Three save attempts across refreshes
still produced one saved encounter for that attempt. Completed refresh and saved
review did not evaluate again. An additional browser-injected recovery 503
exercised **Retry evaluation** against that cache: **zero evaluation POSTs** and
unchanged saved-record count. No extra hosted request was made for this retry.

The first live runner stopped at a Replay assertion after the failed semantic
turn, whose assistant answer appropriately did not exist. Evaluation continued
from the same server attempt using the remaining one-request budget. The runner
now has explicit resume/cache modes and replays through the labelled audio
control in this state. Detailed private artifacts distinguish these runs.

The hosted semantic timeout and optional enrichment timeout remain external
readiness limitations. Deterministic scripted text, recoverable grading and
audio-control tests do not establish a working live hosted patient model.

Focused Ruff passed. Full-backend Ruff still reports **20 inherited findings**;
the baseline was not cleaned up. Vite retains its existing >500 kB chunk warning.

The loopback production smoke checks private-file denial, exact host/origin
rejection, identical-peer guest isolation and a real completed patient SSE
response without inference or synthesis. Separate backend tests cover account
ownership and saved encounter access, forged cookies, arbitrary forwarded
headers, stream completion/errors and disconnect-safe evaluation caching.

Browser audio uses a generated valid WAV response to exercise real WebAudio
decode, Enable, playback, mute, volume, decoded replay, queue ordering, Skip and
departure cancellation. That is distinct from configured Kokoro synthesis and
physical audibility. The preceding actual local Kokoro smoke measured cold
57.483 s, warm 1.992 s and cached 0.002 s, with valid WAVs. No expensive benchmark
was repeated without a reason; those numbers are historical measurements, not
current phone latency or audible-playback acceptance.

The browser runner defaults to intercepted dialogue/audio and no hosted calls.
Its opt-in live mode has a persistent per-output-directory budget of one typed
dialogue and one evaluation. Synthetic learner choices are not clinical
validation. Test accounts/records are retained separately from existing records;
private credentials, logs, backups, database files and participant data must not
be committed.

## Remaining manual steps — خطوات يدوية

1. شغّل النفق بالاسم الحالي نفسه فقط، ثم افتح رابط HTTPS على الحاسوب والهاتف.
   لا تغيّر Host ولا تفعّل تخزين الطلبات أو سياسات ضغط/تجميع SSE. أوامر التشغيل
   والإيقاف موجودة في [دليل التشغيل](windows-student-pilot.md).
2. جرّب الحسابين والضيفين في ملفات متصفح منفصلة. افحص Secure وHttpOnly
   وSameSite=Lax وغياب Domain، وتأكد من رفض الوصول إلى لقاء مستخدم آخر.
3. على الهاتف الحقيقي اضغط Enable audio ثم Replay، واختبر الكتم ومستوى الصوت
   وSkip وترتيب الردود وتوقف الصوت عند مغادرة اللقاء. اسأل نصياً أثناء تجهيز
   الصوت. سجّل إن كان الصوت مسموعاً فعلاً؛ ملف WAV أو عرض ضيق لا يثبت ذلك.
4. اختبر جميع الأسهم والشعار والملف الشخصي وClose وEscape وخلفية Examine،
   ثم Back/Forward ورفض/قبول مغادرة لقاء غير مكتمل. حدّث أثناء اللقاء وأثناء
   التقييم وبعده، واختبر Retry evaluation دون تكرار النتيجة المحفوظة.
5. أعد فتح الرابط بجلسة صالحة، ثم Logout ثم Back. يجب منع الصفحات الخاصة.
   اختبر اللقاء غير المتاح بعد إعادة تشغيل آمنة؛ يجب بقاء سجل الحساب المحفوظ.
6. أرسل وقت أي فشل وRequest ID ونوع الهاتف/المتصفح، دون كلمات مرور أو Cookies.

Describe the thesis system as a desktop-first formative prototype with optional
local speech, deterministic evidence grading and optional model enrichment.
Do not claim clinical validation, verified real-phone audio, durable active
encounter storage, guaranteed live-model feedback or full public readiness.
