---
name: medsim-triage-logic
description: Historical reference for severity-label authoring. MedSim is outpatient-only; urgent escalation is a case-safety concept, not an ER mode or live model workflow.
---

# ESI-style triage â€” what the simulator uses

The Emergency Severity Index (ESI) is a 5-level system (1 = sickest, 5 = least sick). The simulator uses a simplified 3-level mapping tied to bed zones:

| Simulator severity | ESI rough equivalent | Bed zone | Examples |
|---|---|---|---|
| `critical` | ESI 1â€“2 | Red (beds 0, 1) | STEMI, active stroke, septic shock, airway threat, hemodynamic instability |
| `urgent` | ESI 3 | Yellow (bed 2) | Appendicitis, new AFib w/ RVR, moderate asthma exacerbation, uncomplicated MI history |
| `stable` | ESI 4â€“5 | Green (bed 3) | Ankle sprain, viral URI, simple lacerations, chronic stable presentations |

`ZONE_BEDS` in `src/game/store.ts` enforces the zoneâ†’bed mapping.

## Two-question gate for `critical`

1. **Does the patient need life-saving intervention now?** (airway, hemodynamic support, time-critical reperfusion) â†’ critical.
2. **Is there a high-risk condition with potential for rapid deterioration even if vitals are currently compensated?** (STEMI with ST elevation but HR 104 and BP 152/94 like `mi-001`, ischemic stroke with normal vitals like `stroke-005`) â†’ critical.

If BOTH answers are "no" and vitals are also stable, severity is `urgent` or `stable` â€” never `critical`.

## What makes triage verification deliberately loose

`scripts/verify/triage-priority.ts` only flags `severity: 'stable'` with unstable vitals. It does NOT flag `critical` with calm-looking vitals because ESI 1â€“2 often presents that way (compensated shock, silent MI, watershed stroke). A tighter rule would block legitimate cases. See the comment at the top of that script â€” loosen further, never tighter.

## Current use

This material may inform offline case-authoring review. Runtime severity and escalation remain deterministic; the local model does not assign severity or override safety rules.

## Red flags that force a `critical` label even with normal vitals

- ST elevation on ECG, new LBBB, troponin elevation.
- Sudden focal neuro deficit (FAST positive) within the tPA window.
- Torsades / sustained VT / VF.
- Anaphylaxis with airway involvement.
- Ectopic with hemodynamic compromise (even transient).
- Intracranial hemorrhage on imaging.
- Sepsis meeting qSOFA (2 of: RRâ‰¥22, altered mentation, SBPâ‰¤100) even if not in shock yet.

If a case presents any of these, severity is `critical` regardless of the numerical vitals snapshot.

## When to use this skill vs leave it alone

Use it:
- Authoring a new `PatientCase` and unsure about the severity label.
- Reviewing the attending agent's output and something feels off.
- Changing the rules in `scripts/verify/triage-priority.ts`.

Don't use it:
- For one-off ESI questions in a conversation with the user â€” just answer.
- For polyclinic cases â€” they are outpatient and have no ER triage semantics.
