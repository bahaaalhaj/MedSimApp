// Learner-owned encounter evidence. Clinical truth is restored by the backend
// from the owner-bound attempt rather than being serialized by the browser.

import type { ActivePatient, LearnerPatientCase } from '../game/types.ts';

export interface DebriefRequest {
  investigation_attempt_id: string | null;
  case_id: string;
  case_version: string;
  variant_seed: string;
  encounter_log: {
    examinations_performed: Array<{ action_id: string; performed_at: number }>;
    prescriptions: Array<{ medication_id: string; dose: string; duration: string; prescribed_at: number }>;
    submitted_diagnosis_id: string | null;
    safety_netting_checks: {
      summary_completed: boolean;
      safety_netting_completed: boolean;
      ideas_concerns_expectations_completed: boolean;
    } | null;
  };
}

export function buildDebriefRequest(
  c: LearnerPatientCase,
  patient: ActivePatient,
  _endedAt: number = Date.now(),
): DebriefRequest {
  return {
    investigation_attempt_id: patient.investigationAttemptId,
    case_id: c.id,
    case_version: patient.caseVersion,
    variant_seed: patient.variantSeed,
    encounter_log: {
      examinations_performed: patient.examinationActions.map((item) => ({
        action_id: item.actionId,
        performed_at: item.performedAt,
      })),
      prescriptions: (patient.prescriptions ?? []).map((item) => ({
        medication_id: item.medicationId,
        dose: item.dose,
        duration: item.duration,
        prescribed_at: item.prescribedAt,
      })),
      submitted_diagnosis_id: patient.submittedDiagnosisId,
      safety_netting_checks: patient.encounterChecks ? {
        summary_completed: patient.encounterChecks.sum,
        safety_netting_completed: patient.encounterChecks.safe,
        ideas_concerns_expectations_completed: patient.encounterChecks.ice,
      } : null,
    },
  };
}

export function summariseRequest(_request: DebriefRequest): {
  guideline_count: number;
  rec_count: number;
  criterion_count: number;
} {
  return { guideline_count: 0, rec_count: 0, criterion_count: 6 };
}
