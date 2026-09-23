# Continuous integration and validation

The authoritative CI definition is `.github/workflows/ci.yml`. It runs on Ubuntu with pinned Node.js 22.14.0 and Python 3.12.8, least-privilege repository-read permissions, dependency caching, and cancellation of superseded runs.

CI installs JavaScript packages with `npm ci` from `package-lock.json` and installs only `backend/requirements.txt` plus Ruff. It does not install `requirements-tts.txt`, download a model, call OpenRouter, or run Kokoro inference. Backend tests run with hosted inference and patient TTS disabled through environment variables.

The workflow covers TypeScript, frontend contracts, repository checks, clinical schema validation, curation (72 assignable and 168 archived records), investigation validation, generated-artifact consistency, the explicit secret/runtime-artifact scan, ESLint/Prettier/Ruff, backend unit tests, the production build, and `git diff --check`.

These are technical and reproducibility gates. Passing CI is not clinical approval, accreditation, evidence of educational effectiveness, or a claim of medical accuracy.
