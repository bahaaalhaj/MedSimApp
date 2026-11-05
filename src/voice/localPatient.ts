export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type PatientQuestionSource = 'typed' | 'predefined';
export type PatientResponseProvenance = 'openrouter' | 'deterministic-authored' | 'safe-unknown';
export interface PatientStreamChunk {
  text: string;
  complete?: boolean;
  provenance?: PatientResponseProvenance;
  actualModel?: string | null;
  matchConfidence?: number;
  intentId?: string | null;
  matchedSource?: string | null;
  answerShownToTrainee?: string | null;
  relevantPerCase?: boolean | null;
}

export class LocalPatientError extends Error {
  constructor(
    message: string,
    public readonly category: 'missing-api-key' | 'missing-model' | 'configuration-invalid' | 'paid-model-blocked' | 'local-provider-disabled' | 'model-starting' | 'model-unavailable' | 'free-capacity-unavailable' | 'rate-limited' | 'low-memory' | 'response-timeout' | 'invalid-request' | 'request-in-progress' | 'unknown',
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

const PATIENT_STREAM_URL = '/agent/patient/stream';

/** Client acceptance of a complete text turn; never proof of reading or audio. */
export async function acknowledgePatientText(attemptId: string, requestId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/dialogue/acknowledgements`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }), signal,
  });
  const receipt = await response.json().catch(() => null) as { acknowledged?: boolean; requestId?: string } | null;
  if (!response.ok || receipt?.acknowledged !== true || receipt.requestId !== requestId) {
    throw new LocalPatientError('The reply could not be reconciled. Retry the same question or resume the encounter; no new answer is needed.', 'model-unavailable', true);
  }
}

export async function* streamLocalPatient(
  attemptId: string,
  question: string,
  source: PatientQuestionSource,
  questionId?: string,
  signal?: AbortSignal,
  requestId: string = crypto.randomUUID(),
): AsyncGenerator<PatientStreamChunk, void, unknown> {
  const res = await fetch(PATIENT_STREAM_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify({ attemptId, question, source, questionId, requestId }),
    signal,
  });
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null) as { detail?: string } | null;
    throw new LocalPatientError(
      payload?.detail ?? `Patient request failed (${res.status}).`,
      res.status === 422 ? 'invalid-request' : res.status === 409 ? 'request-in-progress' : 'model-unavailable',
      res.status >= 500,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const encoded = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!encoded) continue;
        let event: { text?: string; done?: boolean; correlationId?: string; requiresAcknowledgement?: boolean; error?: string; category?: string; retryable?: boolean; provenance?: PatientResponseProvenance; actualModel?: string | null; matchConfidence?: number; intentId?: string | null; matchedSource?: string | null; answerShownToTrainee?: string | null; relevantPerCase?: boolean | null };
        try { event = JSON.parse(encoded); } catch { continue; }
        if (event.error) {
          const category = ['missing-api-key', 'missing-model', 'configuration-invalid', 'paid-model-blocked', 'local-provider-disabled', 'model-starting', 'model-unavailable', 'free-capacity-unavailable', 'rate-limited', 'low-memory', 'response-timeout', 'invalid-request', 'request-in-progress'].includes(event.category ?? '')
            ? event.category as LocalPatientError['category']
            : 'unknown';
          throw new LocalPatientError(event.error, category, event.retryable !== false);
        }
        if (event.done) {
          if (event.requiresAcknowledgement) {
            if (event.correlationId !== requestId) throw new LocalPatientError('Patient reply request ID mismatch.', 'model-unavailable', true);
          }
          // The consumer accepts complete text before this generator resumes
          // and sends its receipt. A lost receipt must not erase visible text.
          yield { text: '', complete: true, provenance: event.provenance, actualModel: event.actualModel, matchConfidence: event.matchConfidence, intentId: event.intentId, matchedSource: event.matchedSource, answerShownToTrainee: event.answerShownToTrainee, relevantPerCase: event.relevantPerCase };
          if (event.requiresAcknowledgement) await acknowledgePatientText(attemptId, requestId, signal);
          return;
        }
        if (typeof event.text === 'string') yield { text: event.text };
      }
    }
    throw new LocalPatientError('The patient response was interrupted. Your question was not answered. Please retry.', 'model-unavailable', true);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
