# MedSim repository inventory

Status: Phase 2 analysis-only inventory. Generated 2026-09-20 from the clean
post-Phase-1 worktree at commit `490262b29ff517300f777bd827958f4a8a86b87d`.
This document does not authorize deletion, movement, renaming, or refactoring.

## Classification rules

| Classification | Meaning |
| --- | --- |
| `active-runtime` | Loaded by the browser, FastAPI process, edge middleware, or a runtime asset path. |
| `build-or-test` | Used by package/build, verification, clinical export/validation, or test commands. |
| `generated` | Produced from source inputs; some generated files are also runtime inputs. |
| `development-only` | Benchmark, setup, preflight, loop, smoke-test, or authoring support. |
| `documentation-current` | Current operational, governance, architecture, or authoring documentation. |
| `documentation-archived` | Historical migration/evolution or legacy reference material. |
| `candidate-dead` | No normal production path was found, but removal requires a separate review. |
| `uncertain` | Evidence is incomplete or the item may be reached by external tooling. |

## Repository-level inventory

| Path | Classification | Evidence and preservation note |
| --- | --- | --- |
| `src/` | `active-runtime` | React/Vite browser application. `src/main.tsx` mounts `App`; `App` selects screen components. |
| `src/game/` | `active-runtime` | Singleton state, screen union, clinic IDs, and domain contracts. |
| `src/components/` | `active-runtime` | Learner screens, clinical actions, audio panels, and shared primitives. |
| `src/components/three/` | `active-runtime` | Three.js/R3F scene, player, interactions, characters, and patient panel. |
| `src/data/` | `active-runtime` plus `build-or-test` | Legacy-compatible catalogue adapters, patient source data, treatments, tests, medications, guidelines, and fallback rubric. |
| `src/clinical/` | `active-runtime` plus `build-or-test` | Canonical case contracts, curation, investigations, variants, references, migration manifest, and prescription validation. |
| `src/auth/` | `active-runtime` | Browser session/guest state and backend API client. |
| `src/voice/` | `active-runtime` | Attempt-bound text dialogue, transcript, Web Audio playback, and TTS request lifecycle. |
| `src/agents/` | `active-runtime` | Debrief request construction, frontend schema, and deterministic score normalization. |
| `src/styles/` | `active-runtime` | Theme/palette and global visual design. Preserve during later cleanup. |
| `backend/server.py` | `active-runtime` | FastAPI process, auth router inclusion, clinical attempts, investigations, SSE patient stream, evaluation, health, and TTS routes. |
| `backend/auth_system.py` | `active-runtime` | SQLite migrations, account/session semantics, progress persistence, and auth routes. |
| `backend/local_ai.py` | `active-runtime` | Server-owned authored patient facts, safe matching, evidence normalization, and deterministic evaluation authority. |
| `backend/local_llm.py` | `active-runtime` | OpenRouter/local provider configuration, model calls, timeouts, and fallback policy. |
| `backend/tts/` | `active-runtime` | Kokoro default, optional Chatterbox, cache, integrity checks, and provider lifecycle. |
| `backend/migrations/` | `active-runtime` | Runtime SQLite schema migration input. Must not be deleted because static Python imports do not reference SQL filenames directly. |
| `backend/tests/` | `build-or-test` | Python authentication, clinical API, investigation, local AI, provider, and TTS regression suites. |
| `backend/.env.example` | `documentation-current` | Environment contract and operational defaults; names are consumed by backend code. |
| `backend/requirements*.txt` | `build-or-test` | Backend and optional TTS dependency installation inputs. |
| `backend/Procfile` | `build-or-test` | Deployment entry point for `uvicorn server:app`. |
| `scripts/test/` | `build-or-test` | Node/TypeScript characterization and security tests. |
| `scripts/verify/` | `build-or-test` | Data-integrity, scene, rubric-citation, and aggregate verification. |
| `scripts/clinical/` | `build-or-test` | Clinical validation, audit, reference, curation, investigation, and review-manifest generators. |
| `scripts/*.ps1` | `development-only` or `build-or-test` | OpenRouter/local-AI checks and safe local process/model setup. String-invoked; do not classify as dead from TypeScript imports. |
| `scripts/loop/` | `development-only` | Verification-loop automation and its command contract. |
| `docs/generated/` | `generated` | Review exports and server-only manifests. Several files are runtime inputs or test fixtures despite being generated. |
| `public/medsim.mp3` | `active-runtime` | Loaded by `BackgroundMusic` through the string URL `/medsim.mp3`. |
| `middleware.ts` | `active-runtime` | Vercel Edge proxy for `/api`, `/agent`, and `/tts`. |
| `vite.config.ts` | `build-or-test` and `active-runtime` | Vite dev/preview proxy and filesystem-deny policy. |
| `vercel.json` | `build-or-test`/deployment | Production rewrites for backend paths and SPA fallback. |
| `package.json`, `package-lock.json`, `tsconfig.json`, `index.html` | `build-or-test`/runtime bootstrap | Package scripts, dependency lock, TypeScript contract, and browser entry HTML. |
| `.claude/`, `loop/` | `development-only` or `documentation-archived` | Agent prompts and loop notes; string/tool consumers may exist outside the application. Preserve pending tooling review. |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `spec.md` | `documentation-current`/`uncertain` | Human/project instructions and specification references; implementation remains authoritative. |
| `docs/codex-analysis/` | `documentation-current` | Repository architecture, data flow, security, testing, and change-impact analysis. |
| `docs/*.md` architecture/governance files | `documentation-current` | Current clinical, audio, case-authoring, versioning, reference, and investigation guidance. |
| `docs/legacy-case-migration.md`, `docs/archive/evolution.md`, `docs/archive/local-ai-migration-report.md` | `documentation-archived` | Historical migration/evolution evidence. They are still referenced by current analysis and must not be removed casually. |

## Application entry points

- Browser: `index.html` -> `src/main.tsx` -> `src/App.tsx`.
- Frontend screen state: `src/game/store.ts` (`useSyncExternalStore`) and the
  `Screen` union; there is no React router.
- Backend: `backend/server.py`, also exposed through `backend/Procfile`.
- Edge: `middleware.ts`, configured by `vercel.json` and `config.matcher`.
- Clinical/export CLIs: every script under `scripts/clinical/` is a direct
  Node entry point through `package.json` scripts.
- Python support CLIs: preflight, benchmark, smoke, setup, and audio-prep files
  use `if __name__ == "__main__"` or are invoked by PowerShell scripts.

## Screen and journey inventory

`App.tsx` imports and conditionally renders Splash, Onboarding, Auth, GP room,
Home, Case Library, Brief, Encounter, End Confirmation, Debrief, History,
Agentic Rounds, and Agent Topology screens. `AuthProvider` gates protected
screens. The tested production journey is welcome/onboarding -> authentication
or guest -> specialty selection -> case brief -> encounter -> completion ->
debrief/history. Agent explainer screens are imported and therefore are not
candidate-dead merely because they are not the primary clinical path.

## Runtime loading and non-static edges

- `BackgroundMusic.tsx` loads `/medsim.mp3` using a string URL.
- `backend/server.py`, `backend/local_ai.py`, and `backend/local_ai_benchmark.py`
  load generated JSON by `Path` strings under `docs/generated/`.
- `AuthRepository` discovers SQL migrations with `migrations_dir.glob("*.sql")`.
- Backend settings are environment-driven, including OpenRouter, local LLM,
  database, cookies, and patient TTS paths.
- `prepare_kokoro.py` uses Hugging Face download APIs and sets cache/offline
  environment variables; it is not part of the normal server startup.
- PowerShell setup/start scripts use string paths, process IDs, and model names;
  their model/runtime targets are intentionally ignored by Git.
- Vite and Vercel proxy paths are configuration edges, not TypeScript imports.
- Browser guest/history/audio state uses `localStorage` keys and must be
  considered serialized runtime data.

## Files that must not be deleted based on static-import absence

`backend/migrations/001_auth.sql`, all generated server manifests, clinical
export inputs, `src/clinical/migration.ts`, `src/data/polyclinicPatients.ts`,
`public/medsim.mp3`, `vercel.json`, `middleware.ts`, deployment/PowerShell
scripts, `.claude` command/skill files, and archived migration documentation
all have non-import or external-tool consumers. The full dependency map and
candidate evidence are in the companion documents in this directory.

## Analysis limits

This is a static repository map. It does not prove browser reachability for
every screen, inspect external CI/deployment configuration, start a model, load
Kokoro, or claim clinical validity. Candidate status is a review signal only.
