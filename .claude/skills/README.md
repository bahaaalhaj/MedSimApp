# MedSim development skills

This directory belongs to the developer workflow, not the shipped application. Runtime local inference does not load these files.

Current authoring helpers cover guideline curation, rubric drafting, patient-case drafting, interview scoping, and verification. They may propose content but must preserve review states and cannot promote medical material to verified automatically. Runtime patient prompts and evaluator truth are generated into the server-only manifest by `npm run clinical:export-local-ai`.

The former cloud-agent setup, cloud debrief, and submission-video helpers were removed during the local-AI migration. The `.claude` directory name remains because it is a development-tool convention; it is not evidence of a product dependency.

After case or rubric changes run:

```text
npm run clinical:export-local-ai
npm run verify
npm test
npm run build
```
