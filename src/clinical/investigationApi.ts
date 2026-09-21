import type { ActivePatient } from '../game/types.ts';

type Catalogue = ActivePatient['investigationCatalogue'];
export type AttemptOrder = ActivePatient['investigationOrders'][number];

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function createInvestigationAttempt(
  caseId: string,
  caseVersion: string,
  variantSeed: string,
  clientAttemptId: string,
  patientProfile: { displayName: string; age: number; chiefComplaint: string },
): Promise<{ attemptId: string; investigations: Catalogue; openingGreeting: string; evidenceVersion: 2 }> {
  return parse(await fetch('/api/attempts', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId, caseVersion, variantSeed, clientAttemptId, patientProfile, evidenceVersion: 2 }),
  }));
}

export async function orderInvestigation(attemptId: string, investigationId: string, indication = ''): Promise<AttemptOrder> {
  return parse(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/investigations/orders`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ investigationId, indication }),
  }));
}

export async function getInvestigationResult(attemptId: string, orderId: string): Promise<AttemptOrder> {
  return parse(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/investigations/${encodeURIComponent(orderId)}`, { credentials: 'include' }));
}

export async function recordExamination(attemptId: string, actionId: string, performedAt: number) {
  return parse<{ actionId: string; performedAt: number; attemptId: string }>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/examinations`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actionId, performedAt }),
  }));
}

export async function submitDiagnosis(attemptId: string, diagnosisId: string) {
  return parse<{ submittedDiagnosisId: string; correctDiagnosisId: string; diagnosisWasCorrect: boolean }>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/diagnosis`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ diagnosisId }),
  }));
}

export async function recordPrescription(attemptId: string, prescription: { medicationId: string; dose: string; duration: string; prescribedAt: number }) {
  return parse<typeof prescription>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/prescriptions`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prescription),
  }));
}

export async function recordCompletion(attemptId: string, completion: { summaryCompleted: boolean; safetyNettingCompleted: boolean; ideasConcernsExpectationsCompleted: boolean }) {
  return parse<typeof completion>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/completion`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(completion),
  }));
}
