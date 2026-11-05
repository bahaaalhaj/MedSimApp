# Supervised pilot preparation — 5 November 2026

Continues main `eac8cbd`, preserving the prior CI, pooling, TLS startup and waiting-budget work. This report distinguishes verified implementation from public/phone acceptance. Historical reports retain their measurements; their older model/default/readiness statements are not current configuration.

## Confirmed defects and resulting behavior

The actual investigation manifest has 18 `potentially-harmful` records. Two backend consumers instead compared `harmful`, so those orders were omitted from harmful counts. Both now use the canonical spelling through one classification constant. No manifest, clinical fact, rubric, weight or critical-failure rule changed. Previously, ordering and retrieving all essential results alongside a potentially harmful test could incorrectly earn full investigation credit. Fresh evaluation now applies the existing rule: any harmful order withholds investigation credit; consultation-management feedback counts it and reports the existing concern. Essential/useful/non-harmful paths retain their rules. For the manifest fixture `derm-008`, the investigation criterion is 15 points and is not a critical-failure trigger; this fix does not invent a safety penalty. Cached evaluation results are returned unchanged and saved reviews are not regraded. Newly generated evaluations can consequently differ from historical results.

New encounters continue to exclude examination: **Not assessed**, raw maximum **85**, data-gathering maximum **50**; all other weights remain unchanged. Normalized percentage is `raw / actual maximum × 100`, separately labelled. Historical rubrics, denominators and examination evidence remain intact.

Server dialogue evidence is recorded before terminal SSE delivery. A real ASGI interruption after that write demonstrated the delivery gap. New browser attempts now negotiate optional `dialogueDeliveryVersion: 1`; recorded replies remain pending until an owner-authorized, idempotent request-ID receipt. Pending text blocks fresh questions and evaluation (409), while replay of the same request returns the cached answer without inference or duplicate evidence. Reusing an ID for a different question is rejected. Refresh restores correlated text into Chat before acknowledging it and does not automatically play recovered speech. Legacy attempts retain their previous contract; cached/saved results are not invalidated.

The receipt means the client accepted complete text. It does **not** prove DOM paint, reading, understanding or audible playback. A transport acknowledgement cannot establish educational delivery. Students must review recovered text before finishing. The streaming client commits complete text to conversation/transcript before sending its receipt, then starts optional audio after reconciliation. If that receipt is lost, visible text remains and manual replay deduplicates it; the server may already have accepted the receipt, but text was accepted first. This ordering also covers a lost acknowledgement response. Receipts are attempt/owner-bound; cancelled recovery cannot update a subsequent identity/encounter. Stable request-based transcript/audio IDs prevent duplicate commits. During browser acceptance, opening recovered Chat exposed a parent/child effect ordering defect: Chat could subscribe before its conversation existed. Chat now acquires and subscribes to the same encounter-bound conversation before initialization.

## Effective budgets and safeguards

| Launch | Inner patient | Outer semantic | Evaluator |
| --- | ---: | ---: | --- |
| Windows pilot entry/start script | 7.8 s | 8.0 s | Existing 3.5 s outer; general provider timeout 7 s |
| Ordinary non-pilot defaults | 3.0 s | 3.2 s | Unchanged |

The pilot overrides process settings after private environment loading and before runtime/provider imports. The PowerShell preflight checks effective settings before build/backup/launch. No private configuration file was edited. Queue waiting counts toward the semantic budget. Browser transport, preparation/validation and optional audio add overhead; eight seconds is not a whole-flow guarantee.

The pinned model remains `nvidia/nemotron-3.5-super-vl:free`, with zero-price request limits, no paid fallback/model chain, no automatic completion retries and validated case-local fact selection. Provider errors remain errors rather than fabricated speech. Verified TLS startup preparation, lifecycle/event-loop ownership, pooled-client cleanup and cancellation remain in force. Kokoro is optional; deterministic evaluation remains available when enrichment fails. No local language model or new public tunnel was started.

## Actual verification

The clean Linux checkout used Node 22.14.0, Python 3.12.8 and Ruff 0.8.4 (Ubuntu 22.04 locally, versus Ubuntu 24.04 on GitHub). It had no copied private configuration/database/model artifacts. Full checks passed: 146 frontend tests, 292 backend tests, TypeScript, all four repository verifiers, 72-case clinical validation/curation, 422 investigation records, generated-artifact reproducibility, full configured Ruff/ESLint/format checks, security scan, production build and diff integrity. The built frontend exposed 0 of 292 server-only clinical truth strings. Vite retained its existing large-chunk warning. The post-push GitHub Actions result, exact commit and run URL are supplied in the task handoff; local results are not a CI claim.

Focused offline tests use the actual manifest and real owner-bound ASGI route. They cover interruption after recording before terminal send, pending-grading rejection, request-ID replay without inference, idempotent receipts, cross-owner/attempt denial, cached historical evaluation preservation, process-local pilot overrides, cancellation, stale UI callbacks, stable transcript/audio IDs and scripted two-owner gate waiting. Existing pool/TLS/deadline/SSE failure regressions passed in the full suite.

The isolated production-browser suite passed onboarding/Back/Forward; desktop and 390?844 navigation; secure cookies on localhost; overlay/scene interaction; explicit audio enable/mute/volume; text while synthesis is held; generated-WAV WebAudio decode/replay/Skip; no stale audio after departure; refresh without creating another attempt; refresh after server recording before terminal receipt with one recovered turn/no automatic audio; interrupted evaluation/refresh/cached recovery; idempotent saved results; saved-review navigation; identical-peer guest/account isolation; expired-attempt messaging; and logout/Back protection. There were no uncaught page errors. These are scripted local-browser results, not hosted browser or phone acceptance.

Retained preliminary failures: the first backend fixture run used the wrong score-max key and passed an httpx Cookies object incorrectly; those test-harness errors were corrected, then focused tests passed. The first browser run incorrectly matched spaced rather than compact JSON; frame parsing fixed the harness. The next run exposed the real recovered-Chat effect ordering defect described above; the corrected full suite passed. An initial clean-checkout TypeScript invocation was issued before npm ci completed and could not find TypeScript's library; after dependency installation completed, the unchanged check passed. The final receipt-ordering review moved client text acceptance before receipt and kept optional audio after it. Its focused tests passed; the full frontend suite also caught an existing literal-comment assertion after that comment was reworded. The accurate text-before-TTS comment was retained. A separate global source-position assertion then failed because acceptance and speech are now in different methods; its invariant was moved to the real Conversation/SSE/audio-queue fixture, asserting at every synthesis dispatch that its patient text already exists in transcript. This strengthens runtime coverage without disabling a test or relaxing the ordering requirement. Checks were rerun. None of these failed offline checks consumed hosted inference quota.

A local configured Kokoro CPU smoke, with external networking blocked and no audio files saved, loaded in **188.853 s under tracemalloc** and synthesized a 3.125 s WAV in **3.541 s**. Instrumented cold loading is not an uninstrumented pilot latency estimate. PyTorch deprecation/configuration warnings were retained. This does not establish phone audibility or TTS performance for all patients.

### Bounded live owner-route acceptance

Exactly **four** completions were reserved/persisted before dispatch and sent, without retries, enrichment, metadata/quota/warmup calls, model changes or paid fallback. Fresh disposable guest encounters/request IDs used one real application lifecycle/event loop. Two sequential successes permitted two overlapping isolated owners. The shared gate serialized actual inference, and same-IP/UA cross-owner access was denied. No real student database was opened for these tests. The private timing report remains outside Git.

| Request / semantic case | Duration | Gate wait | Upstream header wait | Body receipt | Validation | Grounded + exactly one done | Decoded upstream model confirmed | Actual reuse |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Sequential 1, card-003, breathing when horizontal | 4.009 s | 0.085 ms | 1307.380 ms | 294.108 ms | 2.058 ms | Yes | Yes | No; fresh connection 1 |
| Sequential 2, id-004, marks after outdoor weekend | 1.176 s | 0.065 ms | 523.163 ms | 612.229 ms | 0.426 ms | Yes | Yes | Yes; connection 1 |
| Overlap 3, im-003, pills from home | 0.992 s | 0.030 ms | 610.807 ms | 309.469 ms | 0.355 ms | Yes | Yes | Yes; connection 1 |
| Overlap 4, card-003, breathing when horizontal | 2.079 s | 925.174 ms | 601.286 ms | 488.703 ms | 0.958 ms | Yes | Yes | Yes; connection 1 |

All four required `valid-semantic-answer`, expected authored fact/answer terms, one completion dispatch, one successful terminal, no terminal errors/trailing frames, and a successful receipt. They were neither deterministic shortcuts nor dialogue-cache hits. Every decoded upstream body independently named `nvidia/nemotron-3.5-super-vl:free`; the configured identity and SSE model field were tracked separately. There were **no live failures** in this bounded run. No fifth call was made.

Startup prepared verified TLS in **1046.288 ms**, before the first turn. Cold connection trace measured DNS+TCP together at **574.386 ms**, TLS at **1586.569 ms**, and lazy client construction at **182.521 ms**. DNS cannot be separated from TCP in these HTTPX transport traces. Header wait contains network/provider scheduling/processing and cannot isolate provider queue from inference. Response receipt timings above are transport-body duration, not an inferred token-generation time. Request duration runs from owner-route dispatch through SSE completion and excludes encounter creation/receipt round trip. Subsequent traces have no new TCP/TLS setup and return the same opaque stream identity; reuse is transport-confirmed. The pool closed on lifespan shutdown.

The 7.8/8.0 pilot budget was usable for these four supervised local requests. Keep it for the approved pilot scope and stagger students; two-owner overlap passed but does not establish group load capacity, long-term reliability, a stable p95 or equivalence to historical runs. Public ngrok HTTPS/browser acceptance and a physical-phone check remain pending. Provider connection variability remains a limitation; pooling does not fix provider queue/inference delays.

## Reusable acceptance tools

`backend/pilot_acceptance.py` defaults to an offline scripted transport with external Python networking blocked. It exercises two sequential semantic routes and then two isolated owners concurrently behind one application inference gate, with disposable SQLite and fresh attempts/request IDs. Its live mode allows at most four dispatches, persists the budget before sending, performs no health/metadata/evaluator calls and skips overlap if earlier acceptance fails. Per-task ContextVar timing avoids mixing simultaneous users' traces. It reports decoded upstream model confirmation separately from the configured/SSE model field. An output path is exclusive; do not rerun live without new explicit authorization.

The browser runner's `MEDSIM_BROWSER_OFFLINE=1` mode is exclusively for `pilot_acceptance.py --serve-offline DIST`. It uses real application routes and disposable accounts, deterministic grading without enrichment, scripted dialogue and a generated WAV for real WebAudio decode/replay/cancellation. It establishes neither live provider performance nor physical audibility. Do not point its offline mode at a student service. The historical runner's live mode includes evaluator enrichment and is not authorized for this task.

## Operating and remaining manual acceptance

No pilot or tunnel was running at inspection. Only a disposable loopback acceptance server is used for browser checks, then stopped. No student records are used. Before any real restart, check current students and coordinate: active attempts live in memory for six hours (32 per owner), and restart loses them. Saved account history persists in SQLite; guest history is namespaced browser storage.

Use the exact existing assigned lowercase hostname for both commands below. These commands are instructions, not evidence that public exposure was executed:

```powershell
powershell -NoProfile -File .\scripts\start-pilot.ps1 -PilotHost YOUR-ASSIGNED-HOST.ngrok-free.app -TextOnly
# Omit -TextOnly only when optional Kokoro is desired.
ngrok http http://127.0.0.1:8788 --url https://YOUR-ASSIGNED-HOST.ngrok-free.app --inspect=false
# Stop the separate ngrok terminal with Ctrl+C, then:
powershell -NoProfile -File .\scripts\stop-pilot.ps1
```

The start script builds production assets, scans them and makes an integrity-checked SQLite online backup. Expose **127.0.0.1:8788** only. Preserve Host/Origin; no host-header rewrite or SSE buffering policies. No historical Vercel backend URL is used. HTTPS cookies and actual public SSE still require acceptance through that hostname. A desktop mobile viewport is not a phone test.

### قائمة فحص الهاتف — معلّقة لحين تأكيد المستخدم

1. بعد تشغيل النفق يدوياً، افتح رابط HTTPS الصحيح من الهاتف وسجّل الدخول أو استخدم وضع الضيف. جرّب هاتفاً/ملف متصفح آخر للتأكد من عدم ظهور حالات مستخدم آخر.
2. افتح Examine وجرّب التبويبات الستة والعلامات الحيوية، ثم الرجوع والتقدم وتحديث الصفحة. تأكد أن Examination غير موجود.
3. فعّل الصوت بلمسة، ثم جرّب Replay وSkip وكتم الصوت. أثناء تجهيز الصوت تأكد أن النص ظاهر ويمكن متابعة الأسئلة. عند فشل الصوت يجب أن يبقى النص صالحاً.
4. حدّث الصفحة أثناء انتظار جواب ثم راجع Chat؛ لا ينبغي تكرار النص أو تشغيل صوت قديم تلقائياً. لا تعتبر رسالة HTTP 200 نجاحاً دون جواب مكتمل.
5. أنهِ الحالة بعد التشخيص، وحدّث أثناء التقييم، ثم افتح النتيجة المحفوظة من السجل. تحقق من النقاط الخام من 85 والنسبة المئوية المنفصلة وعبارة Not assessed للفحص.
6. سجّل الخروج ثم اضغط رجوع؛ لا ينبغي استعادة جلسة محمية. أرسل نوع الهاتف/المتصفح والنتيجة وأي خطأ دون بيانات شخصية.

### تعديلات مختصرة للأطروحة

- وصف النظام كنموذج تدريب خارجي للعيادات، مع 72 حالة قابلة للتعيين من بنك اصطناعي، دون ادعاء تحقق سريري أو قبول للهواتف.
- تحديث النموذج المثبّت إلى Nemotron المجاني عبر OpenRouter، والصوت المحلي الاختياري Kokoro؛ لا يوجد تبديل تلقائي أو إثبات جاهزية للنموذج المحلي.
- توثيق مهلة التجربة الطلابية 7.8/8.0 ثانية مقابل الافتراضي 3.0/3.2، وعدم تقديم عينة صغيرة كإثبات اعتمادية أو قدرة تحمّل.
- توضيح حذف تبويب Examination واستبعاده من تقييم الحالات الجديدة: 85 نقطة خام، 50 لجمع البيانات، ونسبة مطبّعة منفصلة؛ السجل التاريخي محفوظ.
- وصف إصلاح تصنيف الفحوص المحتمل ضررها، والتمييز بين قبول النص تقنياً وبين قراءته/سماعه وفهمه.
- توضيح أن استعادة الحالة النشطة محدودة بذاكرة العملية وست ساعات، بينما النتائج المحفوظة للحسابات دائمة في SQLite؛ قبول HTTPS والهاتف والصلاحية التعليمية أعمال منفصلة.

Synthetic content still needs physician review. Small supervised acceptance does not establish production reliability, stable latency percentiles, load capacity, clinical validity or educational efficacy.
