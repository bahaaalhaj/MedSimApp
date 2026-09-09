# Project Overview

## Executive summary

MedSim is a desktop-first, browser-based clinical-training prototype built for an Opus 4.7 hackathon. A trainee selects a synthetic outpatient case, speaks with an AI patient in a Three.js consultation room, records structured history questions, orders instant tests, submits a diagnosis, optionally prescribes, and receives an LLM-generated OSCE-style debrief. It is a polished prototype/MVP, not a production medical system.

The implemented, reachable product is **polyclinic only**. The mode screen marks Emergency and Services as “Coming soon”; there is no ER state slice, bed manager, ER screen, or frontend caller for the triage API. Six ER cases and ER-oriented backend/tooling remain as dormant data/scaffolding. README, `CLAUDE.md`, `spec.md`, comments, and architecture-demo screens still describe an ER + polyclinic product and reference files that are absent.

The code is a client-heavy modular monolith with three runtime processes: a React/Vite SPA, a FastAPI proxy/token/authentication service, and a LiveKit voice worker. SQLite stores accounts, hashed sessions, and authenticated encounter summaries. Session progress remains in memory; onboarding, chat fragments, and isolated guest debrief records use browser `localStorage`.

## Implemented product surface

- Splash/onboarding and mode selection.
- 24 outpatient specialties, 10 cases each (240 cases total).
- Case library and doorway brief.
- First-person Three.js consultation room with pointer-lock controls.
- Continuous voice interaction over LiveKit: Deepgram STT → Claude Haiku 4.5 → Cartesia TTS.
- Typed-chat fallback through FastAPI and Anthropic streaming.
- Structured history, 80 tests, 49 test panels, instant results, diagnosis selection, and a 107-item prescription catalogue.
- Managed-Agent debrief with Zod-validated structured output and three scoring domains.
- Local evaluation history and aggregate training statistics.
- Static architecture/hackathon-explainer screens.

## Dormant or partial surface

- Six ER cases, 19 ER-style treatments, ER-only test panels, triage prompt/API, and ER-oriented custom-tool definitions exist, but no reachable ER gameplay exists.
- `render_vitals_chart`, `render_bed_map`, `render_triage_badge`, `render_patient_timeline`, `flag_critical_finding`, and `lookup_ehr_history` are registered, but the active debrief hook only meaningfully surfaces `render_case_evaluation`; non-evaluation auto tools are acknowledged without rendering, and confirm-gated tools are ignored there.
- The fake EHR vault is a backend demonstration, not connected to a visible active encounter UI.
- Only three of 246 total cases have authored, guideline-cited rubrics; the other 243 use a generic auto-rubric.

## Users and purpose

The intended users are medical students and newly graduated doctors practicing outpatient interviews and decision-making. The repository explicitly states that cases are synthetic, doses are simplified, and the system makes no claim of clinical accuracy. Clinical content must remain marked as needing physician validation unless a human validation state says otherwise.

## Maturity assessment

Strong hackathon prototype: coherent visual identity, extensive static case content, working voice architecture, deterministic data checks, and a structured debrief contract. It is not production-ready because access control is coarse, the implemented scope differs from documentation, clinical validation is very limited, critical grading inputs are missing, server persistence is absent, and test coverage is concentrated on tooling rather than core user workflows.

## Concrete strengths

- `src/game/types.ts` centralizes load-bearing domain contracts.
- `src/game/store.ts` keeps UI mutations explicit and avoids a second state framework.
- `src/agents/debriefRequest.ts` sends only the guideline recommendations cited by the rubric, reducing citation fabrication.
- `src/agents/customTools.ts` validates agent tool payloads with Zod.
- `src/data/guidelines.ts` preserves human verification state and warns agents not to promote it programmatically.
- `scripts/verify/` catches dangling IDs, duplicate cases, invalid severity invariants, 3D constants, and broken rubric citations.
- The browser never receives Anthropic, LiveKit API-secret, Deepgram, Cartesia, or EHR token values.

## Repository readiness

Safe to extend only with targeted changes and regression checks. UI-only changes outside the central scene/data/grading paths are moderate risk. Changes to case IDs, shared types, the store, medication mappings, guideline references, debrief schemas, agent prompts, LiveKit metadata, or proxy security are high risk and require cross-layer validation.

## Confidence and unknowns

The source paths described in this directory were inspected and the frontend verification/test/type-check commands were executed. Live external services were not called. Python tests could not execute because the supplied archive does not include a backend virtual environment and the runtime lacked FastAPI. The production deployment, deployed Managed Agent version, secret configuration, external asset availability, and medical correctness could not be confirmed from the current repository.
