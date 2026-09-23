# Architecture

MedSim has two runtime processes: a React/Vite SPA and a FastAPI service. The SPA owns the 3D outpatient workflow and one external store. FastAPI owns authentication, progress, AI text proxying, and local patient speech.

Patient conversation is text-first. Typed/prepared learner questions stream to the AI patient, durable response text enters `ActivePatient.transcript`, and only then is local speech requested. Web Audio provides playback, gain control, and amplitude lip-sync. See `docs/audio-architecture.md`.

Critical boundaries are the shared clinical types, encounter store, explicit encounter/transcript/navigation/investigation state modules, server-safe case DTOs, transcript-to-debrief mapping, authentication middleware, and TTS provider contract. Conversation request lifecycle, ordered audio, playback, preferences, and lip-sync are separate browser services so disposal cannot erase committed text or reorder accepted audio.

The current screen and route details are documented in `docs/app-flow.md`; HTTP paths and payload ownership are documented in `docs/api-contracts.md`. CI is the reproducible validation boundary and intentionally disables hosted inference and TTS.
