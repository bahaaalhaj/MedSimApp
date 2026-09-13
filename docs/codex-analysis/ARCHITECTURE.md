# Architecture

MedSim has two runtime processes: a React/Vite SPA and a FastAPI service. The SPA owns the 3D outpatient workflow and one external store. FastAPI owns authentication, progress, AI text proxying, and local patient speech.

Patient conversation is text-first. Typed/prepared learner questions stream to the AI patient, durable response text enters `ActivePatient.transcript`, and only then is local speech requested. Web Audio provides playback, gain control, and amplitude lip-sync. See `docs/audio-architecture.md`.

Critical boundaries are the shared clinical types, encounter store, server-safe case DTOs, transcript-to-debrief mapping, authentication middleware, and TTS provider contract.
