# Local dialogue presentation candidate (Windows)

## Current verdict: unsuitable in the current measured state

This is prepared infrastructure, **not a validated presentation setup**. On
2026-10-16 this laptop had approximately 0.9–1.54 GB available RAM with the existing
applications running. The existing 2,500,000,000-byte startup floor was retained.
The real local smoke invocation exited **2**, `unsafe-low-memory`, with
1,288,359,936 bytes available. No dialogue probes, model loading, or new TTS
synthesis ran in that invocation. The first startup attempt also refused safely.

The CPU is an i5-13420H; Windows reports 8,106,040 KiB usable physical RAM. NVIDIA
reports RTX 3050 Laptop, 6,144 MiB VRAM and driver 560.94. Dedicated VRAM at the
read-only sample was 0 MiB used; that is **not** an inference/Three.js/TTS peak.
Vite and the previous backend were left running; a rendered browser scene was
not measured. No unrelated applications were stopped and no driver was changed.

| Requested measurement | Actual result |
| --- | --- |
| Model load / CUDA offloaded layers | Not measured: memory guard and incomplete CUDA/model downloads |
| Cold / warm inference, selected IDs, JSON accuracy | Not measured: 0 local-model turns |
| Simultaneous RAM / dedicated VRAM peak | Not measured; only baseline samples above |
| Offline inference plus Kokoro | Not validated; the offline invocation stopped at preflight |
| Browser text/audio playback, replay, 3D | Not performed |

The 4B GGUF download remains incomplete. An 8 MiB CUDA-archive range attempt
received 995,520 bytes in 30.046 seconds and timed out (curl exit 28); stalled
task-owned downloads were stopped, retaining partial files outside Git. Do not
mistake an existing filename for a verified installation. `Status` distinguishes
presence from complete size; startup also requires the exact SHA-256.

The existing smaller official Qwen3-1.7B Q8_0 file was independently hash-verified
and copied outside the repository, preserving its original. It is an explicit
smaller **candidate**, not a performance recommendation. Its startup and actual
smoke run also stop below the same RAM floor (smaller-model smoke: exit 2,
1,506,713,600 bytes available). Free RAM and complete downloads
before comparing it with 4B; there is not enough evidence to recommend purchasing
hardware or to judge the intrinsic suitability of either model.

## Pinned provenance and licensing

All expected byte counts, revisions, aliases and complete SHA-256 values are in
[`scripts/local-dialogue-artifacts.json`](../../scripts/local-dialogue-artifacts.json).
These are expected publisher digests, not a claim that incomplete downloads passed.

- Original: [Qwen/Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507),
  revision `cdbee75f17c01a7cc42f958dc650907174af0554`.
  The official card identifies the non-thinking 4B model; its pinned LICENSE was
  fetched and confirmed as Apache-2.0. Preserve its license and attribution when
  redistributing an installation.
- Quantizer: [bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF),
  revision `ae44f08e1392f39c0e474af10c3ff8355c8b6688`, filename
  `Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, 2,497,280,736 bytes,
  SHA-256 `2fde00ce69dd4899c70d020845e2638353015bba0fdf161b3eb965f2bca4464e`.
  Its metadata links this exact base model. Do not substitute the older Qwen3-4B
  model referenced by the legacy setup scripts.
- Runtime candidate: [llama.cpp b6500](https://github.com/ggml-org/llama.cpp/releases/tag/b6500),
  official Windows CUDA 12.4 server plus matching cudart archive. These are pinned
  artifacts, **not a tested installed runtime**. CUDA 12.4 Update 1 specifies
  Windows driver >=551.78, below installed 560.94; see
  [NVIDIA release notes](https://docs.nvidia.com/cuda/archive/12.4.1/cuda-toolkit-release-notes/index.html).
  No latest-CUDA assumption or driver update is needed for this candidate.
- Smaller comparison: official Qwen/Qwen3-1.7B-GGUF revision
  `90862c4b9d2787eaed51d12237eafdfe7c5f6077`, Q8_0. Its pinned Apache-2.0
  LICENSE was also checked. Verified local SHA-256:
  `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a`.

## Installation and restoration

Run from the repository in PowerShell. Existing legacy scripts are unchanged;
use this dedicated launcher for the exact Instruct-2507 candidate. Everything
downloaded, logged or PID-recorded lives at
`$env:LOCALAPPDATA\MedSim\local-dialogue`, outside both Git and OneDrive source.

```powershell
# Network is needed only for initial pinned downloads; rerun to resume partials.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action Setup
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action Status

# After freeing sufficient RAM and completing Setup:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action StartModel -Offline
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action StartFrontend -Offline

# Real provider, private audit access and real Kokoro synthesis in an ephemeral
# in-process backend. Port 8787 must be free; do not run a second resident Kokoro.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action Validate -Offline

# Then run the normal backend for manual browser testing:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action StartBackend -Offline

# Stop only backend, or all processes owned by THIS launcher:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action StopBackend
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-dialogue.ps1 -Action Stop
```

Occupied ports cause refusal, never adoption or termination of existing servers.
Stop a previous instance through the terminal/launcher that owns it. Stop records
check PID, executable, creation time, repository and command marker to guard PID
reuse. Windows venv children are matched by both ancestry and command marker.
No blanket Python/Node termination is used. Logs and reports may contain
synthetic patient replies and stay outside Git.

The model uses loopback port 8080, one inference slot, 2,048 context, CUDA0,
99 requested GPU layers, batch 128, microbatch 64, four inference threads and
Flash Attention. Positive CUDA and offloaded-layer diagnostics are mandatory;
successful HTTP health alone is insufficient. Start time is saved to
`logs/model-start.json`. Assess 4,096 context only after the 2,048 benchmark and
with resource headroom; the launcher requires 3.2 GB available RAM for 4,096.
Use matching `-Model`, `-ContextSize` and timeout arguments for each action.
There is no automatic model substitution. For the smaller candidate use
`-Model 1.7b` for Setup, StartModel, Validate and StartBackend after stopping the
previous owned model. Qwen3-1.7B is instructed not to think through existing
`chat_template_kwargs.enable_thinking=false`.

Backend child-process overrides select `llama_cpp`, explicitly enable local and
semantic dialogue, use the actual served alias, loopback `/v1`, context 2048 and
one slot. The shell environment is restored after launch; `.env.local` and
OpenRouter credentials are never rewritten or printed. The new backend entry
loads existing configuration **before** importing the singleton provider. All
original TTS voices/device/cache/order settings remain untouched. No audio
disable switch or low-memory override was introduced.

Keep a verified copy of this repository revision, the external runtime/model
directory, existing private configuration, Python environment and the verified
Kokoro cache for restoration. Keep private configuration outside shared archives;
never commit it. Preserve upstream license files. Re-run hash, driver, startup,
offline and browser checks after restoring. Ordinary startup may still select
the previously configured hosted provider; use the local launcher explicitly.

## Deadlines and trust boundaries

Hosted interpretation remains 3.2 seconds total, with its existing <=3-second
OpenRouter request timeout and no fallback chain. Local interpretation uses
`MEDSIM_LOCAL_INTERPRETATION_TIMEOUT_SECONDS`, default **12 seconds**, finite
range 1–30. This is a provisional bounded starting point, **not measurement-tuned**;
select a presentation value only after warm/queue measurements. The outer budget
includes the shared inference gate; the local transport is also bounded.
Cancellation propagates and the service clears active request state.

Only local semantic-selection requests add grammar-constrained JSON. The existing
case-local fact membership/status/size/protected-data validator remains authority.
The model never writes patient replies or scores. Server composition, 446 pending
drafts, 435 predefined questions, scoring fixtures, cases and investigations are
unchanged. Public SSE still uses its legacy `openrouter` provenance enum for
model-assisted turns; reports use the health provider/model identity instead of
claiming that local inference was hosted. No public audit endpoint was added.

## Validation and remaining work

The extended smoke tool retains the original 11 unseen probes and offers
`--suite full`: **41** observed, unseen, compound, partial, follow-up, unknown,
protected and pediatric turns. `--in-process` reads private audit IDs from the
same backend instance; HTTP-only mode explicitly reports that IDs are not exposed.
`--audio` synthesizes after text and checks WAV responses but never claims audible
browser playback. First/warm inference attempts, failures, model identity, JSON
validation and sampled RAM/VRAM are reported. Samples are not resource peaks.
Keyword checks are benchmark heuristics, not medical or comprehensive language
validation. Inspect selected IDs, ambiguity, partial answers and parent wording.

`--offline --in-process --provider llama_cpp` blocks non-loopback Python DNS and
socket connections; local HTTP bypasses proxy environment variables. The launcher
also sets Hugging Face/Transformers offline flags for its backend child. The
verified Kokoro cache and installed English G2P package remain prerequisites.
This guard is not an OS-wide firewall and does not prove the browser or an
unrelated process has no external connections. Repeat with network disconnected
after downloads; **neither offline end-to-end test ran successfully here**.

Automated post-change results: 157 backend tests, 101 Node tests, standalone
TypeScript, repository verification and production build passed (exit 0).
The added nine Python tests use scripted transports, not real model outputs.
They cover provider budgets, finite config, structured local requests, model
identity, queue cancellation/recovery, service cleanup, local/hosted report
identity and the offline network guard. Three Node tests check pinned artifacts
and launcher safety. The existing large production bundle warning remains.

| Verification actually executed | Exit/result |
| --- | --- |
| Backend unittest discovery | 0; 157 passed (final run 22.443 s) |
| `npm test` | 0; 101 passed |
| `node node_modules/typescript/bin/tsc -b` | 0 |
| `npm run build` | 0; 712 modules; existing >500 kB bundle warning |
| `npm run verify` | 0; all four checks |
| `clinical:validate`, `clinical:references`, `clinical:audit` | 0 each; 72 cases, 66 references |
| `clinical:verify-curation`, `clinical:validate-investigations` | 0 each; 72 assignable, 168 archived, 422 investigation records |
| `clinical:verify-generated` | 0; current/reproducible artifacts |
| Patient memory coverage `--check`, history draft report `--check` | 0 each; 881 authored answers |
| Core history validation | Expected 2; zero missing domains, 446 pending clinical reviews |
| Repository and production answer-leakage security checks | 0; 0/292 hidden truth strings in production JavaScript |
| Expanded tracked/untracked safety scan | 0; 311 repository paths, no unexpected secrets/runtime artifacts; unchanged template placeholder and original background music excluded |
| Focused ESLint, Python compilation, PowerShell AST parse | 0 each |
| `git diff --check` | 0; existing LF/CRLF notices |
| Real primary/smaller model startup attempts | 1 each; refused at memory floor |
| Real primary/smaller `--live --in-process --offline --audio` smoke | 2 each; preflight blocked, not failed dialogue probes |

No local-model semantic accuracy, cold/warm latency, GPU offloading, real TTS or
end-to-end offline success is inferred from these automated results.

## Changes in this continuation only

Modified, preserving prior overlapping work:

- `backend/.env.example`: adds only the local interpretation timeout example.
- `backend/local_llm.py`: bounded local timeout, strict model identity readiness,
  proxy-free loopback transport and local semantic JSON grammar; hosted path unchanged.
- `backend/patient_interpretation.py`: schema for the existing selection contract;
  source/status validation and authored composition retained.
- `backend/medsim_backend/services/patient_dialogue_service.py`: chooses the
  provider-specific outer deadline, still including shared queue waiting.
- `backend/semantic_dialogue_smoke.py`: provider-aware real probes, optional private
  audit access/audio/offline guard and honest resource/reporting fields.

Created:

- `backend/local_dialogue_entry.py`: environment-first local compatibility launcher.
- `backend/tests/test_local_dialogue.py`: nine scripted regression tests.
- `scripts/local-dialogue-artifacts.json`: pinned model/runtime provenance and digests.
- `scripts/local-dialogue.ps1`: explicit safe setup/start/validate/stop actions.
- `scripts/test/local-dialogue-setup.test.ts`: three setup safety tests.
- `docs/development/local-dialogue-setup.md`: this record and restoration checklist.

No files were deleted, moved or archived. All 30 nonoverlapping files from the
35-path starting worktree matched their pre-task byte hashes. No clinical source,
generated clinical content, scoring, frontend workflow, voice policy, schema,
public API or SSE contract was intentionally changed. Actual environment files
were left untouched. Nothing was staged, committed or pushed.

After actual local probes pass, manually test fresh Thomas, Sarah and pediatric
encounters with the Three.js scene rendered, Kokoro enabled, text before audio,
replay, transcript preservation, cancellation/navigation, finish and debrief.
Measure process RAM and dedicated VRAM peaks throughout, not just idle health.
Re-run in airplane/offline mode without runtime downloads. Freeze only that
actually measured, reviewed working configuration for the presentation.
