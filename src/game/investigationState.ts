import type { ActivePatient } from './types';

type InvestigationOrder = ActivePatient['investigationOrders'][number];

export function markInvestigationAttemptReady(patient: ActivePatient, attempt: { attemptId: string; investigations: ActivePatient['investigationCatalogue'] }): ActivePatient {
  return { ...patient, encounterAttemptId: attempt.attemptId, investigationAttemptId: attempt.attemptId, investigationAttemptStatus: 'ready', investigationCatalogue: attempt.investigations };
}

export function markInvestigationAttemptError(patient: ActivePatient): ActivePatient {
  return { ...patient, investigationAttemptStatus: 'error' };
}

export function markTestOrdered(patient: ActivePatient, testId: string, orderedAt: number): ActivePatient {
  return { ...patient, orderedTestIds: [...patient.orderedTestIds, testId], testOrderedAt: { ...patient.testOrderedAt, [testId]: orderedAt } };
}

export function replaceInvestigationOrder(patient: ActivePatient, testId: string, order: InvestigationOrder): ActivePatient {
  return {
    ...patient,
    investigationOrders: [...patient.investigationOrders.filter((item) => item.investigationId !== testId), order],
    completedTestIds: order.status === 'available' ? [...new Set([...patient.completedTestIds, testId])] : patient.completedTestIds,
  };
}

export function appendInvestigationError(patient: ActivePatient, testId: string, indication: string, orderedAt: number): ActivePatient {
  return {
    ...patient,
    investigationOrders: [...patient.investigationOrders, {
      orderId: `error-${testId}`, investigationId: testId, orderedAt: orderedAt / 1000, availableAt: orderedAt / 1000,
      status: 'error', indication, statusDetail: 'The investigation service did not return a result; no local fallback was used.',
    }],
  };
}
