import type { ClinicId } from '../game/clinic';

export const CASE_REVIEW_STATUSES = [
  'legacy-unreviewed',
  'draft',
  'technical-review',
  'clinical-review',
  'revision-required',
  'source-verified-formative',
  'approved-formative',
  'retired',
] as const;

export type CaseReviewStatus = (typeof CASE_REVIEW_STATUSES)[number];
export type TrainingMode = 'curated' | 'development';
export type LearnerLevel = 'undergraduate-clinical-years' | 'recent-graduate';
export type ReviewDecision = 'not-reviewed' | 'accepted' | 'revision-required' | 'not-applicable';
export const INVESTIGATION_CATEGORIES = [
  'bedside', 'laboratory', 'microbiology', 'pathology', 'physiological',
  'cardiac', 'imaging', 'endoscopy', 'specialist-procedure',
] as const;
export type InvestigationCategory = (typeof INVESTIGATION_CATEGORIES)[number];
export type InvestigationRole = 'essential' | 'useful' | 'conditional' | 'optional' | 'not-indicated' | 'potentially-harmful';
export type InvestigationAvailability = 'available-if-ordered' | 'result-available' | 'conditional' | 'not-modeled' | 'not-indicated';
export type InvestigationAbnormality = 'low' | 'normal' | 'high' | 'positive' | 'negative' | 'indeterminate' | 'abnormal';

export interface InvestigationNumericValue {
  kind: 'numeric'; value: number; unit: string; referenceRange?: { low?: number; high?: number; text?: string };
  abnormality: InvestigationAbnormality;
}
export interface InvestigationPanelComponent {
  analyteId: string; label: string; value: number | string; unit?: string;
  referenceRange?: { low?: number; high?: number; text?: string };
  abnormality: InvestigationAbnormality;
}
export type InvestigationResult =
  | InvestigationNumericValue
  | { kind: 'panel'; components: InvestigationPanelComponent[]; summary?: string }
  | { kind: 'report'; report: string; impression?: string; abnormality: InvestigationAbnormality }
  | { kind: 'score'; score: number; scale: string; interpretation: string; abnormality: InvestigationAbnormality }
  | { kind: 'image'; report: string; assetId?: string; caption?: string; license?: string; abnormality: InvestigationAbnormality };

export interface ClinicalReference {
  referenceId: string;
  organization: string;
  title: string;
  publicationYear: number;
  version?: string;
  region: string;
  sourceType:
    | 'clinical-practice-guideline'
    | 'consensus-statement'
    | 'systematic-review'
    | 'official-curriculum'
    | 'regulatory-guidance';
  url: string;
  doi?: string;
  pubmedId?: string;
  section?: string;
  recommendationId?: string;
  page?: string;
  accessedAt: string;
  verificationStatus: 'unverified' | 'source-verified' | 'clinician-verified' | 'superseded';
  supersededBy?: string;
  notes?: string;
}

export interface ReviewerIdentity {
  reviewerId: string;
  role: string;
  specialty?: string;
  institution?: string;
  reviewedAt: string;
}

export interface ReviewComment {
  commentId: string;
  area: string;
  comment: string;
  critical: boolean;
  resolvedAt?: string;
}

export interface CaseReviewRecord {
  authoredBy?: ReviewerIdentity;
  clinicalReviewers: ReviewerIdentity[];
  educationalReviewer?: ReviewerIdentity;
  authoredAt?: string;
  lastReviewedAt?: string;
  nextReviewDueAt?: string;
  reviewStatus: CaseReviewStatus;
  checklist: Record<
    | 'diagnosisAccurate'
    | 'historyInternallyConsistent'
    | 'examinationConsistent'
    | 'investigationsAppropriate'
    | 'differentialDiagnosesPlausible'
    | 'managementAppropriate'
    | 'medicationDetailsAppropriate'
    | 'safetyAndReferralAppropriate'
    | 'referencesVerified'
    | 'learnerLevelAppropriate'
    | 'rubricObservableAndFair',
    ReviewDecision
  >;
  unresolvedComments: ReviewComment[];
  approvalStatement?: string;
}

export interface LearningObjective {
  objectiveId: string;
  description: string;
}

export interface DifferentialDiagnosis {
  diagnosisId: string;
  label: string;
  isCorrect: boolean;
  rationale: string;
  supportingFindings: string[];
  findingsAgainst: string[];
}

export interface CaseInvestigation {
  testId: string;
  name: string;
  category: InvestigationCategory;
  role: InvestigationRole;
  reason: string;
  availability: InvestigationAvailability;
  /** @deprecated Kept for review-workbook compatibility; use role. */
  classification: 'essential' | 'useful' | 'unnecessary' | 'potentially-harmful';
  structuredResult?: InvestigationResult;
  /** @deprecated Human-readable projection of structuredResult. */
  result: string;
  abnormal: boolean;
  units?: string;
  referenceRange?: string;
  variabilityNotes?: string;
  turnaroundSec: number;
  prerequisite?: string;
  learnerSafeSummary: string;
  postSubmissionExplanation: string;
  supportsDiagnosisIds: string[];
  arguesAgainstDiagnosisIds: string[];
  limitations: string[];
  verificationStatus: 'source-verified' | 'unresolved';
  scoreable: boolean;
  rubricCriterionIds: string[];
  referenceIds: string[];
}

export interface MedicationExpectation {
  medicationId: string;
  genericName: string;
  indication: string;
  dose: string;
  unit: string;
  route: string;
  frequency: string;
  duration: string;
  contraindications: string[];
  allergies: string[];
  renalAdjustment: string;
  hepaticAdjustment: string;
  pregnancyOrAgeRestrictions: string;
  monitoring: string[];
  acceptableAlternatives: string[];
  referenceIds: string[];
}

export interface ClinicalRubricCriterion {
  criterionId: string;
  domain:
    | 'history'
    | 'examination'
    | 'investigation'
    | 'clinical-reasoning'
    | 'diagnosis'
    | 'management'
    | 'communication'
    | 'patient-safety';
  description: string;
  observableEvidence: string[];
  weight: number;
  isCritical: boolean;
  failureConsequence?: string;
  learningObjectiveIds: string[];
  referenceIds: string[];
}

export interface ControlledVariantPolicy {
  allowedDisplayNames: string[];
  ageRange: { min: number; max: number };
  allowedComplaintPhrasings: string[];
  difficultyOptions: Array<'introductory' | 'intermediate' | 'advanced'>;
}

export interface ClinicalCase {
  schemaVersion: '1.0.0';
  caseId: string;
  caseVersion: string;
  rubricVersion: string;
  referenceSetVersion: string;
  title: string;
  specialtyId: ClinicId;
  targetLearnerLevel: LearnerLevel;
  difficulty: 'introductory' | 'intermediate' | 'advanced';
  reviewStatus: CaseReviewStatus;
  clinicalRegion: string;
  language: 'en';
  intendedUse: 'formative-only';
  curationRequirements?: {
    diagnosisConcept: string;
    requiredClinicalCorrection: string;
    safetyEscalationRequirement: string;
    sourceKind: 'user-supplied-curation-workbook';
  };
  approvalBasis: 'source-only' | 'human-clinical-review';
  clinicalSetting: 'outpatient-clinic';
  chronology: string[];
  pertinentNegatives: string[];
  riskModifiers: string[];
  learningObjectives: LearningObjective[];
  patientProfile: { displayName: string; age: number; gender: 'M' | 'F'; syntheticComposite: true };
  presentingComplaint: { publicSummary: string; fullClinicalDescription: string };
  history: Array<{ itemId: string; question: string; answer: string }>;
  physicalExamination: Array<{ findingId: string; description: string }>;
  vitalSigns: {
    hr: number; hrUnit: 'beats/min'; bp: string; bpUnit: 'mmHg';
    spo2: number; spo2Unit: '%'; temp: number; tempUnit: '°C'; rr: number; rrUnit: 'breaths/min';
  };
  investigations: CaseInvestigation[];
  imaging: Array<{ testId: string; interpretation: string; sourceKind: 'case-specific-simulation' | 'educational-reference'; attribution?: string; license?: string }>;
  differentialDiagnoses: DifferentialDiagnosis[];
  correctDiagnosis: { diagnosisId: string; label: string };
  managementPlan: { summary: string; nonPharmacological: string[]; referral: string[] };
  medicationExpectations: MedicationExpectation[];
  medicationScoring: { enabled: boolean; reason: string; verificationRequired: 'BNF-and-local-formulary' };
  contraindications: Array<{ description: string; referenceIds: string[] }>;
  redFlags: Array<{ description: string; action: string; referenceIds: string[] }>;
  referralCriteria: Array<{ criterion: string; action: string; referenceIds: string[] }>;
  safetyNetting: Array<{ instruction: string; referenceIds: string[] }>;
  assessmentRubric: { rubricVersion: string; criteria: ClinicalRubricCriterion[] };
  criticalFailureRules: Array<{ ruleId: string; trigger: string; consequence: 'fail' | 'score-cap'; referenceIds: string[] }>;
  evidenceMappings: Array<{
    fieldPath: string; referenceId: string; jurisdiction: string; accessedAt: string;
    verificationMethod: 'publisher-page-reviewed' | 'workbook-source-target';
  }>;
  references: string[];
  reviewRecord: CaseReviewRecord;
  variantPolicy?: ControlledVariantPolicy;
  changeSummary: string;
}

export interface SafeCaseSummary {
  caseId: string;
  caseVersion: string;
  specialtyId: ClinicId;
  displayName: string;
  age: number;
  gender: 'M' | 'F';
  publicComplaint: string;
  difficulty: ClinicalCase['difficulty'];
  learnerLevel: LearnerLevel;
  reviewStatus: CaseReviewStatus;
}

export interface SafeEncounterCase extends SafeCaseSummary {
  arrivalBlurb: string;
  vitalSigns: ClinicalCase['vitalSigns'];
  availableQuestionIds: string[];
  investigations: Array<Pick<CaseInvestigation, 'testId' | 'name' | 'category' | 'role' | 'availability' | 'reason' | 'turnaroundSec' | 'prerequisite'>>;
  diagnosisOptions: Array<{ diagnosisId: string; label: string }>;
}

export interface PostSubmissionReview {
  caseId: string;
  caseVersion: string;
  rubricVersion: string;
  correctDiagnosis: ClinicalCase['correctDiagnosis'];
  differentialDiagnoses: DifferentialDiagnosis[];
  assessmentRubric: ClinicalCase['assessmentRubric'];
  references: ClinicalReference[];
}
