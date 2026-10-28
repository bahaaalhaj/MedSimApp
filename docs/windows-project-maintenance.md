# Windows project maintenance — 2026-10-28

This audit inspected the actual filesystem, Git index/ignore rules, entry points,
configuration and consumers. Historical trees and reports were reference material,
not evidence of current readiness. The starting working tree was clean on `main`
at `c33dfb5`. No application, clinical, scoring, session, navigation, audio,
provider or deadline behavior was changed. The public environment template's
shared-secret field was cleared; the private configuration was preserved.

## SQLite findings and preservation

| Original file | File bytes | Integrity | Users / sessions / saved encounters | Action |
| --- | ---: | --- | --- | --- |
| `backend/data/medsim.db` | 495,616 | ok | 8 / 70 / 13 | Kept in place |
| `backend/backend/data/medsim.db` | 57,344 | ok | 0 / 0 / 0 | Quarantined |
| `backend/data/pilot-smoke.db` | 57,344 | ok | 0 / 0 / 0 | Quarantined |

All three had the same four-table authentication/history schema and one migration;
the journal mode was `delete`, with no WAL/SHM sidecars present. Only metadata,
schema and aggregate counts were inspected; no account, token or encounter content
was displayed. There were no unique student records in the nested database.
No merge, migration, record deletion or database replacement was performed.

The CWD-dependent path defect was **already fixed** in `654873b`.
`AuthSettings.from_env()` calls `resolve_database_path()` in `backend/auth_system.py`:
the default and all relative configured paths resolve from the repository root;
absolute paths are preserved. Both direct `server.py` startup and ASGI
`server:app` load the same private configuration. `pilot_server.py` imports that
same app. `pilot_backup.py` loads the same configuration/settings, so the pilot
backup and server use the same selected database. The pilot start script first
sets the repository working directory, but database correctness does not depend
on that step. No startup configuration selects either quarantined file.

The configured path was checked from the repository, `backend/`, and Windows TEMP;
all selected `backend/data/medsim.db`. Existing automated tests for root/backend
relative paths, explicit absolute paths and temporary migrations passed again.
The offline test runner overrides the database with a disposable absolute path;
individual auth/pilot tests use their own temporary paths. Direct test discovery
imports the app before some fixtures, so use the isolated runner below to avoid
initializing the real database during tests.

Before cleanup, SQLite's online backup API opened each source read-only and
verified each snapshot with `PRAGMA integrity_check`:

- Current DB: `backend/data/cleanup-audit/sqlite-backups/backend/data/medsim-20261028T191054909309Z.db`
- Nested DB: `backend/data/cleanup-audit/sqlite-backups/backend/backend/data/medsim-20261028T191054948469Z.db`
- Old smoke DB: `backend/data/cleanup-audit/sqlite-backups/backend/data/medsim-20261028T191054976049Z.db`

These three new backups total 610,304 file bytes. All five existing pilot backups
(2,207,744 bytes) were retained. This method also includes committed WAL pages
when WAL is present; no live database was copied with filesystem copy commands.
The real DB still passes integrity with the original counts and modification
time. It and `.env.local` were also hash-checked before/after the isolated smoke.

## Inventory and actions

Bytes below are actual file lengths measured locally, not download estimates.
`tracked` refers to the Git index; generated runtime assets are ignored.
Full per-file sizes, modification times and Git classification are private in
`backend/data/cleanup-audit/inventory-before.json`, with bucket totals alongside.

| Category / path | File bytes before cleanup | Git status | Purpose, regeneration and decision |
| --- | ---: | --- | --- |
| `node_modules/` | 235,111,946 | ignored | Required frontend dependencies; `npm ci` regenerates; kept |
| `backend/.venv/` | 1,132,536,640 | ignored | Required installed Python/audio dependencies; requirements alone do not prove an identical voice environment; kept |
| `dist/` | 5,369,204 | ignored | Pilot serves this production build; rebuilt and kept |
| `backend/data/tts-models/` | 464,059,124 | ignored | Prepared Kokoro models/voices; kept unchanged |
| `backend/data/llm-models/` | 1,835,474,788 | ignored | Complete Qwen plus 1,048,772 bytes of abandoned download remnants; complete model kept, remnants removed by explicit user decision |
| `backend/tools/downloads/` | 218,779,380 | ignored | Valid Vulkan ZIP kept; two incomplete CUDA ZIPs removed by explicit user decision |
| `backend/tools/llama.cpp/` | 89,989,917 | ignored | 52 extracted Vulkan runtime/license files; kept, sizes/CRCs match retained ZIP |
| `backend/data/pilot-backups/` | 2,207,744 | ignored | Five useful historical online backups; kept |
| Current SQLite / empty SQLite copies | 495,616 / 114,688 | ignored | Current records kept; two schema-only copies quarantined after verified backup |
| `backend/data/browser-acceptance/` | 1,684,871 | ignored | Recent private acceptance evidence, screenshots, unresolved hosted-timeout evidence and credential/budget files; kept private |
| `backend/data/examination-browser/` | 927,782 | ignored | Current desktop/mobile acceptance evidence; kept |
| `backend/data/pilot/` | 8,496 | ignored | Recent runtime/timeout diagnostics; kept unchanged, no managed process state present |
| Prior pilot log directories | 44,554 | ignored | `pilot-acceptance-20261028T172611` and `pilot-previous-20261028-161357`; retained for attribution |
| Other `backend/data/` root files | 3,804,687 | ignored | Includes current DB, old test DB, meaningful test/build/timeout logs and early exploration. DB actions above; evidence kept |
| 20 old root backend/frontend/Vite logs | 7,382 | ignored | Inactive September launch logs; no production consumer; quarantined, not truncated |
| Project-owned Python caches (74 files) | 952,630 | ignored | Imported-source bytecode, automatically regenerated; deleted outside dependencies/model/runtime trees |
| `.ruff_cache/` (10 files) | 144,492 | ignored | Ruff recreates it on lint; deleted |
| `tsconfig.tsbuildinfo` | 3,785 | ignored | TypeScript incremental cache; deleted, then regenerated by verification |
| `src/` | 1,719,995 | tracked | Clinical/application source and generated learner contracts; kept |
| `docs/` | 9,775,432 | tracked | Current docs, review exports/manifests and historical evidence; kept, maintenance documentation added |
| `public/medsim.mp3` | 3,778,351 | tracked | Runtime music URL consumer; kept |
| `.git/` | 277,632,212 | Git internal | History/index/object storage; untouched |
| `.env.local` / example | 2,235 / 2,895 | ignored / tracked | Private configured providers/secrets kept; public template retained |

Rows for database/evidence categories overlap the `backend/data/` summary;
do not add the inventory rows as a disk total. No dependencies were uninstalled.
External prepared audio caches and the separate `%LOCALAPPDATA%/MedSim/local-dialogue`
candidate installation were untouched and are outside these project totals.
No recursive cleanup entered dependency, model, audio-cache or active runtime
trees. The approved download remnants were deleted individually from an allowlist.

Some acceptance results are byte-identical, and early failure screenshots and
exploration files remain. Their diagnostic/attribution value is uncertain while
hosted dialogue timeouts are unresolved, so none was discarded. Current reports,
clinical manifests, review spreadsheets/JSON and historical provenance remain.

### Space actually released versus moved

| Action | Files | File bytes | Windows allocated file bytes |
| --- | ---: | ---: | ---: |
| Deleted project caches | 85 | 1,100,907 | 1,271,368 |
| Deleted approved incomplete downloads/remnants | 11 | 188,154,052 | 188,154,064 |
| Total deleted | 96 | 189,254,959 | **189,425,432** (about 180.65 MiB) |
| Quarantined logs and empty DBs | 22 | 122,070 | 137,008 — **no reclaimed space** |

Allocated sizes came from Windows `GetFileInformationByHandleEx(FileStandardInfo)`
before deleting each file, after a regular-file/hash check and exclusive-open
check. This measures removed file allocation, not a whole-volume free-space
delta: directory/OneDrive bookkeeping, new safety backups/logs and unrelated
applications can change that delta. The build recreated the 4,096-byte allocated
TypeScript cache; subtract it from the deletion total for **189,421,336 bytes**
of removal benefit after that regeneration, before new audit/backup files.

## Quarantine and restoration

Quarantine: `.local-quarantine/20261028T221553/`, ignored by Git and outside
`dist/`. `manifest.json` records original paths, SHA-256, file/allocated sizes,
actions, reasons and completion. All 22 moved-file hashes were verified after
cleanup. The manifest also records deleted regenerable caches; it is not a backup
of those deleted files. Deletion evidence for approved downloads is separately
in `backend/data/cleanup-audit/deleted-downloads.json`.

To restore quarantined files, first coordinate stopping any students using MedSim,
then run from the repository root:

```powershell
powershell -NoProfile -File .\.local-quarantine\20261028T221553\restore.ps1 -Repository (Get-Location).Path
```

The local restore script prechecks every source hash, rejects path escapes,
refuses all overwrites and active MedSim listeners/processes, then moves only
the listed files back. It restores the empty historical DBs to their old names;
it does not select them as the application database or replace current records.
Actual restoration was not performed, so the quarantine remains intact.

If the active DB ever needs recovery, coordinate shutdown, take a fresh online
backup of the current DB first, and deliberately select a verified snapshot via
an absolute `MEDSIM_DATABASE_PATH`. Do not blindly overwrite a live DB or its
journals. The existing backup helper supports a consistent snapshot:

```powershell
.\backend\.venv\Scripts\python.exe .\backend\pilot_backup.py
```

## Optional model provenance and recovery

Hosted OpenRouter was selected, local LLM enablement was false, and no llama.cpp
or downloader process was running. An existing port-8080 listener belonged to
`TNSLSNR.EXE`, not MedSim; it was left alone. No model was started or downloaded.

The user explicitly chose deletion of only incomplete CUDA archives and inactive
download remnants. Both deleted ZIPs failed ZIP validation and were smaller than
their publisher's complete artifacts. Zero-byte incomplete/lock files and a
1 MiB range-test fragment were inactive; cache tags were also removed. There was
no complete 4B model here. The verified Qwen model, valid Vulkan ZIP, extracted
runtime, licenses and every Kokoro asset were retained. Retained Qwen/Vulkan
SHA-256 values were rechecked after cleanup.

Recovery references remain in `scripts/setup-local-ai.ps1`; the separate,
unvalidated b6500 CUDA presentation candidate retains its distinct pins in
`scripts/local-dialogue-artifacts.json`. Do not substitute those versions.

| Artifact | Expected complete bytes | SHA-256 | Recovery source |
| --- | ---: | --- | --- |
| Kept Qwen3-1.7B Q8_0 | 1,834,426,016 | `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a` | [Pinned official Qwen revision](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf) |
| Kept b10948 Vulkan ZIP | 31,674,100 | `75c97002b04958a61c45bf1117aa8d88f5466523240e8b04960379122151235b` | [Official release asset](https://github.com/ggml-org/llama.cpp/releases/download/b10948/llama-b10948-bin-win-vulkan-x64.zip) |
| Deleted partial b10948 CUDA ZIP | 254,065,734 | `9839398baa5a74fcf2447168000b2a8c659e6ee0d944f7686bb72168a0bc1e35` | [Official complete asset](https://github.com/ggml-org/llama.cpp/releases/download/b10948/llama-b10948-bin-win-cuda-12.4-x64.zip) |
| Deleted partial CUDA runtime ZIP | 391,443,627 | `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6` | [Official complete asset](https://github.com/ggml-org/llama.cpp/releases/download/b10948/cudart-llama-bin-win-cuda-12.4-x64.zip) |

The b10948 release sizes/digests/URLs above were read from the official
[GitHub release API](https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b10948)
during this audit; no archive body was downloaded. The deleted partial files were
68,300,800 and 118,804,480 bytes. Their partial-file hashes remain in private audit
evidence and must not be used to validate complete downloads. Partial bytes are
not restorable from quarantine; recovering CUDA would require an explicit fresh
download of a complete artifact and verification against the publisher pins.
The kept Vulkan runtime can be reconstructed from the retained verified ZIP.
This audit establishes file integrity, not local inference or audio readiness.

## Legacy and Git hygiene review

- `vercel.json`, `middleware.ts` and `backend/Procfile` are external deployment
  entry points. The pilot imports none of them. They were retained with their
  old Render hostname; deployment docs now distinguish them from the Windows
  pilot. No production routing or hosting configuration changed.
- `.claude/` holds authoring/verification helpers; tests consume its command
  files. `loop/` and `scripts/loop/` have tested development consumers. Retained.
  `agent/skills/` contains only empty scaffold directories, no runtime content;
  there was no disk saving or demonstrated need to remove them.
- Historical refactor and migration reports were retained, with their original
  attribution. Their old deployment/readiness statements are not current proof.
- `.gitignore` now also excludes generic Python/Ruff/pytest/TypeScript caches,
  private environment variants, SQLite variants/sidecars and local quarantine.
  Environment examples remain eligible for tracking. No blanket JSON, CSV,
  XLSX or WAV exclusion was added.
- The safety scan now rejects additional private runtime/dependency/cache paths
  and database journals, and checks ignore probes. No tracked private/runtime
  artifact required index removal. A configured-secret comparison found that
  the private `BACKEND_SHARED_SECRET` equals the public template's existing
  placeholder. The value was not printed. The public template field is now
  empty with an instruction to set a unique random server-side secret. Private
  configuration was not changed. **Replace that configured value before a
  deployment relies on shared-secret authentication**; the old public placeholder
  remains in Git history. The Windows pilot uses its separate host/origin/peer
  boundary. The final tracked scan has no configured-secret matches or
  secret-shaped values. This was not a full historical secret audit; no history
  was rewritten.
- A source-reference test initially scanned the new ignored inventory JSON and
  failed. It now enumerates tracked **and untracked non-ignored** source using
  Git, preserving detection of unstaged changes without reading private runtime
  records, logs or dependencies. The full suite then passed.

### Source tree command

From any working directory, invoke the script by its path:

```powershell
powershell -NoProfile -File .\scripts\source-tree.ps1
# Optional private output, from the repository root:
powershell -NoProfile -File .\scripts\source-tree.ps1 | Set-Content .\backend\data\source-tree.txt
```

The script anchors itself to the repository, lists names only and never reads
file contents. It prunes dependencies, model/private runtime trees, caches,
quarantine and reparse points before descending; it omits environment secrets,
database/sidecar files and runtime binaries/logs. Public source, `.env.example`,
generated clinical contracts, review exports and source audio remain visible.
Output is intentionally a source view, not a complete storage inventory.

## Actual verification and limits

| Check | Current result |
| --- | --- |
| SQLite online backups, integrity/counts/metadata | Three verified snapshots; current DB unchanged; two empty copies safely quarantined |
| Database path resolution | Root, backend and unrelated TEMP resolve identically; existing relative/absolute/migration regression tests pass |
| Backend offline tests | **243 passed**, 106.612 seconds, disposable SQLite, non-loopback Python networking blocked |
| Frontend tests | **132 passed** after source-enumeration fix; initial run was 131 passed / 1 false failure from ignored audit JSON |
| Final focused source/security tests | **13 passed** after clearing the public template placeholder |
| Type-check and production build | Passed via `npm run build`; existing >500 kB chunk warning remains |
| Repository verification | **4 checks passed** |
| Production clinical-truth scan | **0 of 292** server-only strings exposed |
| Changed TypeScript lint, diff whitespace | Passed |
| Tracked secret/runtime scan and ignore probes | Passed; no private artifacts staged |
| Source-tree output | Required source/examples/contracts/music present; private/runtime paths absent; also checked from outside the repository |
| Quarantine and retained optional assets | 22 moved-file SHA checks; retained model/ZIP SHA checks; 52 extracted runtime CRC checks pass |
| Isolated production loopback smoke | Passed production SPA, private-file denial, host/origin rejection, identical-peer guest isolation and real HTTP SSE completion; external networking blocked |

The isolated smoke used its own `backend/data/cleanup-audit/loopback.db`, disabled
TTS and a blocked test provider configuration. It did not contact hosted inference
or consume quota, and was stopped in `finally`. The nested DB was not recreated.
There were no pilot/ngrok listeners before or after this work and no active
student session was restarted. No public tunnel was launched.

No browser HTTPS/mobile or live audio/model acceptance was claimed by this
filesystem-focused audit. The previously unresolved hosted-dialogue/evaluation
timeouts remain open; their logs and acceptance reports were preserved. Consult
the [pilot guide](windows-student-pilot.md) before a coordinated student session.
