# Examination tab removal and assessment scope

The user approved `examination-excluded-v1` for **new encounters** after the
audit found a 15-point examination criterion in all 72 assignable cases.

## UI and recovery

The Examination tab, component, and General observation / Review vital signs /
Focused examination buttons are removed from the encounter UI. Examine itself,
the displayed vital signs, History, Chat, Order tests, Results, Diagnose and Rx
remain. Rx still requires a submitted diagnosis. No actions are fabricated.

The selected tab is owned by the existing singleton Store and encoded in the
overlay fragment route. Selecting a tab replaces its history entry: Back closes
Examine, Forward restores its selected tab, and refresh recovers that tab and
the same authorized attempt. Removed/unknown tabs normalize to History.
Legacy `tab=examination` and `panel=examination` references retain their matching
private attempt reference while the URL is canonicalized. Resume from a generic
checkpoint still opens the encounter without forcing an overlay to appear.

The six buttons wrap on narrow screens. Audio and Examine use one scrollable
mobile layer so audio cannot cover Close. The scene loading indicator remains
below the modal; audio initialization, dialogue and provider settings are
unchanged. A misleading hard-coded six-criterion loading summary was removed.

## Approved scoring impact

New attempts get a server-owned policy marker. Grading works on a copy of the
authored rubric with examination excluded; the stored authored rubric is never
mutated. Other weights are unchanged: history **20 + 15**, investigations **15**,
diagnosis **15**, patient safety **20**. Clinical management remains **35**;
interpersonal remains unassessed with maximum **0**. Thus data gathering has
maximum **50** and the total maximum is **85**. No 15 points are transferred to
another criterion or automatically awarded.

Examination is shown separately as **Not assessed**, with its original weight
and exclusion reason. It is absent from scored criteria and model-assessment
instructions; optional model feedback is told not to criticize its absence.
The response's optional `assessment_scope` is validated and retained by the
frontend, including when the evaluation is saved or recovered.

Debriefs label **raw points out of 85** separately from **normalized percentage**
(`100 × raw / actual maximum`). Domain rings use their returned denominators.
Existing profile/history statistics already normalize each encounter using its
own maximum; mixed old/new results have regression coverage.

Percentage bands are unchanged and use the actual denominator:

| Band at or above | Normalized percentage | Raw total /85 | Raw data gathering /50 |
| --- | --- | --- | --- |
| Excellent | 85% | 72.25 | 42.5 |
| Good | 70% | 59.5 | 35 |
| Satisfactory | 55% | 46.75 | 27.5 |
| Borderline | 40% | 34 | 20 |

Below 40% remains clear-fail. Existing critical-criterion failure still overrides
the global percentage; the excluded examination criterion was not critical.
Remaining half-credit rules and clinical safety rules are unchanged.

## Historical compatibility

Existing attempts without the policy retain the original 100-point rubric and
65-point data-gathering maximum, including examination credit. Idempotent attempt
creation does not retrofit an old attempt with the new policy. Existing cached
results and saved encounters are returned without regrading.

Examination evidence fields, restoration, debrief synchronization and the backend
examination endpoint remain for compatibility. No SQLite records, saved evidence,
case versions, authored rubrics, clinical facts or provider configuration were
deleted or migrated. Historical reviews still display their original examination
verdict/evidence and denominators, without the new Not assessed label.

## Actual verification

- **243 backend tests passed** offline with disposable SQLite, including all 72
  case weights, /85 and /50 band boundaries, policy ownership, optional model
  scope, legacy attempt replay, historical saved records and evidence recovery.
- **132 frontend tests passed**, including tab fallback, Store Back/Forward and
  refresh, historical evidence, new/old debrief markup and mixed-denominator stats.
- TypeScript / production Vite build, all **four** repository verification
  checks, ESLint and focused Ruff passed. Vite's inherited large-chunk warning
  remains; the task does not clean unrelated Ruff findings.
- Isolated production Chromium at **1440×1000** and **390×844** passed six-tab
  layout, retained vital signs, Rx locking, Back/Forward, refresh without another
  attempt, all three legacy reference forms, finish and cached debrief refresh.
  Each new encounter had zero examination actions and maxima 85 / 50.
- Browser validation used a separate temporary SQLite database with external
  Python networking blocked and TTS disabled. No hosted inference quota, public
  tunnel, personal browser profile or student database was used.
- No pilot/tunnel listeners were present before verification. No active student
  pilot was restarted. The temporary validation process is stopped after checks.

Physical-phone audibility and public ngrok acceptance are outside this UI change;
these results establish a mobile viewport check, not real-device validation.
Private screenshots, logs and test data remain outside Git under ignored
`backend/data/` or the Windows temporary directory.
