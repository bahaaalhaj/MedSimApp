# Official Vercel configuration schema

`vercel.schema.json` is the complete, unmodified response downloaded from
https://openapi.vercel.sh/vercel.json on 2026-11-18. SHA-256:
`fa5f8005e6aaaece7d66ca5fddfe6ebe64471923cb1597b56886cff48bba1438`.

The official schema declares draft-04 but also uses newer `const` and numeric
`exclusiveMinimum` constraints. The validator corrects **only** the in-memory
`$schema` declaration to draft-07, which accepts the complete schema, and keeps
Ajv's schema meta-validation enabled. No configuration constraints are removed.
Tests include the newer exclusive-minimum constraint as well as the actual
256-character regression. Pinned Ajv 6 validates the entire configuration. CI/tests do
not depend on a network download or merely check selected string lengths.

The validator is plain `.mjs` so the Vercel build does not require Node's optional
TypeScript execution flag (in particular on Node 22.14).

To refresh, download the official URL, review the full diff and new constraints,
update this provenance/hash, and run `npm run verify:vercel` and `npm test`.
Never replace the snapshot with a hand-written subset. Offline validation cannot
establish account/plan limits, cloud package contents or successful deployment.
