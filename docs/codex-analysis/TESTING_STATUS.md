# Testing status

Automated checks cover clinical invariants, authentication, transcript packaging, typed/prepared routing, absence of learner audio capture, provider defaults and feature gating, CPU fallback, and audio-resource strategy. Production TypeScript build and Python import/tests remain required for every audio change.

Manual browser playback, first model download, measured TTS performance, GPU compatibility, and optional Chatterbox output require the corresponding local runtime and should not be claimed from unit tests.
