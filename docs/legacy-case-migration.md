# Legacy case migration

The original 240-record catalogue is preserved as source history and is not automatically considered clinically reliable. Exactly 72 IDs are rebuilt and learner-resolvable; the remaining 168 IDs are `retired-from-curated-bank` and cannot be assigned or opened through learner routes.

The curation manifest implements the workbook selection contract: 72 rebuilt cases at `1.1.0`, 168 archived records, and exactly three cases for each of 24 specialties. Source-backed status is separate from human approval. Historical `1.0.0` pilots remain available for audit, not assignment.

`src/clinical/migration.ts` generates the mapping shape:

`legacyCaseId → canonicalCaseId → migratedVersion → migrationStatus → notes`

Do not silently map a historical attempt to a later case version. Duplicate, unsupported, or unsafe content may be retired only after review and while preserving historical resolution.
