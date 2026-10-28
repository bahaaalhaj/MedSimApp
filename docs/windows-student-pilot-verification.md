# Windows pilot preparation verification — 2026-10-28

Initial repository state: clean working tree at `d7113df`. Read `AGENTS.md`,
the current modular backend and its consumers/tests, the security/testing
onboarding notes, and the historical final acceptance report. No previous pilot
entry point or ngrok scripts existed. Historical results were not treated as
current evidence.

## Changes

- Added `backend/pilot_server.py`: one production SPA/API process, loopback
  port 8788, proxy-header trust disabled, no Vite or historical Vercel backend.
- Added the exact host/origin/loopback boundary, restricted build file serving,
  minimal health response, security headers and no-store/no-transform responses.
- Restricted development header-based access to development mode plus an actual
  loopback peer. Production shared-secret access still works; spoofed localhost
  Origin/Referer from a non-loopback peer fails.
- Added signed random anonymous browser cookies and replaced IP/User-Agent guest
  attempt ownership. Account IDs still own authenticated attempts and SQLite
  encounters. Pilot session/CSRF/guest cookies force Secure, SameSite=Lax and
  host-only scope, overriding insecure development cookie settings in memory.
- Added PowerShell start/stop, online SQLite backup and local HTTP smoke tools.
  Stop validates the Windows venv launcher and real interpreter child, handles
  the hidden console host, and refuses unrelated/reused process identities.
- Updated HTTP test peers and ownership fixtures to use loopback and separate
  cookie jars. The all-case audit now declares a real loopback test peer.
- Added a disposable-database offline backend test runner and ten pilot tests.
  No provider config, clinical content, scoring, review states, SQLite records,
  environment files or history formats were edited. No commit/push/tunnel.

## Actual checks

| Check | Current result |
| --- | --- |
| Backend suite via `backend/run_pilot_tests.py` | **230 passed**, 115.309 seconds; temporary SQLite, speech/local inference disabled, external Python networking blocked |
| Focused pilot cases (included above) | **10 passed**: exact/forged hosts/origins/forwarded headers, private-file/traversal denial, guest/account ownership, cookies/CSRF, SSE, text-only TTS failure, WAL-safe backup |
| Socket streaming test | First chunk received while generator was blocked waiting for the test client; final chunk received after release; no inference |
| Frontend `npm.cmd test` | **116 passed**, zero failed |
| `npm.cmd run verify` | **4 checks passed** |
| TypeScript and production build | Passed via `npm.cmd run build`; 715 modules, build also rerun successfully by start script |
| Production answer leakage | Zero of **292** checked server-only truth strings in compiled JavaScript |
| Actual private configuration scan | Both configured secret/key values checked were absent from production JavaScript; values were not printed |
| Repository security scan | Passed; 334 tracked paths at time of scan, no secret-shaped values/runtime artifacts |
| Frontend ESLint | Passed |
| Pilot/module Ruff | Passed for `backend/medsim_backend`, new pilot tools, test runner and pilot/support tests |
| Full backend Ruff | **20 existing findings remain**; compared each affected lint file against Git HEAD and found identical per-file rule counts (20 at baseline too). Unrelated code was preserved |
| PowerShell parsing | Both scripts parse without errors |
| Start script | Passed with disposable `backend/data/pilot-smoke.db`, production build, text-only process and no tunnel |
| Live local production HTTP smoke | Passed production index/no Vite client, protected paths, Host/Origin rejection, same-peer guest isolation and real patient SSE; no accounts/inference/audio created by this smoke |
| Listener inspection | Actual server listened only on **127.0.0.1:8788** |
| Stop script | Passed with Windows Python launcher + child; listener gone afterward; repeated stop safely reported no managed process |
| Actual existing database backup | Verified `backend/data/pilot-backups/medsim-20261028T112218076434Z.db` using SQLite online backup/integrity check |
| Configured model catalogue | Outside-sandbox read-only preflight: OpenRouter `nvidia/nemotron-3.5-super-vl:free`, **ready**, structured outputs reported, local model disabled; **no hosted completion requests** |
| Configured Kokoro smoke | **Passed**, 1.750-second valid WAV, 119.410-second cold total; existing verified cache, external networking blocked, no audio saved |
| Diff integrity | `git diff --check` passed |

The initial Node tests/build/security scan could not spawn workers/esbuild/Git
inside the execution sandbox (`EPERM`). They were rerun successfully with the
required execution approval. The initial sandboxed provider preflight reported
unavailable; the approved outside-sandbox catalogue check passed. Neither first
attempt was reported as evidence of application readiness.

Initial backend failures identified test-only SQLite connection cleanup on
Windows and old access/guest-identity assumptions. Those were corrected before
the final passing run. The process-tree stop check initially refused the hidden
Windows console host; the corrected script was exercised successfully afterward.

## Remaining acceptance work

- **Browser workflow unverified:** automatic approval review rejected Google
  Chrome access. No production-browser click-through, visible layout, browser
  Secure-cookie behavior, audible playback or complete learner journey is claimed.
- **Public HTTPS/ngrok path unverified:** no tunnel was launched. Supply your
  actual assigned hostname, install/configure ngrok if needed (`ngrok` was not
  on PATH here), preserve Host, then test HTTPS sessions/SSE when exposure is
  explicitly authorized. No domain was guessed or reserved.
- **Live completion unverified:** catalogue readiness does not establish API-key
  inference authorization, provider capacity or success within the existing
  patient deadline. No hosted inference quota was used for this preparation.
- Kokoro's observed cold start was slow. `-TextOnly` is the documented initial
  option; configured optional audio remains available without changing config.
- Full backend lint is not green because of the 20 baseline findings above.
  The production build still emits its existing large-chunk warning.

All pilot/test HTTP servers and the Kokoro smoke interpreter were stopped or
exited. Backups, ignored logs and the disposable smoke database were retained.
See [the pilot commands and hostname setup](windows-student-pilot.md).
