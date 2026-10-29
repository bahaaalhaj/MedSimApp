# Continuous integration and validation

The authoritative CI definition is `.github/workflows/ci.yml`. It runs on Ubuntu with pinned Node.js 22.14.0 and Python 3.12.8, least-privilege repository-read permissions, dependency caching, and cancellation of superseded runs.

The repository executes its TypeScript test and verification scripts directly with Node. In Node 22.14.0, [native type stripping requires `--experimental-strip-types`](https://nodejs.org/download/release/v22.14.0/docs/api/typescript.html). CI sets this through job-wide `NODE_OPTIONS` so test workers and spawned verification commands inherit it. Type-checking alone does not enable TypeScript execution. Newer Node versions can run these scripts by default, so a successful check on Node 24 does not establish compatibility with the pinned CI runtime.

To reproduce with Node 22.14.0, set `NODE_OPTIONS=--experimental-strip-types` in the check environment (`export NODE_OPTIONS=--experimental-strip-types` in Bash or `$env:NODE_OPTIONS = '--experimental-strip-types'` in PowerShell). Use a clean checkout and `npm ci`; ignored local configuration, databases, model assets, and existing `node_modules` are not CI inputs.

CI installs JavaScript packages with `npm ci` from `package-lock.json` and Python test dependencies with `python -m pip install -r backend/requirements-test.txt`. The test requirements include the unchanged backend requirements, pinned Ruff, and NumPy for fake audio arrays and real WAV/cache serialization in offline tests. CI does not install `requirements-tts.txt`, Torch, or Kokoro, download a model, call OpenRouter, or run Kokoro inference. Backend tests run with hosted inference and patient TTS disabled through environment variables.

Generated-workbook verification uses Python's standard-library ZIP/XML readers. It checks all 32 worksheet names/order, exact headers, populated rows, table headers/ranges, spreadsheet error cells, and the recorded canonical semantic checksum without the optional `@oai/artifact-tool` package. The existing workbook generation command still requires that rendering tool and retains its reopen, preview, and formula-error checks. CI checks the workbook's structure and recorded checksum, not a full comparison of every displayed clinical cell or a visual rendering. Other generated clinical payloads retain their exact content/semantic consistency checks.

A separate export-quality follow-up remains: the existing workbook has a Unicode replacement glyph at `Case_Index!T204` where the canonical source retains punctuation. This fix preserves both the workbook and the clinical source.

The workflow covers TypeScript, frontend contracts, repository checks, clinical schema validation, curation (72 assignable and 168 archived records), investigation validation, generated-artifact consistency, the explicit secret/runtime-artifact scan, ESLint/Prettier/Ruff, backend unit tests, the production build, and `git diff --check`.

These are technical and reproducibility gates. Passing CI is not clinical approval, accreditation, evidence of educational effectiveness, or a claim of medical accuracy.
