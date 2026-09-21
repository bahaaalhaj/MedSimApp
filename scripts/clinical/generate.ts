import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GENERATED_PATHS,
  buildArtifactManifest,
  buildGeneratedTextArtifacts,
  findStaleTextArtifacts,
  writeGeneratedTextArtifacts,
} from './generated-artifacts.ts';
import {
  buildReproducibleReviewModel,
  exportClinicalReview,
  reviewArtifactChecksums,
  reviewJsonString,
  verifyClinicalReviewArtifacts,
} from './export-review.ts';

const displayPath = (path: string): string => relative(process.cwd(), path).replace(/\\/g, '/');

function expectedTextArtifacts(reviewChecksums = reviewArtifactChecksums(buildReproducibleReviewModel())): Record<string, string> {
  const generated = buildGeneratedTextArtifacts();
  return {
    [GENERATED_PATHS.learnerCases]: generated.learnerCases,
    [GENERATED_PATHS.curation]: generated.curation,
    [GENERATED_PATHS.investigations]: generated.investigations,
    [GENERATED_PATHS.localAi]: generated.localAi,
    [GENERATED_PATHS.referenceCsv]: generated.referenceCsv,
    [GENERATED_PATHS.referenceMarkdown]: generated.referenceMarkdown,
    [GENERATED_PATHS.metadata]: buildArtifactManifest(reviewChecksums),
  };
}

export async function verifyGeneratedClinicalArtifacts(): Promise<string[]> {
  const staleText = await findStaleTextArtifacts(expectedTextArtifacts());
  const staleReview = await verifyClinicalReviewArtifacts();
  return [...new Set([...staleText, ...staleReview])].sort();
}

export async function generateClinicalArtifacts(): Promise<void> {
  await writeGeneratedTextArtifacts();
  const { model } = await exportClinicalReview();
  const metadata = buildArtifactManifest(reviewArtifactChecksums(model));
  await mkdir(dirname(GENERATED_PATHS.metadata), { recursive: true });
  await writeFile(GENERATED_PATHS.metadata, metadata, 'utf8');

  const expected = expectedTextArtifacts(reviewArtifactChecksums(model));
  const staleText = await findStaleTextArtifacts(expected);
  const reviewJson = await readFile(GENERATED_PATHS.reviewJson, 'utf8');
  const repeatReviewJson = reviewJsonString(buildReproducibleReviewModel());
  if (reviewJson !== repeatReviewJson) staleText.push(GENERATED_PATHS.reviewJson);
  if (staleText.length) throw new Error(`Generation was not stable:\n- ${staleText.map(displayPath).join('\n- ')}`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const stale = await verifyGeneratedClinicalArtifacts();
    if (stale.length) {
      console.error(`Generated clinical artifacts are stale:\n- ${stale.map(displayPath).join('\n- ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('PASS  generated clinical artifacts are current and semantically reproducible');
    return;
  }

  await generateClinicalArtifacts();
  console.log('PASS  regenerated all clinical artifacts from src/clinical/cases.ts');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
