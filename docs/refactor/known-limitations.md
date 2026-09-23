# Known limitations after the refactor

## Acceptance gaps

- No browser surface was available for a manual end-to-end pass. Visual appearance, real keyboard focus, autoplay prompts, and the full learner journey are therefore not manually verified.
- No live OpenRouter request was made. Current provider behavior is supported by mocked failure/success tests, configuration contracts, and historical benchmark evidence only.
- Kokoro assets were not loaded and no waveform was synthesized or heard. Cache, failure, ordering, replay, and cleanup behavior are covered without model inference.
- Phase 0 did not retain reproducible bundle, startup, auth, patient-text, audio, or memory measurements. Current values cannot be presented as before/after performance improvements.
- No browser heap snapshot or long-duration soak was run; cleanup confidence comes from deterministic node/timer/subscriber/abort-controller tests.

## Existing technical risks

- Pediatric visual-parent gender and backend parent-voice gender use different stable hash inputs (`-parent` versus `:parent`). This predates the refactor baseline. Parent/narrator voice selection remains adult and deterministic, but visual/speaking gender alignment is not guaranteed.
- Localhost Origin/Referer authorization bypass remains a deployment hazard; production must not trust those headers as authentication.
- Frontend and backend evaluation schemas are manually duplicated and require contract tests to remain aligned.
- Some legacy clinical truth remains compiled into the SPA for compatibility. Production-bundle scanning currently finds none of the 134 server-only truth strings, but this is not a proof against all inference or reverse engineering.
- Only three cases have authored guideline-cited rubrics; automated source/shape checks are not clinician review.
- Medication details marked `not-finalized` remain unsuitable as authoritative prescribing guidance.
- `getCase()` retains its historical fallback to the first case for an unknown ID; server APIs fail closed, but frontend callers still require care.

## Product and clinical boundary

MedSim is a formative synthetic-case prototype. Passing automated checks does not establish medical correctness, clinical approval, accreditation, clinician agreement, or educational effectiveness. It must not be used for real-patient care.

## Recommended next step

Run a documented target-machine acceptance session for the representative cases in `final-acceptance-report.md`: first with OpenRouter and TTS disabled, then with a configured server key and prepared Kokoro cache. Record screenshots, route/status observations, transcript/version provenance, audible voice-family checks, cached/uncached synthesis timings, and a browser memory snapshot after repeated encounter disposal.
