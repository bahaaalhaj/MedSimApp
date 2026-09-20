import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLINICAL_CASES } from '../../src/clinical/cases.ts';
import { CLINICAL_REFERENCE_BY_ID } from '../../src/clinical/references.ts';
import { writeGeneratedTextArtifacts } from './generated-artifacts.ts';

export async function exportClinicalReferences(): Promise<void> {
  await writeGeneratedTextArtifacts(['referenceCsv', 'referenceMarkdown']);
  const rowCount = CLINICAL_CASES.reduce((count, clinicalCase) => count + clinicalCase.references.length, 0);
  const referenceCount = [...CLINICAL_REFERENCE_BY_ID.values()]
    .filter((reference) => CLINICAL_CASES.some((clinicalCase) => clinicalCase.references.includes(reference.referenceId)))
    .length;
  console.log(`Wrote ${rowCount} case-reference rows and ${referenceCount} references.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await exportClinicalReferences();
}
