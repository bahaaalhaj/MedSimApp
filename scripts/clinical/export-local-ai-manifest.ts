import fs from 'node:fs';
import path from 'node:path';
import { CLINICAL_CASES, getServerPatientSource } from '../../src/clinical/cases.ts';

const domainFor = (domain: string) =>
  domain === 'communication'
    ? 'interpersonal'
    : ['history', 'examination', 'investigation'].includes(domain)
      ? 'data_gathering'
      : 'clinical_management';

const cases = CLINICAL_CASES.map((clinicalCase) => {
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
      history: patient.anamnesis.map(({ id, question, answer }) => ({ id, question, answer })),
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
  };
});

const outputPath = path.resolve('docs/generated/local-ai-manifest.server.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: '1.0.0', intendedUse: 'server-only-local-ai-context', cases }, null, 2)}\n`, 'utf8');
console.log(`Wrote ${cases.length} cases to ${outputPath}`);
