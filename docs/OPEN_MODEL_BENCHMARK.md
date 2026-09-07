# Open-model adoption gate

No model is selected by reputation alone. Candidate versions and licenses change,
so each exact model artifact and inference runtime must be reviewed and recorded.

## Tasks

1. Map typed learner questions to reviewed question IDs.
2. Paraphrase canonical patient answers without changing facts.
3. Explain deterministic assessment evidence in supportive language.
4. Produce the required JSON schema under malformed and adversarial inputs.

## Dataset

Create a clinician-reviewed, versioned benchmark that is excluded from prompt
examples. Include adult and pediatric cases, paraphrases, misspellings,
ambiguity, irrelevant questions, prompt injection, conflicting premises, and
questions whose answers are absent from the case.

## Metrics

- Intent top-1 accuracy and calibrated abstention.
- Unsupported-fact and contradiction rates (primary safety metrics).
- Structured-output validity before and after one repair attempt.
- Clinician-rated faithfulness and usefulness.
- Latency percentiles, throughput, memory, and cold-start time.
- License, redistribution constraints, model provenance, and supported hardware.
- Performance with the model unavailable or timing out.

## Release rule

A model can be enabled only if it improves the templated baseline, meets the
pre-registered contradiction/faithfulness thresholds, fits deployment hardware,
and passes license review. Model output remains optional narrative; deterministic
code owns scores and canonical patient facts.

