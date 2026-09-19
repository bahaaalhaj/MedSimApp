import { useEffect, useState } from 'react';
import { caseEvaluationInput, type CaseEvaluationInput } from './evaluationSchema';
import type { DebriefRequest } from './debriefRequest';
import { buildConservativeDeterministicEvaluation } from './deterministicEvaluation';

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
        const response = await fetch('/api/local-ai/evaluate', {
          method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            attemptId: request.investigation_attempt_id,
            caseId: request.case_id,
            caseVersion: request.case_version,
            variantSeed: request.variant_seed,
            askedQuestionIds: request.encounter_log.history_questions_asked.map((item) => item.id),
            treatmentIds: request.encounter_log.treatments_given.map((item) => item.treatment_id),
            prescriptions: request.encounter_log.prescriptions.map((item) => ({ medicationId: item.medication_id, dose: item.dose, duration: item.duration })),
            submittedDiagnosisId: request.encounter_log.submitted_diagnosis_id,
            transcript: request.encounter_log.transcript.map((item) => ({
              role: item.role, content: item.content, timestampIso: item.timestamp_iso, questionSource: item.question_source, attemptId: item.attempt_id,
            })),
            examinations: request.encounter_log.examinations_performed.map((item) => ({ actionId: item.action_id, performedAt: item.performed_at, attemptId: item.attempt_id })),
            completionChecks: request.encounter_log.safety_netting_checks ? {
              summaryCompleted: request.encounter_log.safety_netting_checks.summary_completed,
              safetyNettingCompleted: request.encounter_log.safety_netting_checks.safety_netting_completed,
              ideasConcernsExpectationsCompleted: request.encounter_log.safety_netting_checks.ideas_concerns_expectations_completed,
            } : null,
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
          const category = timedOut ? 'evaluation-timeout' : 'evaluation-unavailable';
          setEvaluation(buildConservativeDeterministicEvaluation(request, category));
          setStatus('got-evaluation');
          setError(null);
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
