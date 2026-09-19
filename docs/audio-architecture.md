# Patient audio architecture

## Decision record

Previously, the browser published a continuously open doctor microphone through LiveKit. A separate worker used Deepgram STT and Silero VAD, generated patient text with Claude, and returned Cartesia audio through LiveKit. LiveKit had no other consumer, so retaining it after removing doctor audio would add infrastructure, credentials, cost, and cleanup risk without providing a required feature. It was removed.

The current flow is:

1. The learner types a question or selects a prepared question in `ExamineOverlay`.
2. `Conversation.sendTextMessage` records the learner text immediately with its source.
3. The existing authenticated `/agent/patient/stream` route returns patient text.
4. Patient text is recorded and shown as a subtitle before speech synthesis begins.
5. `/tts/synthesize` selects a local provider and returns a non-cacheable WAV response.
6. Web Audio decodes the response. A gain node provides mute/volume and an analyser supplies amplitude lip-sync.
7. Every source and node is stopped/disconnected when the encounter ends. No DOM audio elements, rooms, or object URLs are created.

## Transcript ownership

Transcript entries live on `ActivePatient`, not in the disposable audio object. Each entry includes role, text, ISO timestamp, case ID, case version, attempt ID, and question source (`typed`, `predefined`, or null for a patient response). `finishPolyclinicCase` snapshots this array into `lastEncounter`; `buildDebriefRequest` copies it into `encounter_log.transcript`.

## Provider contract

`backend/tts/providers.py` defines `PatientTTSProvider`, `TTSRequest`, and `TTSResult`. Providers are lazy singletons protected by initialization and inference locks:

- `kokoro`: default, four allowlisted adult English voices selected deterministically by case ID and speaker gender. Pediatric encounters use the accompanying parent's adult voice.
- `chatterbox`: optional and feature-gated. The compact Nano English model is used by default; Arabic selects the official multilingual model. It is never imported while disabled.
- `disabled`: controlled text-only behavior for tests and graceful deployments.

Only transcript response text is sent to TTS. Pronunciation normalization operates on a copy and is returned in a response header for local debugging; it never changes the transcript. Current normalization expands a small, conservative allowlist of common units and abbreviations.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PATIENT_TTS_PROVIDER` | `kokoro` | `kokoro`, `chatterbox`, or `disabled` |
| `PATIENT_TTS_DEVICE` | `auto` | `auto`, `cuda`, or `cpu` |
| `PATIENT_TTS_FALLBACK` | `disabled` | Failure fallback; may be `kokoro` for Chatterbox |
| `PATIENT_TTS_MODEL_CACHE_DIR` | `~/.cache/huggingface` | Canonical model cache outside Git |
| `PATIENT_TTS_ENABLE_CHATTERBOX` | `false` | Required before Chatterbox can load |
| `PATIENT_TTS_SPEED` | `1.0` | Kokoro rate, constrained to 0.7–1.3 |
| `PATIENT_TTS_LANGUAGE` | `en` | `en`, or `ar` with Chatterbox |

Prepare the cache explicitly with `backend/.venv/Scripts/python.exe backend/prepare_kokoro.py`. Configuration and all four selected voices are integrity-checked without loading the model. Only after the cache passes does runtime set Hugging Face offline mode and import Kokoro. `/health` never downloads; missing files produce `tts-model-missing` and the setup command.

FastAPI starts one background Kokoro preload and discarded warm-up utterance. Readiness is `loading`, `ready`, or `failed`; patient text never waits for it. Deterministic opening audio is cached in memory by case, case version, voice, speed, and text with a 32-entry LRU bound.

## Hardware and cleanup

Kokoro is the default for the target 8 GB RAM / RTX 3050 laptop and supports CPU mode. Chatterbox and Kokoro are never loaded together in the normal configuration. WAV data exists only in request memory and the browser decode buffer; it is not written to disk. Hugging Face/model cache size is controlled operationally by deleting unused files under the configured cache directory while the backend is stopped.

## Limitations

- The HTTP endpoint currently returns a buffered WAV, so the benchmark's time to first audio equals total synthesis time. Chunked synthesis is a future provider-contract extension.
- Lip-sync is amplitude-based, not phoneme/viseme aligned.
- The optional Chatterbox path has mocked contract/configuration coverage but requires a separately installed large dependency set and was not made the default. Its provider accepts only an internal allowlisted `cough` expression; the public endpoint exposes no expression/tag field.
- Built-in Kokoro voices are synthetic assets; no real-person cloning or user-provided reference recordings are accepted.

## Adding a provider

Implement `PatientTTSProvider.synthesize`, add the provider name to configuration validation and `TTSManager.provider`, keep imports inside the provider's lazy `_load` method, return mono WAV bytes, add configuration/disabled-load tests, and document code/model/voice licensing separately.

## Troubleshooting

- `tts-model-missing`: run `backend/.venv/Scripts/python.exe backend/prepare_kokoro.py`, then restart.
- `Kokoro could not start` with a ready cache: install `backend/requirements-tts.txt`, install `espeak-ng`, and restart.
- Speech text appears but audio does not: interact with the page once to satisfy browser autoplay rules, check `/health`, then use Retry audio.
- CUDA falls back to CPU: install a CUDA-compatible PyTorch build or set `PATIENT_TTS_DEVICE=cpu` explicitly.
- Chatterbox is disabled: install its package and set both the provider and feature flag; it intentionally cannot auto-enable.
