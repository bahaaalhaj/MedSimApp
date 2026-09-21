import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CLINICAL_CASES, getServerPatientSource, toSafeCaseSummary } from '../../src/clinical/cases.ts';
import { POLYCLINIC_CASES } from '../../src/data/polyclinicPatients.ts';
import {
  CURATED_CASE_IDS,
  CURATED_CASE_IDS_BY_SPECIALTY,
  EXCLUDED_LEGACY_CASE_IDS,
} from '../../src/clinical/curation.ts';
import { CLINICAL_REFERENCE_BY_ID } from '../../src/clinical/references.ts';
import {
  CANONICAL_CLINICAL_SOURCE,
  CLINICAL_GENERATOR_COMMAND,
  GENERATED_NOTICE,
  REPRODUCIBLE_GENERATED_AT,
  generatedMetadata,
  jsonSemanticSha256,
  semanticSha256,
  sha256Text,
} from './generation-metadata.ts';

export const GENERATED_OUTPUT_DIR = resolve('docs/generated');
export const GENERATED_PATHS = {
  learnerCases: resolve('src/generated/learner-case-manifest.json'),
  curation: resolve(GENERATED_OUTPUT_DIR, 'curation-manifest.json'),
  investigations: resolve(GENERATED_OUTPUT_DIR, 'investigation-manifest.server.json'),
  localAi: resolve(GENERATED_OUTPUT_DIR, 'local-ai-manifest.server.json'),
  referenceCsv: resolve(GENERATED_OUTPUT_DIR, 'case-reference-matrix.csv'),
  referenceMarkdown: resolve(GENERATED_OUTPUT_DIR, 'clinical-references.md'),
  metadata: resolve(GENERATED_OUTPUT_DIR, 'clinical-artifacts.manifest.json'),
  reviewJson: resolve(GENERATED_OUTPUT_DIR, 'medsim-medical-cases-review.json'),
  reviewXlsx: resolve(GENERATED_OUTPUT_DIR, 'medsim-medical-cases-review.xlsx'),
} as const;

export type GeneratedTextArtifactKey = 'learnerCases' | 'curation' | 'investigations' | 'localAi' | 'referenceCsv' | 'referenceMarkdown';

export const CANONICAL_CLINICAL_CHECKSUM = semanticSha256(CLINICAL_CASES);

const domainFor = (domain: string) =>
  domain === 'communication'
    ? 'interpersonal'
    : ['history', 'examination', 'investigation'].includes(domain)
      ? 'data_gathering'
      : 'clinical_management';

export function buildCurationSemanticPayload() {
  return {
    schemaVersion: '1.0.0',
    publicLabel: 'Educational case / Source-backed formative case',
    accreditationClaim: false,
    counts: {
      curated: CURATED_CASE_IDS.length,
      archived: EXCLUDED_LEGACY_CASE_IDS.length,
      specialties: Object.keys(CURATED_CASE_IDS_BY_SPECIALTY).length,
    },
    curatedCaseIdsBySpecialty: CURATED_CASE_IDS_BY_SPECIALTY,
    curatedCaseIds: CURATED_CASE_IDS,
    excludedLegacyCaseIds: EXCLUDED_LEGACY_CASE_IDS,
    safeCases: CLINICAL_CASES.map(toSafeCaseSummary),
  };
}

export function buildInvestigationSemanticPayload() {
  return {
    schemaVersion: '1.0.0',
    intendedUse: 'server-only-answer-key',
    cases: CLINICAL_CASES.map((clinicalCase) => ({
      caseId: clinicalCase.caseId,
      caseVersion: clinicalCase.caseVersion,
      investigations: clinicalCase.investigations,
    })),
  };
}

export function buildLearnerCaseSemanticPayload() {
  const canonicalById = new Map(CLINICAL_CASES.map((clinicalCase) => [clinicalCase.caseId, clinicalCase]));
  const seen = new Set<string>();
  const runtimeCases = Object.entries(POLYCLINIC_CASES).flatMap(([specialtyId, patients]) => {
    if (specialtyId === 'all-specialties') return [];
    return patients.flatMap((patient) => {
      const clinicalCase = canonicalById.get(patient.id);
      if (!clinicalCase || seen.has(patient.id)) return [];
      seen.add(patient.id);
      return [clinicalCase];
    });
  });
  if (runtimeCases.length !== CLINICAL_CASES.length) throw new Error('Learner runtime case order does not cover the canonical cohort');
  return {
    schemaVersion: '1.0.0',
    intendedUse: 'learner-safe-browser-runtime',
    cases: runtimeCases.map((clinicalCase) => {
      const patient = getServerPatientSource(clinicalCase.caseId);
      if (!patient) throw new Error(`Missing patient case ${clinicalCase.caseId}`);
      const labels = new Map(clinicalCase.differentialDiagnoses.map((item) => [item.diagnosisId, item.label]));
      return {
        caseId: clinicalCase.caseId,
        caseVersion: clinicalCase.caseVersion,
        rubricVersion: clinicalCase.rubricVersion,
        specialtyId: clinicalCase.specialtyId,
        displayName: patient.name,
        age: patient.age,
        gender: patient.gender,
        severity: patient.severity,
        arrivalBlurb: patient.arrivalBlurb,
        publicComplaint: patient.chiefComplaint,
        vitalSigns: patient.vitals,
        historyQuestions: patient.anamnesis.map(({ id, question }) => ({ id, question })),
        diagnosisOptions: patient.diagnosisOptions.map((diagnosisId) => ({
          diagnosisId,
          label: labels.get(diagnosisId) ?? diagnosisId.replace(/-/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase()),
        })),
        difficulty: clinicalCase.difficulty,
        learnerLevel: clinicalCase.targetLearnerLevel,
        reviewStatus: clinicalCase.reviewStatus,
        variantPolicy: clinicalCase.variantPolicy,
      };
    }),
  };
}

export function buildLocalAiSemanticPayload() {
  const usedReferenceIds = new Set(CLINICAL_CASES.flatMap((clinicalCase) => clinicalCase.references));
  return {
    schemaVersion: '1.0.0',
    intendedUse: 'server-only-local-ai-context',
    references: [...CLINICAL_REFERENCE_BY_ID.values()].filter((reference) => usedReferenceIds.has(reference.referenceId)),
    cases: CLINICAL_CASES.map((clinicalCase) => {
      const patient = getServerPatientSource(clinicalCase.caseId);
      if (!patient) throw new Error(`Missing patient case ${clinicalCase.caseId}`);
      return {
        caseId: clinicalCase.caseId,
        caseVersion: clinicalCase.caseVersion,
        rubricVersion: clinicalCase.rubricVersion,
        patient: {
          displayName: patient.name,
          age: patient.age,
          gender: patient.gender,
          severity: patient.severity,
          chiefComplaint: patient.chiefComplaint,
          arrivalBlurb: patient.arrivalBlurb,
          history: patient.anamnesis.map(({ id, question, answer, relevant }) => ({ id, question, answer, relevant })),
          variantPolicy: clinicalCase.variantPolicy,
        },
        evaluation: {
          correctDiagnosisId: clinicalCase.correctDiagnosis.diagnosisId,
          diagnosisOptionIds: clinicalCase.differentialDiagnoses.map((item) => item.diagnosisId),
          rubric: clinicalCase.assessmentRubric.criteria.map((criterion) => ({
            criterionId: criterion.criterionId,
            domain: domainFor(criterion.domain),
            sourceDomain: criterion.domain,
            description: criterion.description,
            observableEvidence: criterion.observableEvidence,
            weight: criterion.weight,
            isCritical: criterion.isCritical,
            referenceIds: criterion.referenceIds,
          })),
          allowedReferenceIds: clinicalCase.references,
          medicationScoring: clinicalCase.medicationScoring,
          medicationExpectations: clinicalCase.medicationExpectations,
          criticalFailureRules: clinicalCase.criticalFailureRules,
        },
        postSubmission: {
          correctDiagnosis: clinicalCase.correctDiagnosis,
        },
      };
    }),
  };
}

export function buildReferenceCsv(): string {
  const rows = [['Case ID','Case version','Specialty','Clinical topic','Reference ID','Organization','Title','Year','Recommendation or section','URL','Access date','Verification status','Review status']];
  for (const clinicalCase of CLINICAL_CASES) for (const referenceId of clinicalCase.references) {
    const reference = CLINICAL_REFERENCE_BY_ID.get(referenceId);
    if (!reference) continue;
    rows.push([
      clinicalCase.caseId, clinicalCase.caseVersion, clinicalCase.specialtyId, clinicalCase.title,
      referenceId, reference.organization, reference.title, String(reference.publicationYear),
      reference.recommendationId ?? reference.section ?? '', reference.url, reference.accessedAt,
      reference.verificationStatus, clinicalCase.reviewStatus,
    ]);
  }
  return `${rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;
}

export function buildReferenceMarkdown(): string {
  const lines = ['# Clinical references', '', '> Generated metadata export. Source verification does not constitute clinical approval of a case.', ''];
  let index = 1;
  for (const reference of CLINICAL_REFERENCE_BY_ID.values()) {
    const used = CLINICAL_CASES.filter((clinicalCase) => clinicalCase.references.includes(reference.referenceId));
    if (used.length === 0) continue;
    lines.push(`${index}. ${reference.organization}. ${reference.title}. ${reference.version ?? reference.publicationYear}. ${reference.url} (accessed ${reference.accessedAt}).`);
    lines.push(`   - Reference ID: \`${reference.referenceId}\`; status: \`${reference.verificationStatus}\`; region: ${reference.region}; section: ${reference.recommendationId ?? reference.section ?? 'unavailable'}.`);
    lines.push(`   - Cases: ${used.map((clinicalCase) => `\`${clinicalCase.caseId}@${clinicalCase.caseVersion}\` (${clinicalCase.reviewStatus})`).join(', ')}.`);
    lines.push('');
    index += 1;
  }
  return lines.join('\n');
}

function jsonArtifact(semanticPayload: Record<string, unknown>, includeGeneratedAt = false): string {
  const payload = {
    _generated: generatedMetadata(CANONICAL_CLINICAL_CHECKSUM, jsonSemanticSha256(semanticPayload)),
    ...semanticPayload,
    ...(includeGeneratedAt ? { generatedAt: REPRODUCIBLE_GENERATED_AT } : {}),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function buildGeneratedTextArtifacts(): Record<GeneratedTextArtifactKey, string> {
  return {
    learnerCases: jsonArtifact(buildLearnerCaseSemanticPayload()),
    curation: jsonArtifact(buildCurationSemanticPayload(), true),
    investigations: jsonArtifact(buildInvestigationSemanticPayload(), true),
    localAi: jsonArtifact(buildLocalAiSemanticPayload()),
    referenceCsv: buildReferenceCsv(),
    referenceMarkdown: buildReferenceMarkdown(),
  };
}

export async function writeGeneratedTextArtifacts(keys?: readonly GeneratedTextArtifactKey[]): Promise<void> {
  const artifacts = buildGeneratedTextArtifacts();
  const selected = keys ?? (Object.keys(artifacts) as GeneratedTextArtifactKey[]);
  for (const key of selected) {
    const outputPath = GENERATED_PATHS[key];
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, artifacts[key], 'utf8');
  }
}

export interface ReviewArtifactChecksums {
  jsonSemanticChecksum: string;
  workbookSemanticChecksum: string;
}

export function buildArtifactManifest(review: ReviewArtifactChecksums): string {
  const artifacts = buildGeneratedTextArtifacts();
  const records = [
    { path: 'src/generated/learner-case-manifest.json', semanticChecksum: jsonSemanticSha256(buildLearnerCaseSemanticPayload()) },
    { path: 'docs/generated/curation-manifest.json', semanticChecksum: jsonSemanticSha256(buildCurationSemanticPayload()) },
    { path: 'docs/generated/investigation-manifest.server.json', semanticChecksum: jsonSemanticSha256(buildInvestigationSemanticPayload()) },
    { path: 'docs/generated/local-ai-manifest.server.json', semanticChecksum: jsonSemanticSha256(buildLocalAiSemanticPayload()) },
    { path: 'docs/generated/case-reference-matrix.csv', semanticChecksum: sha256Text(artifacts.referenceCsv) },
    { path: 'docs/generated/clinical-references.md', semanticChecksum: sha256Text(artifacts.referenceMarkdown) },
    { path: 'docs/generated/medsim-medical-cases-review.json', semanticChecksum: review.jsonSemanticChecksum },
    { path: 'docs/generated/medsim-medical-cases-review.xlsx', semanticChecksum: review.workbookSemanticChecksum },
  ].map((item) => ({ ...item, semanticChecksum: `sha256:${item.semanticChecksum}` }));
  const semanticPayload = {
    schemaVersion: '1.0.0',
    canonicalSource: CANONICAL_CLINICAL_SOURCE,
    canonicalSourceChecksum: `sha256:${CANONICAL_CLINICAL_CHECKSUM}`,
    generatorCommand: CLINICAL_GENERATOR_COMMAND,
    counts: {
      assignableCases: CLINICAL_CASES.length,
      archivedCases: EXCLUDED_LEGACY_CASE_IDS.length,
      investigationRecords: CLINICAL_CASES.reduce((count, item) => count + item.investigations.length, 0),
    },
    artifacts: records,
  };
  return `${JSON.stringify({
    _generated: {
      notice: GENERATED_NOTICE,
      sourceFile: CANONICAL_CLINICAL_SOURCE,
      generatorCommand: CLINICAL_GENERATOR_COMMAND,
      canonicalSourceChecksum: `sha256:${CANONICAL_CLINICAL_CHECKSUM}`,
      semanticChecksum: `sha256:${semanticSha256(semanticPayload)}`,
    },
    ...semanticPayload,
  }, null, 2)}\n`;
}

export async function findStaleTextArtifacts(expected: Record<string, string>): Promise<string[]> {
  const stale: string[] = [];
  for (const [outputPath, content] of Object.entries(expected)) {
    try {
      if (await readFile(outputPath, 'utf8') !== content) stale.push(outputPath);
    } catch {
      stale.push(outputPath);
    }
  }
  return stale;
}
