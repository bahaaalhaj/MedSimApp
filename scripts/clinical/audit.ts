import { CLINICAL_CASES } from '../../src/clinical/cases.ts';
import { LEGACY_CASE_MIGRATIONS } from '../../src/clinical/migration.ts';

const counts = new Map<string, number>();
for (const c of CLINICAL_CASES) counts.set(c.reviewStatus, (counts.get(c.reviewStatus) ?? 0) + 1);
console.log('Clinical case-bank audit');
console.log(`Canonical cases: ${CLINICAL_CASES.length}`);
for (const [status, count] of counts) console.log(`${status}: ${count}`);
console.log(`Legacy unresolved: ${LEGACY_CASE_MIGRATIONS.filter((m) => m.migrationStatus === 'legacy-unreviewed').length}`);
console.log(`Approved-formative: ${CLINICAL_CASES.filter((c) => c.reviewStatus === 'approved-formative').length}`);
console.log('Curated mode will remain empty until genuine reviewer evidence is recorded.');
