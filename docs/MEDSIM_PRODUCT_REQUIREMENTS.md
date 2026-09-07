# MedSim product requirements

**Status:** approved direction, implementation in phases  
**Scope:** outpatient clinical simulation only  
**Audience:** medical students, interns, and recent graduates  
**Safety position:** educational software; not a medical device or clinical decision-support system

## Product objective

MedSim is a desktop-first clinical reasoning simulator. A learner selects a
specialty and a reviewed synthetic patient, interviews the patient using
curated or typed questions, orders investigations, selects one diagnosis from
five plausible options, creates a management plan, and receives reproducible,
evidence-linked formative feedback.

The project optimizes for clinical traceability and educational quality rather
than case count or model novelty. Emergency care, voice input/output, real
patient records, and autonomous clinical advice are explicitly out of scope.

## Required learner journey

1. Welcome screen with optional, user-controlled background music.
2. Sign in or create an account; a clearly labelled local demo profile may be
   used until server authentication is delivered.
3. View progress and resume prior attempts.
4. Select an outpatient specialty.
5. Select an eligible patient card or request a random eligible patient.
6. Read the doorway brief and enter the 3D consultation room.
7. Read the patient's opening statement in a text bubble.
8. Ask a curated question or type a question that maps to reviewed case facts.
9. Order laboratory, bedside, or imaging investigations.
10. Review results and images that were actually ordered.
11. Select exactly one of five diagnoses.
12. Record medication and non-medication management, follow-up, and safety net.
13. Finish the encounter and receive deterministic scoring plus optional
    locally hosted model-generated narrative feedback.
14. Save the versioned attempt to the learner's history.

## Functional requirements

### Identity and progress

- Production accounts use server-managed, expiring sessions in secure,
  HTTP-only cookies. Passwords are never stored in browser storage.
- Every attempt is owned by one learner and records the case, rubric, scoring
  engine, prompt, and model versions used.
- Learners can list, review, export, and delete their records.
- Local storage is a temporary offline cache, not the system of record.

### Case selection

- Only clinically approved cases are eligible outside authoring mode.
- Random selection respects specialty, difficulty, recent attempts, asset
  availability, and approval status.
- The selected case ID, version, and random seed are recorded.
- Exam mode hides condition-revealing tags and post-submission answer leakage.

### Interview

- Curated questions retain stable IDs and reveal canonical reviewed answers.
- Typed questions map to canonical case facts with a confidence score.
- Low-confidence input asks the learner to clarify; it never invents a fact.
- A model may paraphrase a canonical answer, but schema and contradiction checks
  must pass before the paraphrase is displayed.
- Every revealed fact and learner question is appended to an ordered encounter
  event log and made available to grading.

### Investigations and diagnosis

- Tests have rationale, expected context, result, units/reference ranges where
  applicable, and clinical-review metadata.
- Results remain hidden until the corresponding investigation is ordered.
- Every published case contains one best answer and four plausible distractors.
- Each option has evidence for or against it and reviewer-approved feedback.

### Management

- Medication actions record drug, dose, route, frequency, duration, monitoring,
  and relevant contraindication checks.
- Non-medication actions include advice, procedures, referral, follow-up, and
  safety-netting.
- Criteria link to typed evidence rules rather than relying on free-text model
  interpretation of unrelated IDs.

### Assessment

- Deterministic code owns the authoritative score and verdict.
- Every awarded or missed point links to encounter evidence and rubric version.
- A model may explain the result but cannot alter it.
- The system validates score arithmetic, criterion completeness, case identity,
  and citation allowlists before saving an evaluation.
- Missing evidence is reported as unavailable, never inferred as completed.

## Non-functional requirements

- **Accessibility:** keyboard-completable workflow, screen-reader names, reduced
  motion, scalable text, WCAG AA contrast, and a non-3D fallback.
- **Security:** least privilege, per-user ownership checks, CSRF protection,
  request bounds, rate and cost limits, sanitized errors, and audit logs.
- **Privacy:** synthetic cases only; data minimization, retention controls,
  export/deletion, and no secrets or health data in client logs.
- **Reliability:** the core case and deterministic assessment work when the
  optional model is unavailable.
- **Performance:** lazy-load the 3D scene and specialty data; define measured
  budgets for first load, interaction latency, and frame rate.
- **Reproducibility:** persist immutable content and scoring versions with every
  completed attempt.

## Initial academic release

Ship 30 deeply reviewed cases: five cases each in six specialties selected
according to reviewer availability. Do not publish all current cases merely to
claim a larger catalogue. The release gate is two-clinician review, resolved
disagreement, structural verification, learner pilot, and approved sources.

## Acceptance gates

- One browser test completes the full account-to-saved-debrief journey.
- Cross-user access and unauthenticated mutation tests pass.
- Every published case and rubric is approved and versioned.
- Automated scores are compared with two independent clinician ratings.
- The local-model benchmark reports faithfulness, contradiction rate,
  structured-output success, latency, memory, license, and hardware.
- The dissertation distinguishes technical integrity, clinical validity, and
  educational effectiveness.

