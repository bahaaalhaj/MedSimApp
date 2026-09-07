# MedSim

MedSim (Medical Simulation) is a desktop-first outpatient clinical-reasoning
prototype for medical students, interns, and recent graduates. Learners choose a
synthetic patient, work through a 3D consultation, ask structured questions,
order investigations, select a diagnosis, prescribe, and review a formative
debrief.

> **Educational prototype:** MedSim is not a medical device or a source of
> patient-care advice. The current case catalogue and simplified medication
> content require formal clinician review before academic deployment.

## Current implementation

- React 18, TypeScript, Vite, and React Three Fiber frontend.
- One singleton external store using `useSyncExternalStore`.
- 24 outpatient specialties and 240 synthetic case drafts.
- Patient selection plus specialty-filtered random selection.
- Structured history, tests, results, five-choice diagnosis data, and
  prescriptions in a Three.js consultation room.
- Browser-local debrief history.
- Legacy cloud debrief and voice services remain during migration and are not
  part of the approved MedSim target architecture.

Emergency gameplay is not part of MedSim. The previous locked mode-selection
screen has been removed from the learner journey. Remaining ER data and backend
triage scaffolding are migration debt, not implemented functionality.

## Approved direction

The target product is text-first and outpatient-only. It will replace voice and
paid cloud dependencies with canonical case-backed text interaction,
deterministic scoring, optional self-hosted model feedback, secure accounts, and
versioned server persistence.

- [Product requirements](docs/MEDSIM_PRODUCT_REQUIREMENTS.md)
- [Target architecture](docs/MEDSIM_ARCHITECTURE.md)
- [Clinical governance](docs/CLINICAL_GOVERNANCE.md)
- [Open-model benchmark](docs/OPEN_MODEL_BENCHMARK.md)
- [Academic evaluation plan](docs/ACADEMIC_EVALUATION_PLAN.md)
- [Current-code analysis](docs/codex-analysis/PROJECT_OVERVIEW.md)

## Run locally

```bash
npm install
npm run dev
```

The Vite application is available at `http://localhost:5173` by default.

## Quality checks

```bash
npm run verify
npm test
npm run build
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

Use the repository's direct `node node_modules/<package>/...` script convention
where executable shims are blocked. Backend and legacy voice setup instructions
remain in `backend/README.md` until those services are removed in their own
characterized migration.

## Clinical publication rule

Only explicitly approved, versioned content may enter an academic learner-facing
release. Automated agents and scripts may produce drafts or verify structure;
they may never mark clinical content as reviewed or verified.

## Contribution priorities

1. Characterize the existing outpatient workflow with browser tests.
2. Replace voice with canonical text interviewing and a unified event log.
3. Make deterministic code authoritative for grading.
4. Add secure user authentication, ownership checks, PostgreSQL persistence,
   and migrations.
5. Validate a small initial case set with two qualified clinicians.
6. Benchmark self-hosted models only as optional narrative helpers.
