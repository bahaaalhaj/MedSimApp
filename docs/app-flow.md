# Application flow

`src/App.tsx` selects one visible screen from the singleton game store and the authenticated session state. The learner journey is:

`splash → onboarding/auth → home or GP room → case library → brief → encounter → end confirmation → debrief → history`

An encounter keeps clinical actions, transcript, and audio lifecycle state separate. Examine contains History, Chat, Order tests, Results, Diagnose, and Rx; the vital signs remain displayed. The Examination tab and its three action buttons have been removed. Tab selection replaces the overlay's browser-history entry: Back closes Examine, Forward restores the selected tab, and refresh restores it with the owner-bound encounter. Removed/unknown tab references open History. On narrow screens, the audio card and overlay share a scrollable layout so audio cannot cover Close or the tabs. The learner’s text is recorded, the attempt-bound patient response is streamed, the response transcript is committed, and only then is optional local TTS requested. Finishing immediately snapshots the encounter and navigates to debrief; pending audio cannot remove transcript evidence.

Debrief requests evaluation from the backend. The backend restores the authoritative case and rubric, while the frontend presents the returned verdict, domains, criteria, actions, and provenance. The browser does not decide scores or critical failures.

New attempts use `examination-excluded-v1`: examination is **Not assessed**, with an 85-point total and 50-point data-gathering maximum. Other weights and critical rules are unchanged. Debriefs distinguish raw points from normalized percentages; bands use the actual maximum. Existing attempts without this policy and saved reviews retain their original rubric and examination evidence. See [scope and verification](examination-tab-removal.md).
