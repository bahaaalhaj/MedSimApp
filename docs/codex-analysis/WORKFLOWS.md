# Workflows

## User workflows

### Start and select a case

`main.tsx` clears old conversation storage → `App` shows Splash → `beginFromSplash()` chooses Onboarding or Authentication from `medsim:onboarded` → authenticated/guest entry → specialty selection → next patient or case library → brief → encounter.

There is no mode-selection screen. Returning authenticated users and guests proceed directly to specialty selection.

### Conduct a consultation

- Voice connects automatically when the encounter mounts and asks for microphone access.
- The `E` key or Examine button opens the structured overlay; `T` toggles voice.
- History buttons add question IDs; answers are revealed from the static case.
- Test ordering adds IDs and timestamps and immediately marks results complete.
- Diagnosis selection is one-shot and immediately reveals the correct diagnosis.
- Prescription becomes available after any diagnosis is submitted. It records medication ID, free-form dose, and free-form duration.
- End consultation asks the voice worker to say farewell, snapshots activity, and opens a self-reported closing checklist.

### Grade and review

The user can enter debrief even without a submitted diagnosis. This conflicts with the agent’s hard rule not to evaluate before diagnosis and may end with “stream closed without emitting a case evaluation.” Successful evaluations are stored locally and drive Home statistics and review mode.

## API workflows

| Method/path | Validation and work | Downstream |
| --- | --- | --- |
| `GET /health` | None; returns configuration flags and agent/environment IDs | Local process state |
| `POST /agent/bootstrap` | Pydantic response only; lock protects duplicate creation | Anthropic environment + agent create |
| `POST /agent/refresh` | Requires configured agent ID | Retrieve/update Anthropic agent |
| `POST /agent/sessions` | Optional title | Anthropic session create |
| `GET /agent/sessions/{id}` | Path string | Anthropic session retrieve |
| `POST /agent/sessions/{id}/events` | JSON with non-empty `events` list | Anthropic event send |
| `GET /agent/sessions/{id}/events` | Integer limit, no explicit bounds | Anthropic event list |
| `GET /agent/sessions/{id}/stream` | Path string | Async Anthropic SSE proxy |
| `POST /agent/vault/ehr/lookup` | Pydantic string + nonblank check | In-memory fake EHR dict |
| `POST /agent/patient/stream` | Roles/content typed as unrestricted strings | Async Haiku SSE stream |
| `POST /voice/token` | Strings and optional identity/voice ID | LiveKit room create + JWT mint |

All endpoints except `/health` pass through the same middleware. There is no controller/service/repository separation.

## Developer workflow

```text
npm install
npm run dev
npm run verify
npm test
npm run build
python -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python backend/server.py
backend/.venv/bin/python -m unittest discover -s backend/tests -v
python -m venv backend/.venv-voice
backend/.venv-voice/bin/python -m pip install -r backend/voice_agent_requirements.txt
backend/.venv-voice/bin/python backend/voice_agent.py dev
```

Windows uses `Scripts/python.exe`. Node 22+ is required by the repository’s native TypeScript test scripts. There are no migration, seed, lint, dedicated formatting, container, or Docker commands.
