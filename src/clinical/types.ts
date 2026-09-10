import type { ClinicId } from '../game/clinic';

export const CASE_REVIEW_STATUSES = [
  'legacy-unreviewed',
  'draft',
  'technical-review',
  'clinical-review',
  'revision-required',
  'approved-formative',
  'retired',
] as const;

export type CaseReviewStatus = (typeof CASE_REVIEW_STATUSES)[number];
export type TrainingMode = 'curated' | 'development';
export type LearnerLevel = 'undergraduate-clinical-years' | 'recent-graduate';
export type ReviewDecision = 'not-reviewed' | 'accepted' | 'revision-required' | 'not-applicable';

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
  reason: string;
  classification: 'essential' | 'useful' | 'unnecessary' | 'potentially-harmful';
  result: string;
  abnormal: boolean;
  units?: string;
  referenceRange?: string;
  variabilityNotes?: string;
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
  learningObjectives: LearningObjective[];
  patientProfile: { displayName: string; age: number; gender: 'M' | 'F'; syntheticComposite: true };
  presentingComplaint: { publicSummary: string; fullClinicalDescription: string };
  history: Array<{ itemId: string; question: string; answer: string }>;
  physicalExamination: Array<{ findingId: string; description: string }>;
  vitalSigns: { hr: number; bp: string; spo2: number; temp: number; rr: number };
  investigations: CaseInvestigation[];
  imaging: Array<{ testId: string; interpretation: string; sourceKind: 'case-specific-simulation' | 'educational-reference'; attribution?: string; license?: string }>;
  differentialDiagnoses: DifferentialDiagnosis[];
  correctDiagnosis: { diagnosisId: string; label: string };
  managementPlan: { summary: string; nonPharmacological: string[]; referral: string[] };
  medicationExpectations: MedicationExpectation[];
  contraindications: Array<{ description: string; referenceIds: string[] }>;
  redFlags: Array<{ description: string; action: string; referenceIds: string[] }>;
  referralCriteria: Array<{ criterion: string; action: string; referenceIds: string[] }>;
  safetyNetting: Array<{ instruction: string; referenceIds: string[] }>;
  assessmentRubric: { rubricVersion: string; criteria: ClinicalRubricCriterion[] };
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
  availableInvestigationIds: string[];
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
