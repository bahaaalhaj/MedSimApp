import { caseEvaluationInput, type CaseEvaluationInput } from './evaluationSchema.ts';
import type { DebriefRequest } from './debriefRequest.ts';
import { recoverAttempt } from '../game/attemptRecovery.ts';
import { AttemptRequestError, recordCompletion, recordExamination, recordPrescription, submitDiagnosis } from '../clinical/investigationApi.ts';
import { attemptQueue, runAttemptOperation, waitForAttemptWork } from '../clinical/attemptQueue.ts';

// A second caller in this browser recovers the first result, rather than
// interleaving another preparation/evaluation. This is not a server lock.
const enqueueDebrief = attemptQueue();

function validate(value: unknown): CaseEvaluationInput {
  const parsed = caseEvaluationInput.safeParse(value);
  if (!parsed.success) throw new Error('The backend returned an invalid evaluation contract. Keep this encounter and report the request ID.');
  return parsed.data;
}
/** Recover first; only send grading once no cached/pending result exists. */
export async function requestDebrief(request: DebriefRequest, signal: AbortSignal): Promise<CaseEvaluationInput> {
  const attemptId = request.investigation_attempt_id;
  if (!attemptId) throw new Error('This encounter has no server attempt. Keep the page open and retry the encounter service.');
  return enqueueDebrief(attemptId, async () => {
    await waitForAttemptWork(attemptId);
    const existing = await recoverEvaluation(attemptId, signal);
    if (existing) return existing;
    try {
      return await prepareAndEvaluate(attemptId, request, signal);
    } catch (error) {
      // Another browser/instance may have claimed evaluation after recovery.
      // Only recover; never repeat the evaluate POST or any failed evidence write.
      if (!signal.aborted && error instanceof AttemptRequestError && error.status === 409) {
        try {
          const recovered = await recoverEvaluation(attemptId, signal);
          if (recovered) return recovered;
        } catch (recoveryError) {
          // A still-busy/unavailable recovery must not hide the original
          // preparation/evaluation error. Invalid saved results still fail.
          if (!(recoveryError instanceof AttemptRequestError)) throw recoveryError;
        }
      }
      throw error;
    }
  }, signal);
}

async function recoverEvaluation(attemptId: string, signal: AbortSignal): Promise<CaseEvaluationInput | null> {
  let view = await recoverAttempt(attemptId, signal);
  const wasPending = view.evaluationActive;
  while (view.evaluationActive && !view.evaluationResult) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 1000);
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    });
    view = await recoverAttempt(attemptId, signal);
  }
  if (view.evaluationResult) return validate(view.evaluationResult);
  if (wasPending) throw new Error('The previous evaluation ended without a saved result. Keep this page and retry manually.');
  if (view.pendingDialogueRequestIds?.length) throw new Error('Patient text is still pending delivery. Resume the encounter to reconcile the reply before evaluating.');
  return null;
}

async function prepareAndEvaluate(attemptId: string, request: DebriefRequest, signal: AbortSignal): Promise<CaseEvaluationInput> {
  for (const item of request.encounter_log.examinations_performed) {
    await recordExamination(attemptId, item.action_id, item.performed_at, signal);
  }
  for (const item of request.encounter_log.prescriptions) {
    await recordPrescription(attemptId, {
      medicationId: item.medication_id, dose: item.dose, duration: item.duration, prescribedAt: item.prescribed_at,
    }, signal);
  }
  if (request.encounter_log.submitted_diagnosis_id) {
    await submitDiagnosis(attemptId, request.encounter_log.submitted_diagnosis_id, signal);
  }
  if (request.encounter_log.safety_netting_checks) {
    await recordCompletion(attemptId, {
      summaryCompleted: request.encounter_log.safety_netting_checks.summary_completed,
      safetyNettingCompleted: request.encounter_log.safety_netting_checks.safety_netting_completed,
      ideasConcernsExpectationsCompleted: request.encounter_log.safety_netting_checks.ideas_concerns_expectations_completed,
    }, signal);
  }
  await waitForAttemptWork(attemptId);
  return runAttemptOperation(attemptId, async () => {
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
      throw new AttemptRequestError(`${payload?.detail ?? `Evaluation request failed (${response.status}).`} Request ID: ${supportId}. Keep this page and retry.`, response.status);
    }
    try { return validate(await response.json()); } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : 'Invalid evaluation response.'} Request ID: ${supportId}`);
    }
  }, signal);
}
