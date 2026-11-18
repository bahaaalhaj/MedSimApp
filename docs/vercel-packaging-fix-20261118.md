# Vercel configuration blocker — 18 November 2026

The deployment of `07807c9` was rejected before building:
`functions.api/index.py.excludeFiles should NOT be longer than 256 characters`.
The prior exclusion string was **446 characters**. Existing tests checked selected
file matches but did not validate the configuration against the official schema;
the green GitHub run therefore did not establish that Vercel would accept it.

## Replacement and protections

The replacement is a **237-character default-deny source-layout pattern**, not a
truncated denylist. It permits only the Python entry, four named backend modules,
and Python source under the main backend package/routes/services. It excludes
other root trees; extra API entries; backend accounts, TTS, tests, private records,
models and tools; non-Python files/subdirectories in the package; hidden files;
and ordinary runtime/pilot/diagnostic entry points. Windows files remain on disk
and unchanged. Only the exact three required server manifests are restored by
the existing 104-character `includeFiles` string. No broad include may reintroduce
excluded data. `.vercelignore` remains in place as defense in depth.

The complete unmodified [official schema](https://openapi.vercel.sh/vercel.json)
is pinned for offline validation, with URL/date/SHA-256 in its
[provenance note](../scripts/verify/schemas/README.md). The current official file
declares draft-04 but uses newer `const` and numeric `exclusiveMinimum`. Only its
in-memory dialect declaration is corrected to draft-07; every constraint remains,
and schema meta-validation stays enabled. A regression test checks the newer
exclusive minimum as well as 256/257-character boundaries, unsupported array
globs, unknown root/function settings, invalid duration and invalid route status.

CI explicitly runs `npm run verify:vercel`; `build:demo` runs it before compilation.
The validator is plain JavaScript `.mjs`, so it does not need Node 22.14's optional
TypeScript execution flag. Ajv and Vercel's build utilities are pinned development
dependencies; the Python function dependencies/provider settings are unchanged.

## Actual local verification

- Full frontend suite: **155 tests passed**, with no failures/skips. Four packaging
  tests cover complete schema validation, routing, dependency manifest and required
  source availability, plus Vercel's actual glob and include-override behavior.
- The glob test creates benign synthetic files, including hidden/nested secrets,
  SQLite/WAL/SHM records, local models, Kokoro/Torch/TTS, auth/SQLite entry points,
  logs, caches, frontend/music assets and unexpected manifests. Applying exclusions
  then includes yields exactly the expected source/manifests, with no other files.
- A materialized selection of actual tracked source contained **35 files: 32 Python
  files and three manifests**. It imported and completed application startup using
  the minimal demo virtual environment, with auth/SQLite/TTS/Torch/Kokoro imports
  prohibited and external networking blocked. No credential files, databases or
  learner records were read to produce it. The first probe guard also blocked Windows'
  internal asyncio loopback socket; the corrected guard permits internal loopback
  while still rejecting outbound network access. No live inference was attempted.
- Ordinary and demo production builds/type-checking passed; both frontend scans
  exposed **0 of 292** server-only clinical truth strings. The existing large-chunk
  warning remains. Repository verification, clinical checks, ESLint, formatting,
  tracked-file security scan and diff integrity are checked for this fix.
- `npm audit` still reports **20 findings** (1 low, 9 moderate, 10 high); none names
  Ajv, the Vercel build utility or the two added lexer dependencies. No unrelated
  dependency upgrades or automatic audit fixes were applied.

No application Python/frontend behavior, Windows audio/assets, SQLite records,
clinical content, scoring, provider deadlines/configuration or ignored environment
settings were changed. The full backend suite also remains a required CI step.

## Limits and handoff

The inspected source selection is **not** a generated Vercel function artifact:
the final Python runtime/vendor dependency bundle was not generated or inspected.
No Vercel CLI/link/pull, cloud settings or credentials were accessed. Actual cloud
packaging, plan restrictions, deployed ingress/SSE and public acceptance therefore
remain unverified; do not infer them from the local source probe or GitHub checks.
The next deployment must confirm the configuration is accepted and inspect its
actual function artifact/startup. No pilot restart, tunnel, merge or deployment
command was performed. Commit and actual GitHub Actions results are in the handoff.
