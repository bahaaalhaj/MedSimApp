import type { ActivePatient, LearnerPatientCase } from './types.ts';

export interface RecoveryView {
  attemptId: string; caseId: string; caseVersion: string; variantSeed: string; clientAttemptId: string;
  createdAt: number; expiresAt: number;
  patientProfile: { displayName: string; age: number; chiefComplaint: string };
  transcript: Array<{ role: 'patient' | 'trainee'; content: string; timestampIso: string; questionSource: 'typed' | 'predefined' | null }>;
  visibleAnswers: Record<string, { answer: string; relevant: boolean }>;
  askedQuestionIds: string[];
  examinations: ActivePatient['examinationActions']; prescriptions: NonNullable<ActivePatient['prescriptions']>;
  submittedDiagnosisId: string | null;
  completionChecks: { summaryCompleted: boolean; safetyNettingCompleted: boolean; ideasConcernsExpectationsCompleted: boolean } | null;
  investigations: ActivePatient['investigationCatalogue']; orders: ActivePatient['investigationOrders'];
  evaluationActive: boolean; evaluationResult: unknown;
  encounterTiming?: { startedAtMs: number; finishedAtMs: number } | null;
}
export async function recoverAttempt(attemptId: string, signal?: AbortSignal): Promise<RecoveryView> {
  const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/recovery`, {
    credentials: 'include', signal, headers: { 'x-request-id': crypto.randomUUID() },
  });
  if (!response.ok) throw new Error(response.status === 404
    ? 'This encounter is unavailable: it may have expired, the server may have restarted, or it belongs to another session. Your saved history is separate.'
    : `Encounter recovery failed (${response.status}). Check your connection and retry.`);
  return response.json();
}
export function restorePatient(view: RecoveryView, base: ActivePatient, clinicalCase: LearnerPatientCase): ActivePatient {
  if (view.caseId !== clinicalCase.id || view.caseVersion !== base.caseVersion) throw new Error('This encounter uses an unavailable case version. Open saved history or select a new case.');
  const checks = view.completionChecks;
  return { ...base, case: { ...clinicalCase, name: view.patientProfile.displayName, age: view.patientProfile.age,
    chiefComplaint: view.patientProfile.chiefComplaint,
    anamnesis: clinicalCase.anamnesis.map((row) => ({ ...row, ...view.visibleAnswers[row.id] })) },
    investigationAttemptId: view.attemptId, investigationAttemptStatus: 'ready',
    encounterAttemptId: view.clientAttemptId || view.attemptId, variantSeed: view.variantSeed,
    arrivedAt: view.createdAt * 1000,
    consultationStartedAt: view.encounterTiming?.startedAtMs ?? view.createdAt * 1000,
    consultationFinishedAt: view.encounterTiming?.finishedAtMs ?? null,
    transcript: view.transcript.map((row, index) => ({ ...row, id: `recovered-${view.attemptId}-${index}`,
      timestampIso: new Date(Number(row.timestampIso) * 1000 || row.timestampIso).toISOString(),
      caseId: view.caseId, caseVersion: view.caseVersion, attemptId: view.attemptId })),
    askedQuestionIds: view.askedQuestionIds, examinationActions: view.examinations,
    prescriptions: view.prescriptions, submittedDiagnosisId: view.submittedDiagnosisId,
    investigationCatalogue: view.investigations, investigationOrders: view.orders,
    orderedTestIds: view.orders.map((row) => row.investigationId),
    completedTestIds: view.orders.filter((row) => row.resultSnapshot).map((row) => row.investigationId),
    testOrderedAt: Object.fromEntries(view.orders.map((row) => [row.investigationId, row.orderedAt * 1000])),
    encounterChecks: checks ? { sum: checks.summaryCompleted, safe: checks.safetyNettingCompleted, ice: checks.ideasConcernsExpectationsCompleted } : undefined,
  };
}
