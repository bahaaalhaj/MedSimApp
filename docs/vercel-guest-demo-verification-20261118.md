# Vercel guest-demo implementation verification — 18 November 2026

Branch: `feat/vercel-guest-demo`. This is implementation/offline verification,
not public acceptance. No live model completions, metadata warmups, deployment,
tunnel, cloud resource creation or Windows pilot restart were performed.

## Implemented scope

The separate `api/index.py` entry runs the existing encounter services with
Redis-backed attempt transactions, fixed six-hour expiry, stable signed guest
ownership, token/revision fencing and bounded shared provider admission. It does
not import SQLite/authentication or TTS. Server-only facts/manifests stay in the
function bundle. The demo build is `dist-demo`; ordinary Windows builds remain
`dist` with accounts, local history and optional audio.

Capabilities disable demo audio before mounting and block synthesis/audio-context
creation as well as controls/music. Ordinary mode retains these paths. No Kokoro
asset, audio component, local environment setting, SQLite record, clinical content,
grading rule or provider credential was removed or changed.

The pinned free model, zero-price caps, absence of completion retries and paid
fallback are preserved. Only this explicit demo factory sets its per-instance
patient budgets to 7.8/8.0 seconds. Ordinary defaults and Windows overrides remain
unchanged. Redis provider admission permits one active completion, 6/minute global,
3/minute per guest and 40/day global, including optional evaluator calls.

## Checks and evidence

- Full backend suite: **304 tests passed** in 219.763 seconds after the offline
  overlap correction below. The subsequent test-only lease timing correction
  passed its complete 12-test demo suite in the minimal environment.
- Frontend: **153 tests passed**, no failures/skips. Tests cover ordinary/demo
  capabilities, music controls, text delivery/ACK/recovery without synthesis,
  existing ordinary audio flows and Vercel routing/package contracts.
- Real disposable Redis 6.0.16 on loopback: **12 dedicated demo tests passed**.
  Two independent application/store instances alternate requests against Redis,
  not a shared Python attempt dictionary. Tests cover signed ownership on all
  encounter operations; replay/ACK and authoritative evidence; scripted semantic
  SSE; concurrent duplicate dispatch; stale token/revision fencing; fixed expiry;
  32-owner limit; interrupted/cancelled evaluation and cached assessment;
  investigations/results/diagnosis/prescriptions across instances; shared provider
  admission and sanitized storage failure. CI uses its own Redis 7.4 service.
- Fresh-process demo startup passed with imports of auth/SQLite/TTS/Torch/Kokoro
  prohibited and outbound startup connections prohibited. It also asserts the
  demo provider budgets. Scripted providers are offline test doubles and are
  **not evidence of live model availability**.
- A clean temporary virtual environment installed only `api/requirements.txt`;
  **all 12 demo tests passed** in 11.687 seconds. This also checks that ordinary
  auth/TTS dependencies are unnecessary.
- TypeScript validation and both production builds passed. Both output scans
  found **0 of 292 server-only clinical truth strings**. The existing Vite warning
  about chunks larger than 500 kB remains.
- Repository verification: all four checks passed. Clinical validation, curation,
  investigation validation (72 cases/422 records), generated-artifact reproducibility,
  ESLint, formatting, staged diff integrity and tracked-file security scan passed.
- Full Ruff passed on a clean export of the staged repository, including `backend`,
  `api` and the existing review-workbook verifier. The working directory contains
  ignored archival Python copies under `backend/data/ci-fix` with 13 pre-existing
  findings; these private archives were neither committed nor rewritten. No blanket
  lint exclusions were added. Actual CI must validate the clean committed tree.

## Retained failures and acceptance limits

The last full backend run initially passed 303/304 tests: the existing scripted
pilot-acceptance overlap assertion measured 2.146 ms of queue wait instead of
more than 20 ms. Its 40 ms fake response could finish before the second encounter
finished preparation. The offline diagnostic now rendezvous both calls before
the real provider gate. The assertion and live behavior are unchanged; this
ensures the scripted test actually creates overlap rather than weakening it.

A first minimal-dependency run passed 11/12 demo tests. The stale-lock test used
an 80 ms lock for its HTTP rejection check, which expired before the busy host
served the request (200 instead of the expected 409). The test now first proves
rejection with the production five-second lease, then shortens only that test
key's TTL to check real expiry. All owner, rejection, fencing and expiry assertions
remain; production timeouts are unchanged.

The configured local Kokoro smoke test found the verified assets/runtime but
**did not return synthesized audio within 90 seconds**. It ended with TimeoutError.
This was one offline local synthesis, with external connections blocked, not an
inference call. No timeout, asset, provider or local configuration was changed to
hide the failure. Ordinary automated audio and text-fallback coverage passes;
real playback acceptance remains open.

Browser automation was unavailable: the browser integration reported no available
browser, and native Chrome attachment failed. The attempted isolated loopback
browser harness was not a public deployment. No desktop/mobile navigation or
actual browser playback inspection is claimed. The manual preview checklist in
[the deployment guide](vercel-guest-demo.md#acceptance-before-sharing-a-link) remains
required, as does real Vercel ingress, package and SSE inspection.

Vercel packaging review found that `includeFiles` can override exclusions, so only
the three required server manifests are explicitly included. The Python dependency
manifest/version are beside the function entry to avoid the root Ruff-only
`pyproject.toml` shadowing dependency discovery. This is source/configuration
verification, not a completed Vercel build. References: [Python runtime](https://vercel.com/docs/functions/runtimes/python),
[official manifest discovery implementation](https://github.com/vercel/vercel/blob/main/packages/python-analysis/src/manifest/package.ts),
[official function packaging implementation](https://github.com/vercel/vercel/blob/main/packages/python/src/index.ts).

No cloud credentials were supplied. Account-owned Upstash Free setup, separate
Vercel project/environment configuration, protected preview and explicit public
acceptance remain external steps. Required variable **names** and exact manual
steps are in [the deployment guide](vercel-guest-demo.md); values must be entered
directly in the dashboards, never in chat or Git.

The full backend result and actual pushed-commit GitHub Actions result are reported
with the handoff. A passing local run alone does not establish hosted acceptance.
