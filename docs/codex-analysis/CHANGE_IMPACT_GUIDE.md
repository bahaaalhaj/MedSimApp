# Change impact guide

When changing patient conversation, inspect `ExamineOverlay`, `Conversation`, `conversationStore`, `ActivePatient.transcript`, `finishPolyclinicCase`, and `buildDebriefRequest` together. Text must be recorded before optional speech.

When adding a TTS provider, preserve the backend contract, lazy loading, configuration validation, inference locking, non-secret errors, WAV response, deterministic voice policy, licensing documentation, and disabled-provider tests. Never introduce learner audio capture as an incidental audio change.
