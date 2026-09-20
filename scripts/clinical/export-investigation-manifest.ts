import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLINICAL_CASES } from '../../src/clinical/cases.ts';
import { GENERATED_PATHS, writeGeneratedTextArtifacts } from './generated-artifacts.ts';

export async function exportInvestigationManifest(): Promise<void> {
  await writeGeneratedTextArtifacts(['investigations']);
  console.log(`Wrote ${CLINICAL_CASES.length} cases to ${GENERATED_PATHS.investigations}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await exportInvestigationManifest();
}
