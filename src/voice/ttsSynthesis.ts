import type { AudioJob } from './OrderedAudioQueue';

export interface SynthesizedPatientAudio {
  buffer: AudioBuffer;
  startedAt: number;
  receivedAt: number;
  headersAt: number;
  decodedAt: number;
  cache: string;
  voice: string | null;
  source: string | null;
  serverTiming: string | null;
}

interface TtsContext {
  audioCtx: AudioContext;
  ensureAttempt: () => Promise<string | null>;
  caseId: string;
  caseVersion: string;
  speakerGender: 'M' | 'F';
  isPediatric: boolean;
}

/** Performs one attempt-bound local TTS request and decode; playback is owned elsewhere. */
export async function synthesizePatientAudio(job: AudioJob, signal: AbortSignal, context: TtsContext): Promise<SynthesizedPatientAudio> {
  const startedAt = performance.now();
  const attemptId = await context.ensureAttempt();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!attemptId) throw new Error('Patient audio is not ready because the encounter service is unavailable.');
  const requestId = crypto.randomUUID();
  const response = await fetch('/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
    signal,
    body: JSON.stringify({
      text: job.text,
      attemptId,
      caseId: context.caseId,
      caseVersion: context.caseVersion,
      gender: context.speakerGender,
      isPediatric: context.isPediatric,
      isOpeningGreeting: job.isOpeningGreeting,
      cacheable: job.cacheable,
      requestId,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `Local speech request failed (${response.status})`);
  }
  const headersAt = performance.now();
  const bytes = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const receivedAt = performance.now();
  const buffer = await context.audioCtx.decodeAudioData(bytes.slice(0));
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const decodedAt = performance.now();
  return {
    buffer,
    startedAt,
    receivedAt,
    headersAt,
    decodedAt,
    cache: response.headers.get('X-Patient-TTS-Cache') ?? 'unknown',
    voice: response.headers.get('X-Patient-TTS-Voice'),
    source: response.headers.get('X-Patient-TTS-Source'),
    serverTiming: response.headers.get('Server-Timing'),
  };
}
