import { caseEvaluationInput, type CaseEvaluationInput } from './evaluationSchema.ts';
import type { DebriefRequest } from './debriefRequest.ts';
import { recoverAttempt } from '../game/attemptRecovery.ts';
import { recordCompletion, recordExamination, recordPrescription, submitDiagnosis } from '../clinical/investigationApi.ts';

function validate(value: unknown): CaseEvaluationInput {
  const parsed = caseEvaluationInput.safeParse(value);
  if (!parsed.success) throw new Error('The backend returned an invalid evaluation contract. Keep this encounter and report the request ID.');
  return parsed.data;
}
/** Recover first; only send grading once no cached/pending result exists. */
export async function requestDebrief(request: DebriefRequest, signal: AbortSignal): Promise<CaseEvaluationInput> {
  const attemptId = request.investigation_attempt_id;
  if (!attemptId) throw new Error('This encounter has no server attempt. Keep the page open and retry the encounter service.');
  let view = await recoverAttempt(attemptId, signal);
  while (view.evaluationActive && !view.evaluationResult) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 1000);
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    });
    view = await recoverAttempt(attemptId, signal);
  }
  if (view.evaluationResult) return validate(view.evaluationResult);
  await Promise.all([
    ...request.encounter_log.examinations_performed.map((item) => recordExamination(attemptId, item.action_id, item.performed_at, signal)),
    ...request.encounter_log.prescriptions.map((item) => recordPrescription(attemptId, {
      medicationId: item.medication_id, dose: item.dose, duration: item.duration, prescribedAt: item.prescribed_at,
    }, signal)),
    ...(request.encounter_log.submitted_diagnosis_id ? [submitDiagnosis(attemptId, request.encounter_log.submitted_diagnosis_id, signal)] : []),
    ...(request.encounter_log.safety_netting_checks ? [recordCompletion(attemptId, {
      summaryCompleted: request.encounter_log.safety_netting_checks.summary_completed,
      safetyNettingCompleted: request.encounter_log.safety_netting_checks.safety_netting_completed,
      ideasConcernsExpectationsCompleted: request.encounter_log.safety_netting_checks.ideas_concerns_expectations_completed,
    }, signal)] : []),
  ]);
  const requestId = crypto.randomUUID();
  const response = await fetch('/api/local-ai/evaluate', {
    method: 'POST', credentials: 'include', signal,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify({ attemptId, caseId: request.case_id, caseVersion: request.case_version,
      variantSeed: request.variant_seed, encounterTiming: request.encounter_log.consultation_timing }),
  });
  const supportId = response.headers.get('X-MedSim-Request-Id') ?? requestId;
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(`${payload?.detail ?? `Evaluation request failed (${response.status}).`} Request ID: ${supportId}. Keep this page and retry.`);
  }
  try { return validate(await response.json()); } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'Invalid evaluation response.'} Request ID: ${supportId}`);
  }
}
