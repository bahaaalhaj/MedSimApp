import type { ActivePatient } from '../game/types.ts';
import { runAttemptOperation } from './attemptQueue.ts';

type Catalogue = ActivePatient['investigationCatalogue'];
export type AttemptOrder = ActivePatient['investigationOrders'][number];

export class AttemptRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new AttemptRequestError((await response.json().catch(() => null))?.detail ?? `Request failed (${response.status})`, response.status);
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
    body: JSON.stringify({ caseId, caseVersion, variantSeed, clientAttemptId, patientProfile, evidenceVersion: 2, dialogueDeliveryVersion: 1 }),
  }));
}

export async function orderInvestigation(attemptId: string, investigationId: string, indication = ''): Promise<AttemptOrder> {
  return runAttemptOperation(attemptId, async () => parse<AttemptOrder>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/investigations/orders`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ investigationId, indication }),
  })));
}

export async function getInvestigationResult(attemptId: string, orderId: string, signal?: AbortSignal): Promise<AttemptOrder> {
  return runAttemptOperation(attemptId, async () => parse<AttemptOrder>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/investigations/${encodeURIComponent(orderId)}`, { credentials: 'include', signal })), signal);
}

export async function recordExamination(attemptId: string, actionId: string, performedAt: number, signal?: AbortSignal) {
  return runAttemptOperation(attemptId, async () => parse<{ actionId: string; performedAt: number; attemptId: string }>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/examinations`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actionId, performedAt }), signal,
  })), signal);
}

export async function submitDiagnosis(attemptId: string, diagnosisId: string, signal?: AbortSignal) {
  return runAttemptOperation(attemptId, async () => parse<{ submittedDiagnosisId: string; correctDiagnosisId: string; diagnosisWasCorrect: boolean }>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/diagnosis`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ diagnosisId }), signal,
  })), signal);
}

export async function recordPrescription(attemptId: string, prescription: { medicationId: string; dose: string; duration: string; prescribedAt: number }, signal?: AbortSignal) {
  return runAttemptOperation(attemptId, async () => parse<typeof prescription>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/prescriptions`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prescription), signal,
  })), signal);
}

export async function recordCompletion(attemptId: string, completion: { summaryCompleted: boolean; safetyNettingCompleted: boolean; ideasConcernsExpectationsCompleted: boolean }, signal?: AbortSignal) {
  return runAttemptOperation(attemptId, async () => parse<typeof completion>(await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/completion`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(completion), signal,
  })), signal);
}
