import { POLYCLINIC_CASES, POLYCLINIC_DIAGNOSIS_LABELS } from '../data/polyclinicPatients.ts';
import type { PatientCase } from '../game/types';
import { CLINICAL_REFERENCE_BY_ID } from './references.ts';
import {
  CURATED_CASE_IDS_BY_SPECIALTY,
  PRIMARY_REFERENCE_BY_CASE_ID,
  TIME_CRITICAL_CASE_IDS,
  isCuratedCaseId,
} from './curation.ts';
import { CURATION_REQUIREMENTS } from './curationRequirements.ts';
import { buildCaseInvestigations } from './investigations.ts';
import type {
  CaseReviewRecord,
  ClinicalCase,
  ClinicalRubricCriterion,
  PostSubmissionReview,
  SafeCaseSummary,
  SafeEncounterCase,
} from './types';

const LEGACY_BY_ID = new Map<string, PatientCase>();
for (const [clinic, cases] of Object.entries(POLYCLINIC_CASES)) {
  if (clinic === 'all-specialties') continue;
  for (const patientCase of cases) LEGACY_BY_ID.set(patientCase.id, patientCase);
}

function legacy(id: string): PatientCase {
  const value = LEGACY_BY_ID.get(id);
  if (!value) throw new Error(`Pilot case cannot resolve legacy case ${id}`);
  return value;
}

const PENDING_REVIEW: CaseReviewRecord = {
  clinicalReviewers: [],
  reviewStatus: 'clinical-review',
  checklist: {
    diagnosisAccurate: 'not-reviewed', historyInternallyConsistent: 'not-reviewed',
    examinationConsistent: 'not-reviewed', investigationsAppropriate: 'not-reviewed',
    differentialDiagnosesPlausible: 'not-reviewed', managementAppropriate: 'not-reviewed',
    medicationDetailsAppropriate: 'not-reviewed', safetyAndReferralAppropriate: 'not-reviewed',
    referencesVerified: 'not-reviewed', learnerLevelAppropriate: 'not-reviewed',
    rubricObservableAndFair: 'not-reviewed',
  },
  unresolvedComments: [
    { commentId: 'clinical-signoff-required', area: 'clinical review', comment: 'Independent qualified-clinician review has not yet been recorded.', critical: true },
  ],
};

function label(id: string): string {
  return POLYCLINIC_DIAGNOSIS_LABELS[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function rubricCriterion(
  criterionId: string,
  domain: ClinicalRubricCriterion['domain'],
  description: string,
  objectiveIds: string[],
  referenceIds: string[],
  weight = 1,
  isCritical = false,
): ClinicalRubricCriterion {
  return { criterionId, domain, description, observableEvidence: [description], weight, isCritical, learningObjectiveIds: objectiveIds, referenceIds };
}

function baseFromLegacy(
  id: string,
  title: string,
  caseVersion: string,
  referenceIds: string[],
): Pick<ClinicalCase,
  'schemaVersion' | 'caseId' | 'caseVersion' | 'rubricVersion' | 'referenceSetVersion' |
  'title' | 'specialtyId' | 'targetLearnerLevel' | 'difficulty' | 'reviewStatus' |
  'clinicalRegion' | 'language' | 'intendedUse' | 'approvalBasis' | 'clinicalSetting' |
  'chronology' | 'pertinentNegatives' | 'riskModifiers' | 'patientProfile' | 'presentingComplaint' |
  'history' | 'physicalExamination' | 'vitalSigns' | 'investigations' | 'imaging' |
  'correctDiagnosis' | 'medicationScoring' | 'criticalFailureRules' | 'evidenceMappings' |
  'references' | 'reviewRecord' | 'changeSummary'> {
  const p = legacy(id);
  return {
    schemaVersion: '1.0.0', caseId: id, caseVersion, rubricVersion: '1.0.0',
    referenceSetVersion: '1.0.0', title, specialtyId: 'internal-medicine',
    targetLearnerLevel: 'undergraduate-clinical-years', difficulty: 'intermediate',
    reviewStatus: 'clinical-review', clinicalRegion: 'United Kingdom pilot', language: 'en',
    intendedUse: 'formative-only', approvalBasis: 'source-only', clinicalSetting: 'outpatient-clinic',
    chronology: [p.chiefComplaint, p.arrivalBlurb],
    pertinentNegatives: p.anamnesis.filter((q) => q.relevant && /\b(no|denies|without|never)\b/i.test(q.answer)).map((q) => q.answer),
    riskModifiers: p.anamnesis.filter((q) => q.relevant).slice(0, 4).map((q) => `${q.question} ${q.answer}`),
    patientProfile: { displayName: p.name, age: p.age, gender: p.gender, syntheticComposite: true },
    presentingComplaint: { publicSummary: p.chiefComplaint, fullClinicalDescription: p.arrivalBlurb },
    history: p.anamnesis.map((q) => ({ itemId: q.id, question: q.question, answer: q.answer })),
    physicalExamination: [{ findingId: 'general', description: p.arrivalBlurb }],
    vitalSigns: { ...p.vitals, hrUnit: 'beats/min', bpUnit: 'mmHg', spo2Unit: '%', tempUnit: '°C', rrUnit: 'breaths/min' },
    investigations: buildCaseInvestigations({
      caseId: id, caseVersion, tests: p.testResults,
      differentials: [{ diagnosisId: p.correctDiagnosisId, label: label(p.correctDiagnosisId), isCorrect: true, rationale: '', supportingFindings: [], findingsAgainst: [] }],
      rubricCriterionId: `${id}-investigation`, referenceId: referenceIds[0] ?? 'unresolved-reference', timeCritical: false,
    }),
    imaging: p.testResults
      .filter((r) => ['cxr', 'ecg', 'echo', 'fundoscopy'].includes(r.testId))
      .map((r) => ({ testId: r.testId, interpretation: r.result, sourceKind: 'case-specific-simulation' as const })),
    correctDiagnosis: { diagnosisId: p.correctDiagnosisId, label: label(p.correctDiagnosisId) },
    medicationScoring: { enabled: false, reason: 'Exact drug, dose, contraindication, interaction and monitoring data have not been jointly verified against current BNF and local policy.', verificationRequired: 'BNF-and-local-formulary' },
    criticalFailureRules: [],
    evidenceMappings: referenceIds.map((referenceId) => ({ fieldPath: 'case-level-source-target', referenceId, jurisdiction: 'United Kingdom', accessedAt: '2026-09-10', verificationMethod: 'workbook-source-target' as const })),
    references: referenceIds,
    reviewRecord: { ...PENDING_REVIEW, checklist: { ...PENDING_REVIEW.checklist }, unresolvedComments: [...PENDING_REVIEW.unresolvedComments] },
    changeSummary: 'Initial migration from the legacy synthetic case bank into schema 1.0.0; pending clinical review.',
  };
}

const hypertension: ClinicalCase = {
  ...baseFromLegacy('im-003', 'Raised blood-pressure readings in an asymptomatic adult', '1.0.0', ['nice-ng136', 'nbme-item-writing-2021']),
  learningObjectives: [
    { objectiveId: 'htn-o1', description: 'Confirm persistent hypertension using appropriate out-of-office measurement.' },
    { objectiveId: 'htn-o2', description: 'Assess cardiovascular risk, target-organ damage, and features suggesting a secondary cause.' },
    { objectiveId: 'htn-o3', description: 'Select an initial management and monitoring plan appropriate to the presented context.' },
    { objectiveId: 'htn-o4', description: 'Recognize findings that require same-day assessment or escalation.' },
  ],
  differentialDiagnoses: [
    { diagnosisId: 'essential-hypertension', label: label('essential-hypertension'), isCorrect: true, rationale: 'Repeated raised readings without a clear secondary-cause history make primary hypertension the leading working diagnosis, subject to confirmation.', supportingFindings: ['Repeated pharmacy readings around 150/95', 'Family history', 'High salt intake'], findingsAgainst: ['Out-of-office confirmation has not yet been recorded'] },
    { diagnosisId: 'white-coat-hypertension', label: 'White-coat hypertension', isCorrect: false, rationale: 'Clinic-associated elevation is plausible until ABPM or HBPM is completed.', supportingFindings: ['Asymptomatic elevated readings'], findingsAgainst: ['Readings were reported at a pharmacy on several occasions'] },
    { diagnosisId: 'renal-artery-stenosis', label: label('renal-artery-stenosis'), isCorrect: false, rationale: 'A renovascular cause belongs in the differential for selected patients.', supportingFindings: ['Raised blood pressure'], findingsAgainst: ['Normal creatinine and potassium', 'No abrupt onset or resistant-treatment history provided'] },
    { diagnosisId: 'primary-hyperaldosteronism', label: 'Primary hyperaldosteronism', isCorrect: false, rationale: 'A secondary endocrine cause is considered when the pattern is resistant or potassium is low.', supportingFindings: ['Raised blood pressure'], findingsAgainst: ['Normal potassium', 'No resistant hypertension established'] },
    { diagnosisId: 'pheochromocytoma', label: 'Pheochromocytoma', isCorrect: false, rationale: 'Paroxysmal adrenergic symptoms would make this more plausible.', supportingFindings: ['Raised blood pressure'], findingsAgainst: ['No episodic headache, sweating, or palpitations'] },
  ],
  managementPlan: { summary: 'Confirm with ABPM/HBPM, assess target-organ damage and cardiovascular risk, discuss lifestyle measures, then individualize treatment.', nonPharmacological: ['Diet and activity discussion', 'Salt reduction', 'Shared decision-making'], referral: ['Same-day assessment for severe blood pressure with retinal or life-threatening features'] },
  medicationExpectations: [{ medicationId: 'ramipril-5', genericName: 'Ramipril', indication: 'Potential first-line antihypertensive after confirmation and individual assessment', dose: 'Case-specific starting dose requires reviewer confirmation', unit: 'not-finalized', route: 'oral', frequency: 'once daily', duration: 'ongoing with review', contraindications: ['Pregnancy', 'Previous ACE-inhibitor angioedema'], allergies: ['ACE-inhibitor hypersensitivity'], renalAdjustment: 'Check renal function and potassium; local prescribing review required.', hepaticAdjustment: 'Review product information.', pregnancyOrAgeRestrictions: 'Contraindicated in pregnancy; patient-specific review required.', monitoring: ['Blood pressure', 'Creatinine/eGFR', 'Potassium'], acceptableAlternatives: ['ARB when ACE inhibitor is not tolerated and otherwise appropriate'], referenceIds: ['nice-ng136'] }],
  contraindications: [{ description: 'Do not prescribe before checking patient-specific contraindications and baseline renal function.', referenceIds: ['nice-ng136'] }],
  redFlags: [{ description: 'Severe blood pressure with retinal changes or life-threatening symptoms', action: 'Same-day specialist assessment', referenceIds: ['nice-ng136'] }],
  referralCriteria: [{ criterion: 'Accelerated hypertension or life-threatening symptoms', action: 'Same-day assessment', referenceIds: ['nice-ng136'] }],
  safetyNetting: [{ instruction: 'Seek urgent care for new chest pain, confusion, heart-failure symptoms, focal neurology, or severe visual symptoms.', referenceIds: ['nice-ng136'] }],
  assessmentRubric: { rubricVersion: '1.0.0', criteria: [
    rubricCriterion('htn-r1', 'history', 'Records the pattern and context of prior blood-pressure readings.', ['htn-o1'], ['nice-ng136'], 2),
    rubricCriterion('htn-r2', 'investigation', 'Arranges ABPM or HBPM and appropriate target-organ assessment.', ['htn-o1', 'htn-o2'], ['nice-ng136'], 3, true),
    rubricCriterion('htn-r3', 'management', 'Explains an individualized lifestyle and treatment plan without treating an unconfirmed reading as final.', ['htn-o3'], ['nice-ng136'], 3),
    rubricCriterion('htn-r4', 'patient-safety', 'Identifies symptoms and findings requiring same-day escalation.', ['htn-o4'], ['nice-ng136'], 3, true),
    rubricCriterion('htn-r5', 'communication', 'Uses shared decision-making and checks understanding.', ['htn-o3'], ['nbme-item-writing-2021'], 1),
  ] },
  variantPolicy: { allowedDisplayNames: ['Michael Williams', 'Daniel Wilson'], ageRange: { min: 45, max: 54 }, allowedComplaintPhrasings: ['My pharmacist said my blood pressure is too high. I feel fine.', 'I have had several high blood-pressure readings but no symptoms.'], difficultyOptions: ['intermediate'] },
};

const diabetes: ClinicalCase = {
  ...baseFromLegacy('im-004', 'Thirst, polyuria, and unintentional weight loss', '1.0.0', ['nice-ng28', 'nbme-item-writing-2021']),
  learningObjectives: [
    { objectiveId: 'dm-o1', description: 'Identify symptoms and biochemical findings that support a new diagnosis of diabetes.' },
    { objectiveId: 'dm-o2', description: 'Screen for acute metabolic decompensation and features that affect diabetes classification.' },
    { objectiveId: 'dm-o3', description: 'Plan initial education, monitoring, and individualized treatment.' },
    { objectiveId: 'dm-o4', description: 'Communicate safety-netting and sick-day escalation clearly.' },
  ],
  differentialDiagnoses: [
    { diagnosisId: 'type2-diabetes', label: label('type2-diabetes'), isCorrect: true, rationale: 'The symptom pattern, family history, age, and hyperglycaemia support type 2 diabetes as the leading diagnosis.', supportingFindings: ['Polyuria and polydipsia', 'HbA1c 9.4%', 'Strong family history'], findingsAgainst: ['Weight loss and trace ketones require attention to alternative classification and decompensation'] },
    { diagnosisId: 'type1-dm-new', label: label('type1-dm-new'), isCorrect: false, rationale: 'Weight loss and ketosis make new type 1 diabetes a safety-relevant alternative.', supportingFindings: ['Weight loss', 'Trace urinary ketones'], findingsAgainst: ['Age and family pattern are more typical of type 2', 'Normal bicarbonate and anion gap'] },
    { diagnosisId: 'latent-autoimmune-diabetes-adults', label: 'Latent autoimmune diabetes in adults', isCorrect: false, rationale: 'Adult-onset autoimmune diabetes can resemble type 2 diabetes.', supportingFindings: ['Adult onset with weight loss'], findingsAgainst: ['No autoimmune history or confirmatory antibody/C-peptide data'] },
    { diagnosisId: 'diabetes-insipidus', label: 'Diabetes insipidus', isCorrect: false, rationale: 'Polyuria and thirst can occur without hyperglycaemia.', supportingFindings: ['Polyuria and polydipsia'], findingsAgainst: ['Marked hyperglycaemia and glycosuria explain the symptoms'] },
    { diagnosisId: 'primary-polydipsia', label: 'Primary polydipsia', isCorrect: false, rationale: 'Excess water intake can cause urinary frequency.', supportingFindings: ['Thirst and frequent urination'], findingsAgainst: ['HbA1c and random glucose are in the diabetes range'] },
  ],
  managementPlan: { summary: 'Assess acute stability and classification, provide structured education, agree individualized glycaemic goals, and introduce treatment stepwise.', nonPharmacological: ['Structured diabetes education', 'Healthy living and nutrition plan'], referral: ['Urgent assessment for vomiting, abdominal pain, drowsiness, deep breathing, or inability to maintain hydration'] },
  medicationExpectations: [{ medicationId: 'metformin-500', genericName: 'Metformin', indication: 'Initial glucose-lowering therapy when appropriate after patient-specific assessment', dose: 'Case-specific titration requires reviewer confirmation', unit: 'not-finalized', route: 'oral', frequency: 'stepwise titration', duration: 'ongoing with review', contraindications: ['Acute metabolic acidosis', 'Severe renal impairment'], allergies: ['Metformin hypersensitivity'], renalAdjustment: 'Use eGFR and current product guidance.', hepaticAdjustment: 'Use caution and product guidance.', pregnancyOrAgeRestrictions: 'Individual assessment required.', monitoring: ['HbA1c', 'Renal function', 'Tolerance'], acceptableAlternatives: ['Class choice depends on comorbidity, preferences, and current guidance'], referenceIds: ['nice-ng28'] }],
  contraindications: [{ description: 'Medication selection depends on renal function, acute illness, pregnancy status, comorbidity, and tolerability.', referenceIds: ['nice-ng28'] }],
  redFlags: [{ description: 'Possible ketoacidosis or hyperosmolar decompensation', action: 'Urgent same-day assessment', referenceIds: ['nice-ng28'] }],
  referralCriteria: [{ criterion: 'Acute metabolic decompensation or uncertain diabetes classification', action: 'Urgent or specialist assessment as appropriate', referenceIds: ['nice-ng28'] }],
  safetyNetting: [{ instruction: 'Seek urgent assessment for vomiting, abdominal pain, drowsiness, deep breathing, dehydration, or rapid deterioration.', referenceIds: ['nice-ng28'] }],
  assessmentRubric: { rubricVersion: '1.0.0', criteria: [
    rubricCriterion('dm-r1', 'history', 'Elicits osmotic symptoms, weight loss, infection, and acute metabolic symptoms.', ['dm-o1', 'dm-o2'], ['nice-ng28'], 2),
    rubricCriterion('dm-r2', 'investigation', 'Interprets the learner-visible glucose, HbA1c, urinalysis, renal function, and acid-base information.', ['dm-o1', 'dm-o2'], ['nice-ng28'], 3, true),
    rubricCriterion('dm-r3', 'management', 'Offers education, individualized targets, monitoring, and stepwise treatment.', ['dm-o3'], ['nice-ng28'], 3),
    rubricCriterion('dm-r4', 'patient-safety', 'Provides explicit urgent escalation and sick-day safety-netting.', ['dm-o4'], ['nice-ng28'], 3, true),
    rubricCriterion('dm-r5', 'communication', 'Explains the formative plan in plain language and checks understanding.', ['dm-o3'], ['nbme-item-writing-2021'], 1),
  ] },
  variantPolicy: { allowedDisplayNames: ['Patricia Brown', 'Helen Taylor'], ageRange: { min: 52, max: 62 }, allowedComplaintPhrasings: ["I'm thirsty all the time and urinating constantly.", 'I keep drinking water and going to the toilet, and I have lost weight.'], difficultyOptions: ['intermediate'] },
};

const pneumonia: ClinicalCase = {
  ...baseFromLegacy('im-005', 'Acute productive cough and fever in the community', '1.0.0', ['nice-ng250', 'nbme-item-writing-2021']),
  learningObjectives: [
    { objectiveId: 'cap-o1', description: 'Identify history and examination features supporting community-acquired pneumonia.' },
    { objectiveId: 'cap-o2', description: 'Use community severity assessment to inform place-of-care decisions.' },
    { objectiveId: 'cap-o3', description: 'Choose an initial management plan consistent with cited guidance and local antimicrobial review.' },
    { objectiveId: 'cap-o4', description: 'Provide deterioration and non-improvement safety-netting.' },
  ],
  differentialDiagnoses: [
    { diagnosisId: 'community-acquired-pna', label: label('community-acquired-pna'), isCorrect: true, rationale: 'Acute fever, productive cough, pleuritic pain, and focal consolidation support community-acquired pneumonia.', supportingFindings: ['Fever', 'Purulent sputum', 'Right lower lobe consolidation'], findingsAgainst: ['No major feature argues against it in the modeled presentation'] },
    { diagnosisId: 'acute-bronchitis', label: 'Acute bronchitis', isCorrect: false, rationale: 'Acute cough and sputum are compatible with bronchitis.', supportingFindings: ['Five-day cough', 'Sputum'], findingsAgainst: ['Focal radiographic consolidation and high inflammatory markers'] },
    { diagnosisId: 'influenza', label: 'Influenza', isCorrect: false, rationale: 'Fever and respiratory symptoms can reflect influenza.', supportingFindings: ['Fever and contact history'], findingsAgainst: ['Negative modeled influenza test', 'Focal lobar consolidation'] },
    { diagnosisId: 'pulmonary-embolism', label: 'Pulmonary embolism', isCorrect: false, rationale: 'Pleuritic pain and tachycardia require consideration.', supportingFindings: ['Pleuritic pain', 'Heart rate 96'], findingsAgainst: ['Purulent sputum, fever, neutrophilia, and lobar consolidation favor infection'] },
    { diagnosisId: 'pulmonary-tuberculosis', label: 'Pulmonary tuberculosis', isCorrect: false, rationale: 'Cough and constitutional symptoms can reflect tuberculosis.', supportingFindings: ['Cough and reduced appetite'], findingsAgainst: ['Short duration, acute fever, and lobar pattern without modeled TB exposure'] },
  ],
  managementPlan: { summary: 'Assess severity, confirm suitability for community care, provide prompt oral treatment when appropriate, and safety-net explicitly.', nonPharmacological: ['Hydration and symptom advice', 'Rest and follow-up'], referral: ['Hospital referral for higher severity, rapid deterioration, or failure to improve'] },
  medicationExpectations: [{ medicationId: 'amoxicillin-500', genericName: 'Amoxicillin', indication: 'Low-severity community-acquired pneumonia when appropriate', dose: '500', unit: 'mg', route: 'oral', frequency: 'three times daily', duration: '5 days unless instability or microbiology indicates otherwise', contraindications: ['Immediate penicillin hypersensitivity'], allergies: ['Penicillin allergy'], renalAdjustment: 'Use current product guidance for renal impairment.', hepaticAdjustment: 'Use current product guidance.', pregnancyOrAgeRestrictions: 'Patient-specific review required.', monitoring: ['Clinical improvement', 'Adverse effects', 'Deterioration'], acceptableAlternatives: ['Alternative agent depends on allergy, pregnancy, interactions, and local antimicrobial policy'], referenceIds: ['nice-ng250'] }],
  contraindications: [{ description: 'Choice must account for allergy, pregnancy, interactions, resistance, and local antimicrobial policy.', referenceIds: ['nice-ng250'] }],
  redFlags: [{ description: 'Confusion, hypotension, marked tachypnoea, hypoxaemia, or rapid deterioration', action: 'Urgent hospital assessment', referenceIds: ['nice-ng250'] }],
  referralCriteria: [{ criterion: 'Symptoms fail to improve as expected or worsen rapidly/significantly', action: 'Reassess and refer to hospital when indicated', referenceIds: ['nice-ng250'] }],
  safetyNetting: [{ instruction: 'Seek prompt reassessment if symptoms worsen rapidly or do not begin to improve within 3 days.', referenceIds: ['nice-ng250'] }],
  assessmentRubric: { rubricVersion: '1.0.0', criteria: [
    rubricCriterion('cap-r1', 'history', 'Characterizes cough, pleuritic pain, risk factors, allergies, and severity symptoms.', ['cap-o1', 'cap-o2'], ['nice-ng250'], 2),
    rubricCriterion('cap-r2', 'clinical-reasoning', 'Uses CRB65 and the learner-visible findings to justify community or hospital care.', ['cap-o2'], ['nice-ng250'], 3, true),
    rubricCriterion('cap-r3', 'management', 'Selects prompt oral treatment and duration with local-policy caveats.', ['cap-o3'], ['nice-ng250'], 3),
    rubricCriterion('cap-r4', 'patient-safety', 'Gives explicit rapid-deterioration and non-improvement safety-netting.', ['cap-o4'], ['nice-ng250'], 3, true),
    rubricCriterion('cap-r5', 'communication', 'Explains expected recovery and checks medicine understanding.', ['cap-o3'], ['nbme-item-writing-2021'], 1),
  ] },
  variantPolicy: { allowedDisplayNames: ['David Jones', 'Robert Harris'], ageRange: { min: 40, max: 54 }, allowedComplaintPhrasings: ["I've had a cough with yellow phlegm and fever for 5 days.", 'I have had fever and a chesty cough for nearly a week.'], difficultyOptions: ['intermediate'] },
};

export const HISTORICAL_CLINICAL_CASE_VERSIONS: ClinicalCase[] = [hypertension, diabetes, pneumonia];

const timeCriticalSet = new Set(TIME_CRITICAL_CASE_IDS);

function rebuiltCase(caseId: string, specialtyId: ClinicalCase['specialtyId']): ClinicalCase {
  const p = legacy(caseId);
  const requirements = CURATION_REQUIREMENTS[caseId as keyof typeof CURATION_REQUIREMENTS];
  if (!requirements) throw new Error(`Curated case ${caseId} has no workbook rebuild requirements`);
  const referenceId = PRIMARY_REFERENCE_BY_CASE_ID[caseId];
  if (!referenceId) throw new Error(`Curated case ${caseId} has no primary reference target`);
  const objectivePrefix = `${caseId}-o`;
  const diagnosisOptions = [...p.diagnosisOptions];
  if (!diagnosisOptions.includes(p.correctDiagnosisId)) diagnosisOptions.unshift(p.correctDiagnosisId);
  const five = [...new Set(diagnosisOptions)].slice(0, 5);
  if (five.length !== 5) throw new Error(`Curated case ${caseId} requires exactly five diagnosis options`);
  const urgent = timeCriticalSet.has(caseId) || p.severity !== 'stable';
  const verifiedSafetyAction = caseId === 'uro-006'
    ? 'Immediate surgical/urology assessment; diagnostic imaging must not delay definitive assessment.'
    : caseId === 'obgyn-002'
      ? 'Transfer directly for emergency early-pregnancy/gynaecology assessment when unstable or pain/bleeding is concerning.'
      : caseId === 'ent-010'
        ? 'Immediate ENT or emergency referral, to be seen within 24 hours for recent sudden unexplained hearing loss.'
        : urgent
          ? 'Escalate immediately or the same day when modeled deterioration or specialty red flags are present.'
          : 'Arrange urgent assessment if red flags, rapid deterioration, or inability to manage safely as an outpatient develops.';
  const safetyAction = `${requirements.safetyEscalationRequirement} ${verifiedSafetyAction}`;
  const rubric = [
    rubricCriterion(`${caseId}-r1`, 'history', 'Elicits the onset, chronology, severity, functional effect, and relevant contextual risks.', [`${objectivePrefix}1`], [referenceId], 20),
    rubricCriterion(`${caseId}-r2`, 'history', 'Checks pertinent negatives and condition-specific red flags before narrowing the differential.', [`${objectivePrefix}1`, `${objectivePrefix}4`], [referenceId], 15, true),
    rubricCriterion(`${caseId}-r3`, 'examination', 'Performs and interprets a focused examination, including the recorded vital signs.', [`${objectivePrefix}2`], [referenceId], 15),
    rubricCriterion(`${caseId}-r4`, 'investigation', 'Selects proportionate investigations and distinguishes available, not-modeled, and not-indicated results.', [`${objectivePrefix}2`], [referenceId], 15),
    rubricCriterion(`${caseId}-r5`, 'diagnosis', 'Chooses the single best diagnosis and explains evidence for and against plausible alternatives.', [`${objectivePrefix}3`], [referenceId], 15),
    rubricCriterion(`${caseId}-r6`, 'patient-safety', 'States a safe outpatient disposition, explicit escalation threshold, and follow-up safety net.', [`${objectivePrefix}4`], [referenceId], 20, true),
  ];
  const result = baseFromLegacy(caseId, `Assessment of ${p.chiefComplaint.replace(/[.!?]+$/, '').toLowerCase()}`, '1.1.0', [referenceId]);
  return {
    ...result,
    curationRequirements: {
      diagnosisConcept: requirements.diagnosisConcept,
      requiredClinicalCorrection: requirements.requiredClinicalCorrection,
      safetyEscalationRequirement: requirements.safetyEscalationRequirement,
      sourceKind: 'user-supplied-curation-workbook',
    },
    specialtyId,
    reviewStatus: 'source-verified-formative',
    learningObjectives: [
      { objectiveId: `${objectivePrefix}1`, description: 'Gather a focused, chronological history and identify safety-relevant negatives and risk modifiers.' },
      { objectiveId: `${objectivePrefix}2`, description: 'Use focused examination and proportionate investigations without inventing unmodeled results.' },
      { objectiveId: `${objectivePrefix}3`, description: 'Compare five plausible diagnoses and select one best answer from modeled evidence.' },
      { objectiveId: `${objectivePrefix}4`, description: 'Create a safe outpatient plan with explicit escalation, follow-up, and communication.' },
    ],
    physicalExamination: [
      { findingId: 'general-appearance', description: p.arrivalBlurb },
      { findingId: 'focused-examination', description: 'Focused system examination is required; only findings explicitly returned by the simulation may be treated as observed.' },
    ],
    investigations: buildCaseInvestigations({
      caseId, caseVersion: '1.1.0', tests: p.testResults,
      differentials: five.map((diagnosisId) => ({ diagnosisId, label: label(diagnosisId), isCorrect: diagnosisId === p.correctDiagnosisId, rationale: '', supportingFindings: [], findingsAgainst: [] })),
      rubricCriterionId: `${caseId}-r4`, referenceId, timeCritical: urgent,
    }),
    differentialDiagnoses: five.map((diagnosisId) => ({
      diagnosisId,
      label: label(diagnosisId),
      isCorrect: diagnosisId === p.correctDiagnosisId,
      rationale: diagnosisId === p.correctDiagnosisId
        ? 'This is the best fit for the modeled history, examination context, and available investigation pattern.'
        : 'This remains a plausible alternative, but the complete modeled pattern is less supportive than for the best answer.',
      supportingFindings: p.anamnesis.filter((q) => q.relevant).slice(0, 2).map((q) => q.answer),
      findingsAgainst: diagnosisId === p.correctDiagnosisId ? [] : ['The overall modeled pattern is less consistent than the designated one-best answer.'],
    })),
    managementPlan: {
      summary: `${requirements.requiredClinicalCorrection} Use the cited source pathway, patient preferences, and local services to agree a proportionate outpatient plan; exact prescribing is outside scored content.`,
      nonPharmacological: ['Explain the working diagnosis and uncertainty', 'Agree condition-appropriate self-care and follow-up'],
      referral: [safetyAction],
    },
    medicationExpectations: [],
    contraindications: [{ description: 'Do not score or infer exact medicines or doses until current BNF, product information, contraindications, interactions, monitoring, and local policy are verified.', referenceIds: [referenceId] }],
    redFlags: [{ description: requirements.safetyEscalationRequirement, action: safetyAction, referenceIds: [referenceId] }],
    referralCriteria: [{ criterion: urgent ? 'Time-critical presentation or unsafe outpatient stability' : 'Red flags, diagnostic uncertainty with safety concern, or failed outpatient management', action: safetyAction, referenceIds: [referenceId] }],
    safetyNetting: [{ instruction: `${safetyAction} Give the learner/patient a clear timeframe and route for reassessment.`, referenceIds: [referenceId] }],
    assessmentRubric: { rubricVersion: '1.1.0', criteria: rubric },
    rubricVersion: '1.1.0', referenceSetVersion: '1.1.0',
    criticalFailureRules: [
      { ruleId: `${caseId}-cf1`, trigger: 'Fails to identify or act on the case safety/escalation requirement.', consequence: urgent ? 'fail' : 'score-cap', referenceIds: [referenceId] },
      ...(urgent ? [{ ruleId: `${caseId}-cf-investigation-delay`, trigger: 'Orders or waits for a non-essential investigation in a way that delays immediate stabilization or specialty escalation.', consequence: 'fail' as const, referenceIds: [referenceId] }] : []),
    ],
    evidenceMappings: ['curationRequirements.requiredClinicalCorrection', 'curationRequirements.safetyEscalationRequirement', 'correctDiagnosis', 'investigations', 'managementPlan', 'redFlags', 'referralCriteria', 'assessmentRubric'].map((fieldPath) => ({ fieldPath, referenceId, jurisdiction: 'United Kingdom-first', accessedAt: '2026-09-10', verificationMethod: 'workbook-source-target' as const })),
    reviewRecord: {
      ...PENDING_REVIEW,
      reviewStatus: 'source-verified-formative',
      checklist: { ...PENDING_REVIEW.checklist, referencesVerified: 'accepted' },
      unresolvedComments: [{ commentId: 'human-clinical-review-required', area: 'clinical governance', comment: 'Source-backed formative rebuild completed; independent clinician sign-off and exact recommendation reconciliation remain outstanding.', critical: true }],
      approvalStatement: 'Source-backed formative use only. No medical approval or clinical accreditation is claimed.',
    },
    variantPolicy: { allowedDisplayNames: [p.name], ageRange: { min: p.age, max: p.age }, allowedComplaintPhrasings: [p.chiefComplaint], difficultyOptions: ['intermediate'] },
    changeSummary: 'Version 1.1.0 rebuild for the 72-case curated bank: explicit provenance, availability states, 100-point deterministic rubric, safety gates, and non-scoreable medication policy.',
  };
}

export const CLINICAL_CASES: ClinicalCase[] = Object.entries(CURATED_CASE_IDS_BY_SPECIALTY)
  .flatMap(([specialtyId, ids]) => ids.map((caseId) => rebuiltCase(caseId, specialtyId as ClinicalCase['specialtyId'])));
export const CLINICAL_CASE_BY_ID = new Map(CLINICAL_CASES.map((c) => [c.caseId, c]));

/** Server-manifest build helper. Never use this object as a browser DTO. */
export function getServerPatientSource(caseId: string): PatientCase | undefined {
  return LEGACY_BY_ID.get(caseId);
}

export function reviewStatusForCase(caseId: string): ClinicalCase['reviewStatus'] | 'legacy-unreviewed' {
  return CLINICAL_CASE_BY_ID.get(caseId)?.reviewStatus ?? 'legacy-unreviewed';
}

export function caseVersionFor(caseId: string): string {
  return CLINICAL_CASE_BY_ID.get(caseId)?.caseVersion ?? 'legacy-1';
}

export function isAssignableCase(caseId: string, mode: 'curated' | 'development'): boolean {
  const status = reviewStatusForCase(caseId);
  if (mode === 'curated') return isCuratedCaseId(caseId) && status === 'source-verified-formative';
  return isCuratedCaseId(caseId) && status !== 'retired';
}

export function toSafeCaseSummary(c: ClinicalCase): SafeCaseSummary {
  return { caseId: c.caseId, caseVersion: c.caseVersion, specialtyId: c.specialtyId, displayName: c.patientProfile.displayName, age: c.patientProfile.age, gender: c.patientProfile.gender, publicComplaint: c.presentingComplaint.publicSummary, difficulty: c.difficulty, learnerLevel: c.targetLearnerLevel, reviewStatus: c.reviewStatus };
}

export function toSafeEncounterCase(c: ClinicalCase): SafeEncounterCase {
  return { ...toSafeCaseSummary(c), arrivalBlurb: c.presentingComplaint.fullClinicalDescription, vitalSigns: c.vitalSigns, availableQuestionIds: c.history.map((h) => h.itemId), investigations: c.investigations.map(({ testId, name, category, role, availability, reason, turnaroundSec, prerequisite }) => ({ testId, name, category, role, availability, reason, turnaroundSec, prerequisite })), diagnosisOptions: c.differentialDiagnoses.map(({ diagnosisId, label: diagnosisLabel }) => ({ diagnosisId, label: diagnosisLabel })) };
}

export function toPostSubmissionReview(c: ClinicalCase): PostSubmissionReview {
  return { caseId: c.caseId, caseVersion: c.caseVersion, rubricVersion: c.rubricVersion, correctDiagnosis: c.correctDiagnosis, differentialDiagnoses: c.differentialDiagnoses, assessmentRubric: c.assessmentRubric, references: c.references.map((id) => CLINICAL_REFERENCE_BY_ID.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)) };
}
