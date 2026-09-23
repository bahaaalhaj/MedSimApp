import { LocalPatientError, streamLocalPatient, type PatientResponseProvenance } from './localPatient';
import type { PatientTextRequest } from './PatientTextRequestLifecycle';

export interface PatientTextResponse {
  text: string;
  patientProvenance: PatientResponseProvenance;
  actualModel: string | null;
  patientIntentId: string | null;
  patientMatchedSource: string | null;
  answerShownToTrainee: string | null;
  relevantPerCase: boolean;
}

export async function requestPatientText(
  request: PatientTextRequest,
  signal: AbortSignal,
  ensureAttempt: () => Promise<string | null>,
  onStreaming: () => void,
): Promise<{ kind: 'completed'; response: PatientTextResponse } | { kind: 'cancelled' }> {
  const attemptId = await ensureAttempt();
  if (signal.aborted) return { kind: 'cancelled' };
  if (!attemptId) throw new LocalPatientError('The encounter service is unavailable. Retry when the backend is ready.', 'model-unavailable', true);
  let response = '';
  let patientProvenance: PatientResponseProvenance = 'safe-unknown';
  let actualModel: string | null = null;
  let patientIntentId: string | null = null;
  let patientMatchedSource: string | null = null;
  let answerShownToTrainee: string | null = null;
  let relevantPerCase = false;
  for await (const chunk of streamLocalPatient(attemptId, request.text, request.source, request.questionId, signal)) {
    if (!response) onStreaming();
    response += chunk.text;
    if (chunk.provenance) patientProvenance = chunk.provenance;
    if (chunk.actualModel !== undefined) actualModel = chunk.actualModel;
    if (chunk.intentId !== undefined) patientIntentId = chunk.intentId;
    if (chunk.matchedSource !== undefined) patientMatchedSource = chunk.matchedSource;
    if (chunk.answerShownToTrainee !== undefined) answerShownToTrainee = chunk.answerShownToTrainee;
    if (chunk.relevantPerCase !== undefined && chunk.relevantPerCase !== null) relevantPerCase = chunk.relevantPerCase;
  }
  if (signal.aborted) return { kind: 'cancelled' };
  return {
    kind: 'completed',
    response: { text: response.trim(), patientProvenance, actualModel, patientIntentId, patientMatchedSource, answerShownToTrainee, relevantPerCase },
  };
}
