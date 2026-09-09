# MedSim current product specification

MedSim is a voice-enabled outpatient clinical simulation platform. The AI plays
a synthetic patient while the trainee takes a history, orders investigations,
selects one of five diagnoses, prescribes medication, and receives a structured
AI-supported evaluation.

## User journey

```text
Welcome
→ onboarding when required
→ login, create account, or guest
→ medical specialty selection
→ patient card or random outpatient
→ patient brief
→ 3D outpatient consultation
→ diagnosis and prescription
→ evaluation
→ progress history
```

There is no mode-selection step or Emergency Room application mode.

## Implemented scope

- 24 specialties and 240 synthetic outpatient cases.
- Specialty filtering, all-specialties selection, and random patient selection.
- 3D outpatient room, patient animation, text/predefined questions, and voice.
- Laboratory and imaging orders with simulated results.
- Diagnosis selection, prescription, encounter snapshot, debrief, and history.
- Account authentication plus device-local guest mode.
- Managed Agent custom tools for outpatient vitals, timeline, evaluation,
  critical-finding confirmation, and protected EHR-history lookup.

Urgent and critical labels remain valid for outpatient red flags that require
immediate escalation or referral. They do not represent another product mode.

## Safety and quality

Cases and simplified doses are educational synthetic content, not real-patient
medical advice. Guideline records awaiting clinician review must not be promoted
to verified automatically. Run `npm run verify`, `npm test`, `npm run build`,
and the backend unittest suite after relevant changes.
