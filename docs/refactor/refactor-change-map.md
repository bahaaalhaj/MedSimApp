# Refactor change map

This map describes the current working-tree refactor without asserting that every change is committed. The working tree remains user-owned and intentionally uncommitted.

| Phase | Responsibility isolated or consolidated | Primary paths | Preserved authority |
| --- | --- | --- | --- |
| 7 | Examination tabs and debrief presentation components | `src/components/examine/`, `src/components/debrief/`, `ExamineOverlay.tsx`, `DebriefScreen.tsx` | Encounter state, scoring, rubric resolution, and clinical truth remain outside presentation components |
| 8 | Encounter, transcript, navigation, investigation, request, queue, playback, preferences, and lip-sync state | `src/game/*State.ts`, `src/voice/ConversationState.ts`, `PatientTextRequestLifecycle.ts`, `OrderedAudioQueue.ts`, `WebAudioPlayback.ts`, `ttsSynthesis.ts`, `conversation.ts` | Singleton store remains authoritative; text precedes TTS; attempt/version guards remain enforced |
| 9 | Design tokens, shared debrief frame, conservative lint/format configuration | `src/styles/global.css`, `AttendingCardFrame.tsx`, `.prettierrc.json`, `eslint.config.js`, `pyproject.toml` | Existing literal appearance, layout, labels, and component behavior |
| 10 | Provider-free CI and implementation-aligned documentation | `.github/workflows/ci.yml`, `scripts/verify/ci-safety.ts`, `docs/ci.md`, API/schema/flow/setup docs | Runtime/API/clinical behavior unchanged |
| 11 | Final acceptance evidence and restart-persistence characterization | `backend/tests/test_auth.py`, this report, `known-limitations.md` | No runtime code changed |

## Dependency direction after refactor

```text
React screens and feature components
  -> narrow presentation components
  -> singleton encounter store and feature state modules
  -> typed browser service clients
  -> FastAPI routes/services
  -> server-owned clinical manifests, evaluation authority, auth and persistence

Conversation orchestration
  -> patient-text lifecycle
  -> transcript commit
  -> optional TTS lifecycle
  -> ordered audio queue
  -> Web Audio playback and lip-sync
```

Clinical authoring sources and generated server manifests remain separate from learner-facing presentation components. The browser submits encounter evidence; the backend restores authoritative case, version, rubric, order, diagnosis, and safety data.

## Compatibility surfaces retained

- One `Store` using `useSyncExternalStore`.
- Existing screen names and learner order.
- Existing public routes, declared status codes, Pydantic/TypeScript field names, and SSE frames.
- Existing case IDs, versions, 72/168 curation decision, and generated checksums.
- Existing OpenRouter model policy, timeouts, fallback rules, and server-only credentials.
- Existing Kokoro voice set, cache key inputs, preload/offline rules, queue ordering, and transcript authority.
- Existing evaluation arithmetic, weights, critical-failure rules, references, and provenance.

No files were moved, archived, or deleted during Phase 11.
