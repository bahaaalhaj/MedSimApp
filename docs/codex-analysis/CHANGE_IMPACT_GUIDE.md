# Change Impact Guide

## Shared types or state

If `src/game/types.ts` changes:

- Inspect `store.ts`, all `src/data` case modules, `debriefRequest.ts`, `evalHistory.ts`, voice persona generation, and every screen reading `ActivePatient`.
- Preserve serialized `localStorage` compatibility or add a migration/validator.
- Run type-check, Node tests, all verification scripts, and a full manual encounter.

If `src/game/store.ts` changes:

- Check screen navigation, current/last encounter snapshot behavior, conversation disposal, next-case selection, and debrief evidence.
- Exercise both direct end-consultation and overlay dispatch paths.

## Clinical data IDs

If case/test/treatment/diagnosis/medication IDs change:

- Search the whole repository for the exact old and new IDs.
- Check case options/results, medication indications/contraindications, panels, imaging maps, rubric evidence, fake EHR, and saved-history compatibility.
- Run `npm run verify`; do not assume passing checks establish medical correctness.

If `polyclinicPatients.ts`, `patients.ts`, `medications.ts`, or `guidelines.ts` changes:

- Run all deterministic verification and inspect the affected case in UI.
- Require clinician review for meaning, dose, indication, contraindication, recommendation text, or validation-state changes.
- Never set `verificationStatus: 'verified'` through an automated code change.

## Grading and AI contracts

If a rubric or `autoRubric.ts` changes:

- Inspect the encounter evidence actually available to each criterion.
- Check `collectRegistrySlice`, agent prompt scoring rules, evaluation UI labels, and historical comparability.
- Add/adjust tests for multiple acceptable actions, partial credit, safety breach, and empty domains.

If `customTools.ts` changes:

- Update `MEDSIM_CUSTOM_TOOLS` in `backend/server.py` in the same change.
- Test valid/invalid frontend payloads, backend registration, permission behavior, and deployed agent refresh/versioning.

If `debriefRequest.ts`, `useAttendingDebrief.ts`, or the agent system prompt changes:

- Trace request creation → session event → SSE event → Zod parse → tool acknowledgement → persistence.
- Confirm score arithmetic and citations independently; do not trust model-provided totals without validation.
- Run a mocked stream test and a sandbox live-agent smoke test.

## Voice

If persona or LiveKit fields change:

- Keep names aligned across `patientPersona.ts`, `conversation.ts`, `VoiceTokenRequest`, room metadata, and `voice_agent.py`.
- Check adult and pediatric/parent cases, gender/voice selection, mic permission failure, text fallback, transcription, reconnect, farewell, and cleanup.
- Ensure no provider secret or system prompt is logged or exposed unnecessarily.

## API/security/configuration

If `backend/server.py`, `middleware.ts`, `vite.config.ts`, or `vercel.json` changes:

- Verify dev and production proxy paths, SSE streaming, CORS preflight, shared-secret enforcement, direct-backend denial, rate-limit identity, and admin-route protection.
- Update `.env.example` and deployment documentation for variable-name changes without adding values.
- Run Python tests plus unauthenticated/authenticated HTTP security cases.

## 3D scene and assets

If `Polyclinic.tsx`, `Player.tsx`, collider constants, avatar models, or radiology assets change:

- Run type-check and scene verifier.
- Build, open the app, rotate/look from multiple angles, test collision/pointer lock, and inspect fallback behavior with remote assets unavailable.
- Profile load/render cost for added meshes or client data.

## Documentation-only changes

Cross-check source before updating claims. Mark behavior as implemented, partial, planned, dormant, or deprecated. Do not use README/spec as sole evidence.
