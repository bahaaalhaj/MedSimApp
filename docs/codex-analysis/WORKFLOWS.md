# Workflows (current)

During an encounter the learner opens Examine and either chooses a history question or types one in Chat. The UI records the learner text, streams the patient response, records and subtitles it, then requests optional local speech. Patient mute and volume never affect text conversation.

Ending the consultation stops or skips pending audio, snapshots the transcript and clinical actions, gathers the closing checklist, and creates the debrief request. Development needs `npm ci`, the base backend requirements, `npm run dev`, and `backend/.venv/Scripts/python.exe backend/server.py`; local Kokoro preparation is optional. See `docs/app-flow.md` and `docs/deployment-and-local-setup.md`.
