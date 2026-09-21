import { useEffect, useState } from 'react';
import { caseEvaluationInput, type CaseEvaluationInput } from './evaluationSchema';
import type { DebriefRequest } from './debriefRequest';
import { recordCompletion, recordExamination, recordPrescription, submitDiagnosis } from '../clinical/investigationApi';

export type DebriefStatus = 'idle' | 'starting' | 'streaming' | 'got-evaluation' | 'error' | 'aborted';

export interface UseLocalDebriefResult {
  status: DebriefStatus;
  evaluation: CaseEvaluationInput | null;
  error: string | null;
  partialNarration: string;
  reset: () => void;
}

export function useLocalDebrief(
  request: DebriefRequest | null,
  opts: { enabled?: boolean } = {},
): UseLocalDebriefResult {
  const enabled = opts.enabled !== false;
  const [status, setStatus] = useState<DebriefStatus>('idle');
  const [evaluation, setEvaluation] = useState<CaseEvaluationInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !request) return;
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
    setStatus('starting');
    setError(null);
    setEvaluation(null);

    void (async () => {
      try {
        if (!request.investigation_attempt_id) throw new Error('This encounter has no server attempt. Return to the encounter and retry.');
        setStatus('streaming');
        const attemptId = request.investigation_attempt_id;
        await Promise.all([
          ...request.encounter_log.examinations_performed.map((item) => recordExamination(attemptId, item.action_id, item.performed_at)),
          ...request.encounter_log.prescriptions.map((item) => recordPrescription(attemptId, {
            medicationId: item.medication_id, dose: item.dose, duration: item.duration, prescribedAt: item.prescribed_at,
          })),
          ...(request.encounter_log.submitted_diagnosis_id ? [submitDiagnosis(attemptId, request.encounter_log.submitted_diagnosis_id)] : []),
          ...(request.encounter_log.safety_netting_checks ? [recordCompletion(attemptId, {
            summaryCompleted: request.encounter_log.safety_netting_checks.summary_completed,
            safetyNettingCompleted: request.encounter_log.safety_netting_checks.safety_netting_completed,
            ideasConcernsExpectationsCompleted: request.encounter_log.safety_netting_checks.ideas_concerns_expectations_completed,
          })] : []),
        ]);
        const response = await fetch('/api/local-ai/evaluate', {
          method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            attemptId,
            caseId: request.case_id,
            caseVersion: request.case_version,
            variantSeed: request.variant_seed,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { detail?: string } | null;
          throw new Error(payload?.detail ?? `Evaluation request failed (${response.status}).`);
        }
        const parsed = caseEvaluationInput.safeParse(await response.json());
        if (!parsed.success) throw new Error('The backend returned an invalid evaluation contract.');
        if (!cancelled) {
          setEvaluation(parsed.data);
          setStatus('got-evaluation');
        }
      } catch (cause) {
        if (controller.signal.aborted && !timedOut) {
          if (!cancelled) setStatus('aborted');
          return;
        }
        if (!cancelled) {
          setEvaluation(null);
          setStatus('error');
          setError(timedOut ? 'Evaluation request timed out.' : cause instanceof Error ? cause.message : 'Evaluation is unavailable.');
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [enabled, request]);

  return {
    status, evaluation, error, partialNarration: '',
    reset: () => { setStatus('idle'); setEvaluation(null); setError(null); },
  };
}
