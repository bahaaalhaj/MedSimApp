import { POLYCLINIC_CASES } from '../data/polyclinicPatients.ts';
import { CLINICAL_CASE_BY_ID } from './cases.ts';

export interface LegacyCaseMigration {
  legacyCaseId: string;
  canonicalCaseId: string | null;
  migratedVersion: string | null;
  migrationStatus: 'migrated-pending-clinical-review' | 'legacy-unreviewed';
  notes: string;
}

const ids = new Set<string>();
for (const [clinic, cases] of Object.entries(POLYCLINIC_CASES)) {
  if (clinic === 'all-specialties') continue;
  for (const c of cases) ids.add(c.id);
}

export const LEGACY_CASE_MIGRATIONS: LegacyCaseMigration[] = [...ids].map((legacyCaseId) => {
  const canonical = CLINICAL_CASE_BY_ID.get(legacyCaseId);
  return canonical
    ? { legacyCaseId, canonicalCaseId: canonical.caseId, migratedVersion: canonical.caseVersion, migrationStatus: 'migrated-pending-clinical-review', notes: 'Canonical pilot preserves the legacy public ID; not approved for curated assignment.' }
    : { legacyCaseId, canonicalCaseId: null, migratedVersion: null, migrationStatus: 'legacy-unreviewed', notes: 'Preserved for historical compatibility and development inspection only.' };
});
