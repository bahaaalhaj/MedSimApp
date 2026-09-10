import { mkdir, writeFile } from 'node:fs/promises';
import { CLINICAL_CASES, toSafeCaseSummary } from '../../src/clinical/cases.ts';
import { CURATED_CASE_IDS, CURATED_CASE_IDS_BY_SPECIALTY, EXCLUDED_LEGACY_CASE_IDS } from '../../src/clinical/curation.ts';

const output = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  publicLabel: 'Educational case / Source-backed formative case',
  accreditationClaim: false,
  counts: { curated: CURATED_CASE_IDS.length, archived: EXCLUDED_LEGACY_CASE_IDS.length, specialties: Object.keys(CURATED_CASE_IDS_BY_SPECIALTY).length },
  curatedCaseIdsBySpecialty: CURATED_CASE_IDS_BY_SPECIALTY,
  curatedCaseIds: CURATED_CASE_IDS,
  excludedLegacyCaseIds: EXCLUDED_LEGACY_CASE_IDS,
  safeCases: CLINICAL_CASES.map(toSafeCaseSummary),
};

await mkdir('docs/generated', { recursive: true });
await writeFile('docs/generated/curation-manifest.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote docs/generated/curation-manifest.json (${CURATED_CASE_IDS.length} curated / ${EXCLUDED_LEGACY_CASE_IDS.length} archived)`);
