export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type PatientQuestionSource = 'typed' | 'predefined';
export type PatientResponseProvenance = 'openrouter' | 'deterministic-authored' | 'safe-unknown';
export interface PatientStreamChunk {
  text: string;
  provenance?: PatientResponseProvenance;
  actualModel?: string | null;
  matchConfidence?: number;
  intentId?: string | null;
  matchedSource?: string | null;
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

export async function* streamLocalPatient(
  attemptId: string,
  question: string,
  source: PatientQuestionSource,
  questionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<PatientStreamChunk, void, unknown> {
  const requestId = crypto.randomUUID();
  const res = await fetch(PATIENT_STREAM_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
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
      let event: { text?: string; done?: boolean; error?: string; category?: string; retryable?: boolean; provenance?: PatientResponseProvenance; actualModel?: string | null; matchConfidence?: number; intentId?: string | null; matchedSource?: string | null };
      try { event = JSON.parse(encoded); } catch { continue; }
      if (event.error) {
        const category = ['missing-api-key', 'missing-model', 'configuration-invalid', 'paid-model-blocked', 'local-provider-disabled', 'model-starting', 'model-unavailable', 'free-capacity-unavailable', 'rate-limited', 'low-memory', 'response-timeout', 'invalid-request', 'request-in-progress'].includes(event.category ?? '')
          ? event.category as LocalPatientError['category']
          : 'unknown';
        throw new LocalPatientError(event.error, category, event.retryable !== false);
      }
      if (event.done) {
        yield { text: '', provenance: event.provenance, actualModel: event.actualModel, matchConfidence: event.matchConfidence, intentId: event.intentId, matchedSource: event.matchedSource };
        return;
      }
      if (typeof event.text === 'string') yield { text: event.text };
    }
  }
}
