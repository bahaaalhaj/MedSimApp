# Critical files

| Path | Responsibility |
|---|---|
| `src/game/types.ts` | Encounter and transcript contracts |
| `src/game/store.ts` | Singleton state and durable encounter snapshot |
| `src/voice/conversation.ts` | Text turns, local audio playback, cleanup and lip-sync amplitude |
| `src/voice/patientPersona.ts` | Adult and pediatric-parent persona prompts |
| `src/components/ExamineOverlay.tsx` | Typed/prepared question UI |
| `src/agents/debriefRequest.ts` | Transcript/action evidence packaging |
| `backend/server.py` | Protected AI and TTS endpoints |
| `backend/tts/providers.py` | Local provider abstraction and implementations |
