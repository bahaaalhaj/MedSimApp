# Legacy case migration

The original catalogue is preserved for compatibility and is not automatically considered clinically reliable. Existing IDs remain resolvable for stored history. All non-pilot entries are `legacy-unreviewed` and appear only in explicitly labeled development mode.

Phase 1 is implemented through lifecycle metadata, curated filtering, honest UI labels, and generated compatibility records. Phase 2 migrated `im-003` (raised blood pressure), `im-004` (new diabetes presentation), and `im-005` (community-acquired pneumonia) to version `1.0.0`; all remain `clinical-review`. No case is approved. Phase 3 requires real reviewer records and completed checklists. Phase 4 retirement decisions are intentionally deferred to qualified review.

`src/clinical/migration.ts` generates the mapping shape:

`legacyCaseId → canonicalCaseId → migratedVersion → migrationStatus → notes`

Do not silently map a historical attempt to a later case version. Duplicate, unsupported, or unsafe content may be retired only after review and while preserving historical resolution.
