import { useEffect, useState } from 'react';
import type { CaseEvaluationInput } from './evaluationSchema';
import type { DebriefRequest } from './debriefRequest';
import { requestDebrief } from './debriefClient';

export type DebriefStatus = 'idle' | 'starting' | 'streaming' | 'got-evaluation' | 'error' | 'aborted';
export interface UseLocalDebriefResult {
  status: DebriefStatus; evaluation: CaseEvaluationInput | null; error: string | null;
  partialNarration: string; reset: () => void;
}
export function useLocalDebrief(request: DebriefRequest | null, opts: { enabled?: boolean } = {}): UseLocalDebriefResult {
  const enabled = opts.enabled !== false;
  const [status, setStatus] = useState<DebriefStatus>('idle');
  const [evaluation, setEvaluation] = useState<CaseEvaluationInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !request) return;
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
    setStatus('starting'); setError(null); setEvaluation(null);
    void (async () => {
      try {
        setStatus('streaming');
        const result = await requestDebrief(request, controller.signal);
        if (!cancelled) { setEvaluation(result); setStatus('got-evaluation'); }
      } catch (cause) {
        if (!cancelled) {
          setStatus('error');
          setError(timedOut ? 'The evaluation connection timed out. Your server result may still finish. Retry to retrieve it without grading again.'
            : cause instanceof Error ? cause.message : 'Evaluation is unavailable. Keep this page and retry.');
        }
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [enabled, request, revision]);
  return { status, evaluation, error, partialNarration: '', reset: () => setRevision((value) => value + 1) };
}
