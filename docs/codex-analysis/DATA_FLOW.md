# Data flow

`learner question → /agent/patient/stream → patient text → encounter transcript/subtitle → /tts/synthesize → Web Audio/lip-sync`

Prepared questions additionally mark their question ID in the clinical action log. Typed and prepared sources are identified separately in transcript entries. Ending an encounter snapshots the complete `ActivePatient`, after which debrief packaging reads the snapshot rather than the disposable audio controller.
