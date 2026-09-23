# Testing status

Automated checks cover clinical invariants, authentication, transcript packaging, typed/prepared routing, absence of learner audio capture, provider defaults and feature gating, CPU fallback, audio-resource strategy, secret-shaped values, tracked runtime artifacts, and the Phase 9 design-token contracts. The CI matrix additionally runs TypeScript, repository verification, all clinical validators, ESLint/Prettier/Ruff, the production build, and backend unit tests with inference/TTS disabled.

Manual browser playback, first model download, measured TTS performance, GPU compatibility, and optional Chatterbox output require the corresponding local runtime and are not claimed from unit tests or CI. Browser visual inspection was not available in the current environment because no browser surface was exposed to the automation layer.
