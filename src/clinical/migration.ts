import { POLYCLINIC_CASES } from '../data/polyclinicPatients.ts';
import { CLINICAL_CASE_BY_ID } from './cases.ts';
import { isCuratedCaseId } from './curation.ts';

export interface LegacyCaseMigration {
  legacyCaseId: string;
  canonicalCaseId: string | null;
  migratedVersion: string | null;
  migrationStatus: 'curated-source-verified-formative' | 'retired-from-curated-bank';
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
    ? { legacyCaseId, canonicalCaseId: canonical.caseId, migratedVersion: canonical.caseVersion, migrationStatus: 'curated-source-verified-formative', notes: 'Rebuilt at v1.1.0 for source-backed formative assignment; no clinical accreditation is claimed.' }
    : { legacyCaseId, canonicalCaseId: null, migratedVersion: null, migrationStatus: 'retired-from-curated-bank', notes: isCuratedCaseId(legacyCaseId) ? 'Configuration error: selected ID has no canonical case.' : 'Preserved in the legacy archive and forbidden from learner assignment.' };
});
