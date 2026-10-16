# Observed Thomas/Sarah dialogue regression fix

This incremental update applies after the original MedSim history-drafts package. It changes retrieval and adds regression tests; it does not change patient facts, generated manifests, clinical review status, UI, audio configuration, or scoring.

## Reproduced failures

The real browser transcripts exposed gaps not covered by the original tests:

- Thomas: `How long have you had these symptoms?` was rejected because `symptoms` added an unrelated associated-symptom domain to the duration request. The existing answer is `Progressive over 3 months.`
- Sarah: travel spelling variants/camping were absent from aliases, and short labels such as `Describe?`, `Joints?`, `Fever?`, and `Tick bite?` did not overlap sufficiently with ordinary questions.
- Sarah's authored negative-symptom panel was available but not matched to facial weakness, palpitations, and fainting.

## Changes

`backend/patient_memory.py` now treats general symptom wording as a qualifier of timeline questions; recognizes camping/travelling/traveling; and matches bounded topic labels against source IDs, question labels, and the actual authored answer. Source anchors distinguish knee pain from skin-patch locations. Timing, joint anatomy, family scope, and compound-topic checks prevent borrowing unsupported details. Multiple incomplete sources remain ambiguous; missing information is never converted into a denial.

The patterns apply across cases and contain no case IDs or new clinical values. Existing protection, candidate bounds, exact authored-question behavior, and clinician review states are preserved.

## Verification

`python -m unittest discover -s backend/tests -v`: **exit 0, 133 tests pass**.

The new `backend/tests/test_observed_dialogue.py` replays all 21 clinical questions from the submitted Thomas/Sarah transcripts through the real ASGI SSE endpoint, in order, and verifies exact source IDs and expected authored details. It also verifies both protected diagnosis requests, without calling the hosted provider. Additional tests check unsupported rash duration, an unsupported ankle site, family versus personal history, and missing fever information.

The following also pass with exit 0:

- `python backend/patient_memory_report.py --output docs/development/patient-memory-coverage.json --check`
- `python backend/history_draft_report.py --check`
- `git diff --check`

The existing 446 draft additions still await clinical review. This is an automated endpoint verification; the user's local browser/audio must be retried after applying the patch and restarting the backend. No commit or push was performed. Frontend/build checks from the initial package were not rerun for this backend-only update.

`observed-dialogue-traces.json` contains before/after retrieval traces for the submitted clinical questions.
