# Application flow

`src/App.tsx` selects one visible screen from the singleton game store and the authenticated session state. The learner journey is:

`splash → onboarding/auth → home or GP room → case library → brief → encounter → end confirmation → debrief → history`

An encounter keeps clinical actions, transcript, and audio lifecycle state separate. Examine contains the extracted history, chat, examination, investigations, results, diagnosis, and prescription tabs. The learner’s text is recorded, the attempt-bound patient response is streamed, the response transcript is committed, and only then is optional local TTS requested. Finishing immediately snapshots the encounter and navigates to debrief; pending audio cannot remove transcript evidence.

Debrief requests evaluation from the backend. The backend restores the authoritative case and rubric, while the frontend presents the returned verdict, domains, criteria, actions, and provenance. The browser does not decide scores or critical failures.

Development-only `/agentic-rounds` and `/agent-topology` paths expose architecture demonstrations; they are not additional learner-care modes.
