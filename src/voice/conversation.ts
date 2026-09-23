/** Text-first AI patient conversation with ordered local TTS playback. */
import { recordRuntimeDiagnostic } from '../runtimeDiagnostics.ts';
import { canStartPatientText, ConversationState } from './ConversationState';
import { OrderedAudioQueue, type AudioJob, type PatientAudioState } from './OrderedAudioQueue';
import { PatientAudioPreferences } from './PatientAudioPreferences';
import { PatientTextRequestLifecycle } from './PatientTextRequestLifecycle';
import { WebAudioPlayback } from './WebAudioPlayback';
import { requestPatientText, type PatientTextResponse } from './patientTextRequest';
import { synthesizePatientAudio, type SynthesizedPatientAudio } from './ttsSynthesis';
import type {
  ConversationListeners,
  ConversationMessage,
  ConversationOptions,
  ConversationStatus,
  PatientEmotion,
  QuestionSource,
  SubtitleEvent,
  TranscriptRecord,
} from './conversationTypes';

export type {
  ConversationListeners,
  ConversationMessage,
  ConversationOptions,
  ConversationStatus,
  PatientAudioState,
  PatientEmotion,
  QuestionSource,
  SubtitleEvent,
  TranscriptRecord,
};

function detectEmotion(text: string): PatientEmotion {
  const value = text.toLowerCase();
  if (/\b(hurts?|pain|ache|sore|burning|sharp|agony|chest)\b/.test(value)) return 'pain';
  if (/\b(scared|afraid|worried|nervous|anxious|dying)\b/.test(value)) return 'fear';
  if (/\b(better|thanks|thank you|relieved)\b/.test(value)) return 'relief';
  if (/\b(don't understand|not sure|confused)\b/.test(value)) return 'confused';
  return 'neutral';
}

export class Conversation {
  private readonly state: ConversationState;
  private readonly preferences = new PatientAudioPreferences();
  private readonly playback: WebAudioPlayback;
  private readonly patientText: PatientTextRequestLifecycle<PatientTextResponse>;
  private readonly audioQueue: OrderedAudioQueue<SynthesizedPatientAudio>;
  private disposed = false;

  constructor(audioCtx: AudioContext, listeners: ConversationListeners, private readonly options: ConversationOptions) {
    const openingTurnId = `opening-${options.caseId}-${options.caseVersion}`;
    this.state = new ConversationState({ ...options.initialMessage, audioTurnId: openingTurnId }, listeners);
    this.playback = new WebAudioPlayback(audioCtx, this.preferences);
    this.patientText = new PatientTextRequestLifecycle((request, signal) => requestPatientText(
      request,
      signal,
      options.ensureAttempt,
      () => { if (!this.disposed) this.state.setStatus('streaming', 'Patient text is streaming…'); },
    ));
    this.audioQueue = new OrderedAudioQueue({
      synthesize: (job, signal) => synthesizePatientAudio(job, signal, {
        audioCtx,
        ensureAttempt: options.ensureAttempt,
        caseId: options.caseId,
        caseVersion: options.caseVersion,
        speakerGender: options.speakerGender,
        isPediatric: options.isPediatric,
      }),
      play: (audio, job, onStarted) => this.playback.play(audio.buffer, job.turnId, onStarted),
      stop: () => { this.playback.stop(); },
      onPreparing: (job) => {
        this.state.setLastAudioError('');
        recordRuntimeDiagnostic('audio-request-start', job.turnId, { queueLength: this.audioQueue.getQueuePosition(job.turnId) ?? 0 });
        if (!this.patientText.isBusy()) this.state.setStatus('audio-preparing', 'Patient audio is being prepared…');
        this.state.getListeners().onProgress?.('Generating local patient speech…');
      },
      onPlaying: (job, audio) => {
        recordRuntimeDiagnostic('audio-response-decoded', job.turnId, {
          httpMs: Math.round(audio.receivedAt - audio.startedAt),
          decodeMs: Math.round(audio.decodedAt - audio.receivedAt),
          cache: audio.cache,
          voice: audio.voice ?? 'unknown',
        });
        recordRuntimeDiagnostic('audio-playback-start', job.turnId, { totalMs: Math.round(performance.now() - audio.startedAt) });
        if (!this.patientText.isBusy()) this.state.setStatus('speaking');
        if (import.meta.env.DEV) console.debug('[MedSim runtime]', {
          event: 'patient-audio-start', turnId: job.turnId,
          httpMs: Math.round(audio.receivedAt - audio.startedAt),
          decodeMs: Math.round(audio.decodedAt - audio.receivedAt),
          totalMs: Math.round(performance.now() - audio.startedAt),
          cache: audio.cache, voice: audio.voice, source: audio.source, serverTiming: audio.serverTiming,
        });
      },
      onPlayed: () => { if (!this.patientText.isBusy()) this.state.setStatus('ready'); },
      onSkipped: () => { if (!this.disposed && !this.patientText.isBusy()) this.state.setStatus('ready'); },
      onError: (_job, error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('Speech queue is full.')) {
          this.state.getListeners().onError?.(message);
          return;
        }
        this.state.setLastAudioError(message);
        if (!this.disposed && !this.patientText.isBusy()) this.state.setStatus('ready');
        this.state.getListeners().onError?.(`Speech unavailable: ${message}. Use Replay to try again.`);
      },
    });
  }

  setListeners(listeners: ConversationListeners) { this.state.setListeners(listeners); }
  getStatus() { return this.state.getStatus(); }
  getMessages() { return this.state.getMessages(); }
  getCurrentEmotion() { return this.state.getCurrentEmotion(); }
  getVolume() { return this.preferences.getVolume(); }
  isMuted() { return this.preferences.isMuted(); }
  getLastPatientText() { return this.state.getLastPatientText(); }
  getLastAudioError() { return this.state.getLastAudioError(); }
  getLastResponseError() { return this.state.getLastResponseError(); }
  getAudioTurnState(turnId: string) { return this.audioQueue.getState(turnId); }
  getAudioQueuePosition(turnId: string) { return this.audioQueue.getQueuePosition(turnId); }
  subscribeMessages(fn: (messages: ReadonlyArray<ConversationMessage>) => void) { return this.state.subscribeMessages(fn); }
  subscribeAudioStates(fn: () => void) { return this.audioQueue.subscribe(fn); }
  setVolume(volume: number) { this.preferences.setVolume(volume); this.playback.applyGain(); }
  setMuted(muted: boolean) { this.preferences.setMuted(muted); this.playback.applyGain(); }
  getMouthAmplitude() { return this.playback.getMouthAmplitude(); }

  async init() {
    if (this.state.getStatus() !== 'uninitialized' || this.disposed) return;
    this.state.setStatus('loading');
    const initialText = this.options.initialMessage.content;
    this.state.setLastPatient(initialText, 'deterministic-authored');
    this.state.setEmotion(detectEmotion(initialText), false);
    const turnId = this.state.getMessages()[0].audioTurnId!;
    this.options.onTranscript({ role: 'patient', content: initialText, timestampIso: new Date().toISOString(), questionSource: null, patientProvenance: 'deterministic-authored', actualModel: null, audioTurnId: turnId });
    this.state.getListeners().onSubtitle?.({ who: 'patient', text: initialText });
    this.state.emitMessages();
    this.state.setStatus('ready');
    this.enqueueSpeech({ turnId, text: initialText, isOpeningGreeting: true, cacheable: true });
  }

  async sendTextMessage(text: string, source: QuestionSource = 'typed', questionId?: string): Promise<boolean> {
    const clean = text.trim();
    if (!clean || this.disposed || !canStartPatientText(this.state.getStatus(), this.patientText.isBusy(), this.audioQueue.isBusy())) {
      if (!clean || this.disposed || this.patientText.isBusy() || ['preparing', 'streaming'].includes(this.state.getStatus())) return false;
      const error = 'Finish the current patient speech or use Skip before asking another question.';
      this.state.setLastResponseError(error);
      this.state.getListeners().onError?.(error);
      return false;
    }
    this.state.setLastResponseError('');
    this.state.setLastQuestion({ text: clean, source, questionId });
    this.state.getListeners().onSubtitle?.({ who: 'you', text: clean });
    this.state.pushMessage({ role: 'user', content: clean });
    this.state.setStatus('preparing', 'Patient is preparing a response…');

    let result;
    try {
      result = await this.patientText.run({ text: clean, source, questionId });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.state.popMessage();
        if (!this.disposed) this.state.setStatus('ready');
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.state.popMessage();
      this.state.setLastResponseError(message);
      this.state.setStatus('error', message);
      this.state.getListeners().onError?.(message);
      return false;
    }
    if (result.kind !== 'completed') {
      this.state.popMessage();
      if (!this.disposed) this.state.setStatus('ready');
      return false;
    }
    const response = result.response;
    if (!response.text) {
      this.state.popMessage();
      const error = 'The configured model returned an empty response. Retry the question.';
      this.state.setLastResponseError(error);
      this.state.setStatus('error', error);
      this.state.getListeners().onError?.(error);
      return false;
    }
    this.commitPatientResponse(clean, source, questionId, response);
    return true;
  }

  async retrySpeech() {
    const text = this.state.getLastPatientText();
    if (text) this.enqueueSpeech({ turnId: `replay-${crypto.randomUUID()}`, text, isOpeningGreeting: false, cacheable: this.state.getLastPatientProvenance() !== 'openrouter' });
  }
  async retryLastResponse() { const last = this.state.getLastQuestion(); if (last) await this.sendTextMessage(last.text, last.source, last.questionId); }
  async replayLastResponse() { await this.retrySpeech(); }
  replayTurn(turnId: string) {
    const message = this.state.getMessages().find((item) => item.audioTurnId === turnId);
    if (message?.role === 'assistant') this.enqueueSpeech({ turnId, text: message.content, isOpeningGreeting: turnId.startsWith('opening-'), cacheable: true });
  }
  skipCurrentSpeech() { this.audioQueue.skipCurrent(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.patientText.dispose();
    this.audioQueue.dispose();
    this.playback.dispose();
    this.state.dispose();
  }

  private commitPatientResponse(clean: string, source: QuestionSource, questionId: string | undefined, response: PatientTextResponse) {
    this.state.setLastPatient(response.text, response.patientProvenance);
    const audioTurnId = `patient-${crypto.randomUUID()}`;
    // Text and transcript evidence are committed before optional TTS begins.
    this.options.onTranscript({ role: 'trainee', content: clean, timestampIso: new Date().toISOString(), questionSource: source });
    this.state.pushMessage({ role: 'assistant', content: response.text, audioTurnId });
    this.options.onTranscript({ role: 'patient', content: response.text, timestampIso: new Date().toISOString(), questionSource: null, patientProvenance: response.patientProvenance, actualModel: response.actualModel, audioTurnId, patientIntentId: response.patientIntentId, patientMatchedSource: response.patientMatchedSource });
    if (source === 'predefined' && questionId && response.answerShownToTrainee !== null) this.options.onAuthorizedAnswer(questionId, response.answerShownToTrainee, response.relevantPerCase);
    this.state.setEmotion(detectEmotion(response.text));
    this.state.getListeners().onSubtitle?.({ who: 'patient', text: response.text });
    this.state.setStatus('ready');
    this.enqueueSpeech({ turnId: audioTurnId, text: response.text, isOpeningGreeting: false, cacheable: response.patientProvenance !== 'openrouter' });
  }

  private enqueueSpeech(job: AudioJob) {
    if (this.audioQueue.enqueue(job)) recordRuntimeDiagnostic('audio-queued', job.turnId, { queueLength: this.audioQueue.getQueuePosition(job.turnId) ?? 0, opening: job.isOpeningGreeting });
  }
}
