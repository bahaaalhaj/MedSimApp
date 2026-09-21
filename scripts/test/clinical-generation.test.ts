import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CLINICAL_CASES,
  toSafeCaseSummary,
  toSafeEncounterCase,
} from '../../src/clinical/cases.ts';
import {
  CURATED_CASE_IDS_BY_SPECIALTY,
  EXCLUDED_LEGACY_CASE_IDS,
} from '../../src/clinical/curation.ts';
import { CLINICAL_REFERENCE_BY_ID } from '../../src/clinical/references.ts';
import { CASES } from '../../src/data/cases.ts';
import { stableStringify } from '../clinical/export-review-model.ts';
import {
  CANONICAL_CLINICAL_CHECKSUM,
  buildCurationSemanticPayload,
  buildGeneratedTextArtifacts,
  buildInvestigationSemanticPayload,
  buildLearnerCaseSemanticPayload,
  buildLocalAiSemanticPayload,
  buildReferenceCsv,
  buildReferenceMarkdown,
} from '../clinical/generated-artifacts.ts';
import { buildReproducibleReviewModel, reviewArtifactChecksums } from '../clinical/export-review.ts';
import { jsonSemanticSha256, sha256Text } from '../clinical/generation-metadata.ts';

const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableStringify(value), 'utf8')
  .digest('hex');

const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8'));

function withoutGeneratedMetadata(value: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'generatedAt' && key !== '_generated'),
  );
}

function preTrustBoundaryLocalAiProjection(value: ReturnType<typeof buildLocalAiSemanticPayload>) {
  const { references: _references, ...previousTopLevel } = value;
  return {
    ...previousTopLevel,
    cases: value.cases.map((item) => {
      const { postSubmission: _postSubmission, ...legacy } = item;
      return {
        ...legacy,
        patient: {
          ...legacy.patient,
          history: legacy.patient.history.map((historyItem) => {
            const { relevant: _relevant, ...previous } = historyItem;
            return previous;
          }),
        },
      };
    }),
  };
}

test('canonical clinical semantics match the approved pre-refactor snapshot', () => {
  assert.equal(CLINICAL_CASES.length, 72);
  assert.equal(EXCLUDED_LEGACY_CASE_IDS.length, 168);
  assert.equal(CLINICAL_CASES.reduce((count, item) => count + item.investigations.length, 0), 422);
  assert.equal(sha256(CLINICAL_CASES), '782798a2db90fac7da32189e5e2706207aec4eaaff6127d1ab90c32afe59db14');
  assert.equal(sha256(CLINICAL_CASES.map(toSafeCaseSummary)), '3c7ac74c8eea7b8d983417992e9cf8584c7dae117c76bb2dd7b90c7cad766833');
  assert.equal(sha256(CLINICAL_CASES.map(toSafeEncounterCase)), '893782aaf4ba22359d84c32341fad99d0a5195e0c9123ea8e0db01f5e0a9b0b5');
  assert.equal(sha256(CURATED_CASE_IDS_BY_SPECIALTY), '11c9294ac6423444eec2d5b9a91b7a34fc7d5e90376074309d793d8ca293c32b');
  assert.equal(sha256(EXCLUDED_LEGACY_CASE_IDS), '2c83e9b005e47b8c6455c05f8401c83334ced930e189ec55a22fabe9c6b75a4f');
});

test('frontend catalogue is an exact projection of the pre-refactor 72 cases', () => {
  assert.equal(CASES.length, 72);
  assert.equal(sha256(CASES), 'efab0fc166e662ad556e7ebc15bb86c5956658b397c170f6ad0479931b859d7b');
  assert.deepEqual(new Set(CASES.map((item) => item.id)), new Set(CLINICAL_CASES.map((item) => item.caseId)));
});

test('committed derived clinical payloads match their pre-refactor semantics', () => {
  const curation = readJson('docs/generated/curation-manifest.json');
  const investigations = readJson('docs/generated/investigation-manifest.server.json');
  const localAi = readJson('docs/generated/local-ai-manifest.server.json');
  const review = readJson('docs/generated/medsim-medical-cases-review.json');
  const reviewClinicalData = {
    cases: review.cases,
    references: review.references,
    reviewRecords: review.reviewRecords,
    legacyMappings: review.legacyMappings,
    issues: review.issues,
  };

  assert.equal(sha256(withoutGeneratedMetadata(curation)), 'dd0c950d93902852277c81bce63e134a3e4bece78ee9a60269810edbba8ec661');
  assert.equal(sha256(withoutGeneratedMetadata(investigations)), 'dc044191268b23f4f9b657edfbd29dd910d95e996ac375570960d4035a8137a3');
  assert.equal(sha256(withoutGeneratedMetadata(localAi)), '11d6d795fe7006ec7cb69b68c450b208f1265ce7dfc37e89c2c0c5b7fbc94056');
  assert.equal(sha256(preTrustBoundaryLocalAiProjection(withoutGeneratedMetadata(localAi) as ReturnType<typeof buildLocalAiSemanticPayload>)), 'e72f06384ea0fcb26a964d045e3ce9855578d06262306d7794c94a752368be45');
  assert.equal(sha256(reviewClinicalData), '90de848bd954f8e03456608a187677f3a6a320c8f153118060366dea889be82b');
  assert.equal(sha256(readFileSync('docs/generated/case-reference-matrix.csv', 'utf8')), '7e7f07de5334d9ed793a475d224ac319dde4ffebe45f98e96695122a1187281b');
  assert.equal(sha256(readFileSync('docs/generated/clinical-references.md', 'utf8')), '96213aefca2f6b9218f2df000c52dd9474b39cc4a34bf688c13ba12b266bee6d');
});

test('all generators are stable and preserve the pre-refactor clinical semantics', () => {
  assert.deepEqual(buildGeneratedTextArtifacts(), buildGeneratedTextArtifacts());
  assert.equal(CANONICAL_CLINICAL_CHECKSUM, '782798a2db90fac7da32189e5e2706207aec4eaaff6127d1ab90c32afe59db14');
  assert.equal(jsonSemanticSha256(buildCurationSemanticPayload()), 'dd0c950d93902852277c81bce63e134a3e4bece78ee9a60269810edbba8ec661');
  assert.equal(jsonSemanticSha256(buildInvestigationSemanticPayload()), 'dc044191268b23f4f9b657edfbd29dd910d95e996ac375570960d4035a8137a3');
  assert.equal(jsonSemanticSha256(buildLearnerCaseSemanticPayload()), '915fbcea03a6b24c8e741bb3b7ad430aec232b28f0ed256bd3ef253c4760575c');
  assert.equal(jsonSemanticSha256(buildLocalAiSemanticPayload()), '11d6d795fe7006ec7cb69b68c450b208f1265ce7dfc37e89c2c0c5b7fbc94056');
  assert.equal(jsonSemanticSha256(preTrustBoundaryLocalAiProjection(buildLocalAiSemanticPayload())), 'e72f06384ea0fcb26a964d045e3ce9855578d06262306d7794c94a752368be45');
  assert.equal(sha256Text(buildReferenceCsv()), '7e7f07de5334d9ed793a475d224ac319dde4ffebe45f98e96695122a1187281b');
  assert.equal(sha256Text(buildReferenceMarkdown()), '96213aefca2f6b9218f2df000c52dd9474b39cc4a34bf688c13ba12b266bee6d');

  const reviewModel = buildReproducibleReviewModel();
  assert.equal(reviewArtifactChecksums(reviewModel).jsonSemanticChecksum, '90de848bd954f8e03456608a187677f3a6a320c8f153118060366dea889be82b');
});

test('canonical case/version keys and clinical relationships are unique and resolvable', () => {
  const caseKeys = CLINICAL_CASES.map((item) => `${item.caseId}@${item.caseVersion}`);
  assert.equal(new Set(caseKeys).size, caseKeys.length);

  for (const clinicalCase of CLINICAL_CASES) {
    assert.equal(CURATED_CASE_IDS_BY_SPECIALTY[clinicalCase.specialtyId].includes(clinicalCase.caseId), true);
    for (const referenceId of clinicalCase.references) {
      assert.ok(CLINICAL_REFERENCE_BY_ID.has(referenceId), `${clinicalCase.caseId}: ${referenceId}`);
    }
    const diagnosisIds = new Set(clinicalCase.differentialDiagnoses.map((item) => item.diagnosisId));
    assert.ok(diagnosisIds.has(clinicalCase.correctDiagnosis.diagnosisId), clinicalCase.caseId);
    assert.equal(new Set(clinicalCase.investigations.map((item) => item.testId)).size, clinicalCase.investigations.length);
  }
});

test('safe DTOs contain no answer-key fields', () => {
  const forbiddenKeys = new Set([
    'correctDiagnosis', 'differentialDiagnoses', 'assessmentRubric', 'medicationExpectations',
    'criticalFailureRules', 'result', 'structuredResult', 'postSubmissionExplanation',
    'supportsDiagnosisIds', 'arguesAgainstDiagnosisIds', 'rationale',
  ]);
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `safe DTO leaked ${key}`);
      inspect(nested);
    }
  };

  CLINICAL_CASES.forEach((clinicalCase) => {
    inspect(toSafeCaseSummary(clinicalCase));
    inspect(toSafeEncounterCase(clinicalCase));
  });
});
