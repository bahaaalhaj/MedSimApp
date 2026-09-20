import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CURATED_CASE_IDS, EXCLUDED_LEGACY_CASE_IDS } from '../../src/clinical/curation.ts';
import { writeGeneratedTextArtifacts } from './generated-artifacts.ts';

export async function exportCurationManifest(): Promise<void> {
  await writeGeneratedTextArtifacts(['curation']);
  console.log(`Wrote docs/generated/curation-manifest.json (${CURATED_CASE_IDS.length} curated / ${EXCLUDED_LEGACY_CASE_IDS.length} archived)`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await exportCurationManifest();
}
