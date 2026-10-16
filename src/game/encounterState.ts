import type { ActivePatient, EndConfirmChecks } from './types';
import { finishConsultationTiming } from './consultationTiming.ts';

export function encounterKey(patient: ActivePatient): string {
  return `${patient.case.id}\u0000${patient.caseVersion}\u0000${patient.variantSeed}`;
}

export function isSameEncounter(current: ActivePatient, expected: ActivePatient): boolean {
  return encounterKey(current) === encounterKey(expected);
}

export function hasEncounterActivity(patient: ActivePatient): boolean {
  return patient.askedQuestionIds.length > 0
    || patient.transcript.some((entry) => entry.role === 'trainee')
    || patient.examinationActions.length > 0
    || patient.orderedTestIds.length > 0
    || patient.givenTreatmentIds.length > 0
    || (patient.prescriptions?.length ?? 0) > 0
    || patient.submittedDiagnosisId !== null;
}

export function completeEncounter(patient: ActivePatient, checks: EndConfirmChecks, previousSnapshot: ActivePatient | null, endedAt = Date.now()): ActivePatient | null {
  const snapshot = { ...finishConsultationTiming(patient, endedAt), encounterChecks: { ...checks } };
  return hasEncounterActivity(snapshot) ? snapshot : previousSnapshot;
}
