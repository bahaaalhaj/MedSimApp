# MedSim

MedSim is a desktop-first outpatient clinical-training simulator. Learners select one of 24 specialties, interview a synthetic patient by typing or choosing prepared questions, order investigations, diagnose, prescribe, and receive an AI-supported debrief.

> Formative training only. Synthetic cases and simplified doses are not authoritative clinical guidance.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Three.js |
| Patient dialogue | Server-side Anthropic text streaming |
| Patient speech | Local Kokoro by default; optional Chatterbox; HTTP WAV delivery |
| Backend | FastAPI on `127.0.0.1:8787` |
| Assessment | Claude Managed Agent with encounter transcript and action evidence |
| State | One `Store` using `useSyncExternalStore` |

The learner never sends audio and MedSim never requests microphone permission. Patient subtitles are authoritative; speech is an optional rendering layer, so a synthesis or playback failure cannot remove dialogue or assessment evidence. See [Audio architecture](docs/audio-architecture.md).

## Prerequisites

- Node.js 22+
- Python 3.11 or 3.12
- Windows: `espeak-ng` installed and available on `PATH` for Kokoro's English fallback
- An Anthropic API key for AI patient text and the attending debrief

## Windows setup

```powershell
npm install
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-tts.txt
Copy-Item backend/.env.example backend/.env.local
```

Configure `ANTHROPIC_API_KEY`, then keep the local defaults:

```env
PATIENT_TTS_PROVIDER=kokoro
PATIENT_TTS_DEVICE=auto
PATIENT_TTS_FALLBACK=disabled
PATIENT_TTS_MODEL_CACHE_DIR=backend/data/tts-models
PATIENT_TTS_ENABLE_CHATTERBOX=false
PATIENT_TTS_SPEED=1.0
PATIENT_TTS_LANGUAGE=en
```

`auto` uses CUDA when the installed PyTorch build reports a compatible GPU, otherwise CPU. Explicit `cuda` also degrades safely to CPU when CUDA is unavailable. Model weights download on first synthesis and are cached outside Git.

## Run

```powershell
# Terminal 1
backend/.venv/Scripts/python.exe backend/server.py

# Terminal 2
npm run dev
```

Open `http://localhost:5173`. Only these two processes are required.

## Optional Chatterbox

Chatterbox is isolated and never imported or loaded unless enabled. Install it in the same backend environment, then select it explicitly:

```powershell
backend/.venv/Scripts/python.exe -m pip install chatterbox-tts==0.1.7
```

```env
PATIENT_TTS_PROVIDER=chatterbox
PATIENT_TTS_ENABLE_CHATTERBOX=true
PATIENT_TTS_DEVICE=auto
PATIENT_TTS_LANGUAGE=en
```

Arabic is available only through the official multilingual model with `PATIENT_TTS_LANGUAGE=ar`. Voice cloning is not exposed. Chatterbox tags supplied through ordinary dialogue are stripped; the provider accepts only the internal allowlisted `cough` expression from trusted server-authored metadata, which the public endpoint cannot set.

## Verification and benchmark

```powershell
npm run verify
npm test
npm run build
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
backend/.venv/Scripts/python.exe backend/tts_benchmark.py
```

The benchmark reports model-load-plus-synthesis time, buffered time to first audio, total time, audio duration, real-time factor, selected provider/device, and peak process-memory measurement where the platform exposes it.

## Clinical governance

The learner-facing bank contains 72 versioned cases, three per specialty. The remaining legacy records are archived. `source-verified-formative` records source provenance, not physician approval. See [clinical case governance](docs/clinical-case-governance.md) and [review checklist](docs/clinical-review-checklist.md).

## Accounts

FastAPI owns authenticated sessions and evaluation history. Guest history remains namespaced to the browser. See [backend documentation](backend/README.md).

## Licensing

- MedSim repository: private; no redistribution license is granted here.
- Kokoro inference code and Kokoro-82M weights: Apache-2.0; confirm the current upstream model card before redistribution.
- Chatterbox code/models: MIT according to the upstream repository; generated audio contains the upstream PerTh watermark.
- No model weights or generated patient audio are committed to this repository.
