import type { ActivePatient, EncounterTranscriptEntry } from './types';

export function appendTranscript(patient: ActivePatient, entry: EncounterTranscriptEntry): ActivePatient {
  if (patient.case.id !== entry.caseId || patient.transcript.some((item) => item.id === entry.id)) return patient;
  return { ...patient, transcript: [...patient.transcript, entry] };
}

export function bindEvidenceToAttempt(patient: ActivePatient, attemptId: string): ActivePatient {
  return {
    ...patient,
    transcript: patient.transcript.map((entry) => ({ ...entry, attemptId })),
    examinationActions: patient.examinationActions.map((entry) => ({ ...entry, attemptId })),
  };
}
