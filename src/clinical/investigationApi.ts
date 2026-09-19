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
): Promise<{ attemptId: string; investigations: Catalogue; openingGreeting: string }> {
  return parse(await fetch('/api/attempts', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId, caseVersion, variantSeed, clientAttemptId, patientProfile }),
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
