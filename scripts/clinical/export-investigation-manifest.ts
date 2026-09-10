import fs from 'node:fs';
import path from 'node:path';
import { CLINICAL_CASES } from '../../src/clinical/cases.ts';

const outputPath = path.resolve('docs/generated/investigation-manifest.server.json');
const payload = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  intendedUse: 'server-only-answer-key',
  cases: CLINICAL_CASES.map((clinicalCase) => ({
    caseId: clinicalCase.caseId,
    caseVersion: clinicalCase.caseVersion,
    investigations: clinicalCase.investigations,
  })),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Wrote ${CLINICAL_CASES.length} cases to ${outputPath}`);
