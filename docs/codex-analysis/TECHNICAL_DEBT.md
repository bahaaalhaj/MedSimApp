# Technical Debt and Risks

## Critical

### Debrief evidence is incomplete

**Location:** `src/voice/conversation.ts`, `src/agents/debriefRequest.ts`, `src/components/EndConfirmScreen.tsx`  
**Problem:** Voice/text transcripts and the closing checklist never enter `DebriefRequest`, while the prompt claims transcript/free-text counselling is present and grades interpersonal behavior.  
**Why it matters:** The LLM cannot reliably grade introductions, empathy, ICE, explanations, or safety-netting from the evidence supplied.  
**Direction:** Define a typed encounter transcript/counselling log, snapshot it with the patient, include it explicitly, and test evidence-to-score behavior.

### Polyclinic management actions and fallback rubric do not align

**Location:** `src/game/store.ts`, `src/components/ExamineOverlay.tsx`, `src/data/autoRubric.ts`  
**Problem:** The UI records prescriptions, but has no mutation for `givenTreatmentIds`; every fallback clinical-management criterion is derived from `criticalTreatmentIds` and matches only `treatments_given`. `gradePrescription()` is unused.  
**Why it matters:** 243 auto-rubric cases can systematically miss clinical-management criteria even when an appropriate prescription is entered.  
**Direction:** Establish one coherent outpatient management model and deterministic evidence mapping before using it for learner assessment.

## High priority

### Product scope and documentation have drifted

**Location:** README, `CLAUDE.md`, `spec.md`, comments, explainer screens  
**Problem:** They claim reachable ER workflows and files that do not exist. Spec test counts (30 Node/22 Python) differ from the current 18 Node tests and current Python source.  
**Why it matters:** Contributors will make incorrect assumptions and demos may promise unavailable behavior.  
**Direction:** Mark ER as dormant/planned and remove or update stale references.

### Oversized mixed-responsibility modules

**Location:** `backend/server.py` (~62 KB), `Polyclinic.tsx` (~119 KB), `AgenticRoundsScreen.tsx` (~63 KB), `ExamineOverlay.tsx` (~45 KB), `polyclinicPatients.ts` (~394 KB)  
**Problem:** Unrelated concerns share files and review boundaries.  
**Why it matters:** Higher merge-conflict and regression risk; security and grading changes are difficult to isolate.  
**Direction:** Split only along stable responsibilities with characterization tests first.

### No automated core workflow tests

**Location:** test suite  
**Problem:** No component/E2E tests cover selection → encounter → actions → dispatch → debrief, conversation disposal, local history, or schema integration with a realistic event stream.  
**Why it matters:** Most user-visible regressions can pass current tests.

### Browser-only persistence

**Location:** Store and `evalHistory.ts`  
**Problem:** Encounter state is lost on reload; history is unvalidated JSON in one browser and silently fails on quota/privacy errors.  
**Why it matters:** No cross-device continuity, audit trail, recovery, or migration.

## Medium priority

- `getCase()` silently falls back to the first case on an unknown ID, masking corrupt links.
- Diagnosis options reveal the correct answer immediately after one submission; learning design may be intentional but is not configurable.
- End-check boxes persist across encounters and are self-reported, not evidence-backed.
- Saved history labels an unsubmitted diagnosis as the correct diagnosis.
- `Conversation` retains legacy no-op APIs and comments referencing removed consumers.
- Frontend/backend tool schemas are duplicated manually rather than generated from one contract.
- Remote image/model URLs create availability, CORS, licensing, and content-drift dependencies.
- 3D room and interaction values contain extensive hard-coded geometry with only a minimal constant check.
- `dist` and `node_modules` are shipped in the archive, increasing size and platform coupling.
- The custom-tool system is broader than the implemented host renderer; permission descriptions overstate active behavior.

## Performance/scalability

- The entire 240-case, medication, and radiology datasets are bundled into the client. Code splitting is absent.
- The scene creates many meshes and procedural canvas textures in one component; performance profiling is absent.
- Every debrief creates a new remote agent session; no lifecycle cleanup or quota policy is implemented.
- Rate limiting keys on backend peer IP, which may be the edge proxy for all users.

## Optional cleanup

Remove stale comments, obsolete compatibility methods, unused `httpx` if confirmed, and duplicated architecture-demo data only after behavior is covered. These are lower value than fixing grading evidence and access control.
