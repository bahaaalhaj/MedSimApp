import type { PaletteName } from '../styles/palettes';
import type { ClinicId } from './clinic';
import type { CaseReviewStatus, TrainingMode } from '../clinical/types';
import type { InvestigationAvailability, InvestigationCategory, InvestigationResult, InvestigationRole } from '../clinical/types';

// ── MedSim cozy-cartoon UI state ──────────────────────────

export type Screen =
  | 'splash'
  | 'onboarding'
  | 'auth'
  | 'home'
  | 'gpRoom'
  | 'library'
  | 'brief'
  | 'encounter'
  | 'endConfirm'
  | 'debrief'
  | 'history'
  | 'agenticRounds'
  | 'agentTopology';

export type AvatarStyle = 'cute' | 'portrait' | 'animal' | 'initials';
export type RoomLayout = 'side' | 'front';

export interface Tweaks {
  palette: PaletteName;
  avatarStyle: AvatarStyle;
  intensity: number;
  roomLayout: RoomLayout;
}

export interface EndConfirmChecks {
  sum: boolean;
  safe: boolean;
  ice: boolean;
}

// ── medsim types — load-bearing for the 3D scene + voice agent ──
//
// These are the shapes the 3D scene and patient-audio panel
// and `voice/*` modules expect.

export type Severity = 'critical' | 'urgent' | 'stable';

export interface AnamnesisQA {
  id: string;
  question: string;
  answer: string;
  relevant: boolean;
}

export interface TestResult {
  testId: string;
  result: string;
  abnormal: boolean;
}

export interface PatientCase {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F';
  severity: Severity;
  arrivalBlurb: string;
  chiefComplaint: string;
  vitals: {
    hr: number;
    bp: string;
    spo2: number;
    temp: number;
    rr: number;
  };
  anamnesis: AnamnesisQA[];
  testResults: TestResult[];
  correctDiagnosisId: string;
  acceptableTreatmentIds: string[];
  criticalTreatmentIds: string[];
  diagnosisOptions: string[];
  rubric?: CaseRubric;
}

// ── OSCE rubric — grades a completed encounter ────────────────────────
//
// The `medsim-attending` Managed Agent reads this rubric at debrief time and
// emits one `render_case_evaluation` tool call. Every clinical_management
// criterion's `guideline_ref` MUST resolve in `src/data/guidelines.ts` —
// the agent is instructed to drop a criterion rather than fabricate a
// citation. Cases without a `rubric` field fall back to an auto-derived
// rubric built from `correctDiagnosisId` + `criticalTreatmentIds`.

export type RubricFramework =
  | 'PLAB2'
  | 'RCGP'
  | 'NURSE'
  | 'SEGUE'
  | 'ICE'
  | 'SOCRATES'
  | 'OS-12';

export type RubricDomain =
  | 'data_gathering'
  | 'clinical_management'
  | 'interpersonal';

export interface RubricCriterion {
  /** Stable id, unique within the rubric. e.g. "dg-01", "cm-03". */
  criterion_id: string;
  /** Short label shown in the marking sheet UI. */
  label: string;
  /** Relative weight, 1–3. Drives the domain score. */
  weight: number;
  framework?: RubricFramework;
  /** Reference into the guideline registry. Format: "guideline_id:rec_id".
   *  REQUIRED for every clinical_management criterion. Optional elsewhere. */
  guideline_ref?: string;
  /** What counts as "met" — specific enough that the agent can quote the
   *  transcript or name the action that did/didn't satisfy it. */
  evidence: string;
}

export interface SafetyNetCriterion {
  required_elements: string[];
  weight: number;
  guideline_ref?: string;
}

export interface CaseRubric {
  data_gathering: RubricCriterion[];
  clinical_management: RubricCriterion[];
  interpersonal: RubricCriterion[];
  safety_netting?: SafetyNetCriterion;
  /** "borderline-regression" = holistic global rating in addition to the
   *  weighted sum. Always set; reserved for future strict scoring modes. */
  global_rating: 'borderline-regression';
}

// ── Catalogue types (tests, treatments, diagnoses) — used by data/* ──

export interface Test {
  id: string;
  name: string;
  category: 'lab' | 'imaging' | 'bedside';
  turnaroundSec: number;
}

export interface Treatment {
  id: string;
  name: string;
  category: 'medication' | 'procedure' | 'disposition';
}

export interface Diagnosis {
  id: string;
  name: string;
}

export type PatientStatus =
  | 'waiting'
  | 'in-bed'
  | 'examining'
  | 'awaiting-results'
  | 'ready-to-diagnose'
  | 'treating'
  | 'discharged'
  | 'deceased';

export interface EncounterTranscriptEntry {
  id: string;
  role: 'trainee' | 'patient';
  content: string;
  timestampIso: string;
  questionSource: 'typed' | 'predefined' | null;
  caseId: string;
  caseVersion: string;
  attemptId: string;
}

export interface ActivePatient {
  case: PatientCase;
  bedIndex: number;
  status: PatientStatus;
  askedQuestionIds: string[];
  transcript: EncounterTranscriptEntry[];
  encounterAttemptId: string;
  orderedTestIds: string[];
  testOrderedAt: Record<string, number>;
  completedTestIds: string[];
  investigationAttemptId: string | null;
  investigationAttemptStatus: 'initializing' | 'ready' | 'error';
  investigationCatalogue: Array<{
    testId: string; name: string; category: InvestigationCategory; role: InvestigationRole;
    availability: InvestigationAvailability; reason: string; turnaroundSec: number; prerequisite?: string;
  }>;
  investigationOrders: Array<{
    orderId: string; investigationId: string; orderedAt: number; availableAt: number;
    status: 'pending' | 'available' | 'unavailable' | 'error'; indication: string;
    statusDetail?: string | null;
    resultSnapshot?: {
      investigationId: string; name: string; category: InvestigationCategory;
      structuredResult?: InvestigationResult; resultText: string; abnormal: boolean | null;
      verificationStatus: 'source-verified' | 'unresolved'; scoreable: boolean;
    };
  }>;
  givenTreatmentIds: string[];
  submittedDiagnosisId: string | null;
  arrivedAt: number;
  deadlineMs: number;
  /** Immutable provenance captured when the encounter starts. */
  caseVersion: string;
  rubricVersion: string;
  variantSeed: string;
  encounterChecks?: EndConfirmChecks;
  prescriptions?: Array<{
    medicationId: string;
    dose: string;
    duration: string;
    prescribedAt: number;
  }>;
}

export interface PolyclinicSlice {
  clinic: ClinicId;
  patient: ActivePatient | null;
}

// ── Combined game state ──
export interface GameState {
  screen: Screen;
  tweaks: Tweaks;
  onboardingStep: number;
  endConfirm: EndConfirmChecks;
  selectedCaseId: string;
  /** Curated is the safe default. Development explicitly exposes pending and legacy cases. */
  trainingMode: TrainingMode;
  hasOnboarded: boolean;
  /** Polyclinic 3D scene needs this slice. Shape consumed by `Polyclinic`
   *  and `FloatingPatientAudioPanel`. */
  polyclinic: PolyclinicSlice;
  /** Snapshot of the most recently completed encounter, taken at the moment
   *  the patient walks out (see `Store.finishPolyclinicCase`). DebriefScreen
   *  reads this so the grading agent still has the full action log even
   *  though `polyclinic.patient` has been cleared for the walk-out animation. */
  lastEncounter: ActivePatient | null;
  /** When set, DebriefScreen renders the saved evaluation with this id from
   *  `evalHistory` storage instead of running the agent against a live
   *  encounter. Cleared when the user navigates away. */
  viewedEvalHistoryId: string | null;
}

export interface CaseGovernanceSummary {
  reviewStatus: CaseReviewStatus;
  caseVersion: string;
  rubricVersion: string;
}
