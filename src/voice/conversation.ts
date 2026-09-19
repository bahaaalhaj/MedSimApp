/** Text-first AI patient conversation with ordered local TTS playback. */
import { streamLocalPatient, type ChatMessage, LocalPatientError, type PatientResponseProvenance } from './localPatient';

export type ConversationStatus = 'uninitialized' | 'loading' | 'ready' | 'preparing' | 'streaming' | 'audio-preparing' | 'speaking' | 'error';
export type QuestionSource = 'typed' | 'predefined';
export type PatientAudioState = 'queued' | 'preparing' | 'playing' | 'played' | 'error';
export type ConversationMessage = ChatMessage & { audioTurnId?: string };
export interface SubtitleEvent { who: 'patient' | 'you'; text: string; }
export type PatientEmotion = 'neutral' | 'pain' | 'fear' | 'relief' | 'confused';

export interface ConversationListeners {
  onStatus?: (status: ConversationStatus, detail?: string) => void;
  onProgress?: (message: string) => void;
  onSubtitle?: (subtitle: SubtitleEvent) => void;
  onError?: (error: string) => void;
  onEmotion?: (emotion: PatientEmotion) => void;
}

export interface TranscriptRecord {
  role: 'trainee' | 'patient'; content: string; timestampIso: string;
  questionSource: QuestionSource | null; patientProvenance?: PatientResponseProvenance;
  actualModel?: string | null; audioTurnId?: string;
  patientIntentId?: string | null; patientMatchedSource?: string | null;
}

export interface ConversationOptions {
  initialMessage: { role: 'assistant'; content: string };
  speakerGender: 'M' | 'F'; isPediatric: boolean; caseId: string; caseVersion: string;
  ensureAttempt: () => Promise<string | null>;
  onTranscript: (record: TranscriptRecord) => void;
}

interface AudioJob { turnId: string; text: string; isOpeningGreeting: boolean; cacheable: boolean; }
const VOLUME_KEY = 'medsim:patient-volume';
const MUTED_KEY = 'medsim:patient-muted';

function detectEmotion(text: string): PatientEmotion {
  const value = text.toLowerCase();
  if (/\b(hurts?|pain|ache|sore|burning|sharp|agony|chest)\b/.test(value)) return 'pain';
  if (/\b(scared|afraid|worried|nervous|anxious|dying)\b/.test(value)) return 'fear';
  if (/\b(better|thanks|thank you|relieved)\b/.test(value)) return 'relief';
  if (/\b(don't understand|not sure|confused)\b/.test(value)) return 'confused';
  return 'neutral';
}
function readNumber(key: string, fallback: number): number {
  try { const parsed = Number(localStorage.getItem(key)); return Number.isFinite(parsed) ? parsed : fallback; }
  catch { return fallback; }
}

export class Conversation {
  private messages: ConversationMessage[];
  private listeners: ConversationListeners;
  private status: ConversationStatus = 'uninitialized';
  private readonly options: ConversationOptions;
  private readonly audioCtx: AudioContext;
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private ampBuf: Uint8Array;
  private source: AudioBufferSourceNode | null = null;
  private requestController: AbortController | null = null;
  private ttsController: AbortController | null = null;
  private currentPlaybackResolve: (() => void) | null = null;
  private audioQueue: AudioJob[] = [];
  private audioWorkerRunning = false;
  private audioStates = new Map<string, PatientAudioState>();
  private disposed = false;
  private lastPatientText = '';
  private lastAudioError = '';
  private lastResponseError = '';
  private lastQuestion: { text: string; source: QuestionSource; questionId?: string } | null = null;
  private lastPatientProvenance: PatientResponseProvenance = 'deterministic-authored';
  private currentEmotion: PatientEmotion = 'neutral';
  private volume = Math.max(0, Math.min(1, readNumber(VOLUME_KEY, 0.85)));
  private muted = (() => { try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; } })();
  private messageSubscribers = new Set<(messages: ReadonlyArray<ConversationMessage>) => void>();
  private audioStateSubscribers = new Set<() => void>();

  constructor(audioCtx: AudioContext, listeners: ConversationListeners, options: ConversationOptions) {
    this.audioCtx = audioCtx; this.listeners = listeners; this.options = options;
    this.messages = [{ ...options.initialMessage, audioTurnId: `opening-${options.caseId}-${options.caseVersion}` }];
    this.gain = audioCtx.createGain(); this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.55;
    this.gain.connect(this.analyser); this.analyser.connect(audioCtx.destination);
    this.ampBuf = new Uint8Array(this.analyser.frequencyBinCount); this.applyGain();
  }

  setListeners(listeners: ConversationListeners) { this.listeners = listeners; }
  getStatus() { return this.status; }
  getMessages(): ReadonlyArray<ConversationMessage> { return [...this.messages]; }
  getCurrentEmotion() { return this.currentEmotion; }
  getVolume() { return this.volume; }
  isMuted() { return this.muted; }
  getLastPatientText() { return this.lastPatientText; }
  getLastAudioError() { return this.lastAudioError; }
  getLastResponseError() { return this.lastResponseError; }
  getAudioTurnState(turnId: string) { return this.audioStates.get(turnId); }
  subscribeMessages(fn: (messages: ReadonlyArray<ConversationMessage>) => void) { this.messageSubscribers.add(fn); return () => { this.messageSubscribers.delete(fn); }; }
  subscribeAudioStates(fn: () => void) { this.audioStateSubscribers.add(fn); return () => { this.audioStateSubscribers.delete(fn); }; }
  private emitMessages() { const snapshot = [...this.messages]; this.messageSubscribers.forEach((fn) => fn(snapshot)); }
  private setAudioTurnState(turnId: string, state: PatientAudioState) { this.audioStates.set(turnId, state); this.audioStateSubscribers.forEach((fn) => fn()); }
  private setStatus(status: ConversationStatus, detail?: string) { this.status = status; this.listeners.onStatus?.(status, detail); }
  private applyGain() { this.gain.gain.value = this.muted ? 0 : this.volume; }
  setVolume(volume: number) { this.volume = Math.max(0, Math.min(1, volume)); this.applyGain(); try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch { /* non-fatal */ } }
  setMuted(muted: boolean) { this.muted = muted; this.applyGain(); try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0'); } catch { /* non-fatal */ } }

  getMouthAmplitude(): number {
    if (!this.source || this.muted) return 0;
    this.analyser.getByteTimeDomainData(this.ampBuf as Uint8Array<ArrayBuffer>);
    let total = 0;
    for (const sample of this.ampBuf) { const centered = (sample - 128) / 128; total += centered * centered; }
    return Math.min(1, Math.sqrt(total / this.ampBuf.length) * 3.2);
  }

  async init() {
    if (this.status !== 'uninitialized') return;
    this.setStatus('loading'); this.lastPatientText = this.options.initialMessage.content;
    this.currentEmotion = detectEmotion(this.lastPatientText);
    const turnId = this.messages[0].audioTurnId!;
    this.options.onTranscript({ role: 'patient', content: this.lastPatientText, timestampIso: new Date().toISOString(), questionSource: null, patientProvenance: 'deterministic-authored', actualModel: null, audioTurnId: turnId });
    this.listeners.onSubtitle?.({ who: 'patient', text: this.lastPatientText });
    this.emitMessages(); this.setStatus('ready');
    this.enqueueSpeech({ turnId, text: this.lastPatientText, isOpeningGreeting: true, cacheable: true });
  }

  async sendTextMessage(text: string, source: QuestionSource = 'typed', questionId?: string): Promise<void> {
    const clean = text.trim();
    if (!clean || ['preparing', 'streaming'].includes(this.status)) return;
    this.lastResponseError = ''; this.lastQuestion = { text: clean, source, questionId };
    this.listeners.onSubtitle?.({ who: 'you', text: clean });
    this.messages.push({ role: 'user', content: clean });
    this.options.onTranscript({ role: 'trainee', content: clean, timestampIso: new Date().toISOString(), questionSource: source });
    this.emitMessages(); this.setStatus('preparing', 'Patient is preparing a response…');
    const controller = new AbortController(); this.requestController = controller;
    let response = ''; let patientProvenance: PatientResponseProvenance = 'safe-unknown';
    let actualModel: string | null = null; let patientIntentId: string | null = null; let patientMatchedSource: string | null = null;
    try {
      const attemptId = await this.options.ensureAttempt();
      if (!attemptId) throw new LocalPatientError('The encounter service is unavailable. Retry when the backend is ready.', 'model-unavailable', true);
      for await (const chunk of streamLocalPatient(attemptId, clean, source, questionId, controller.signal)) {
        if (!response) this.setStatus('streaming', 'Patient text is streaming…');
        response += chunk.text;
        if (chunk.provenance) patientProvenance = chunk.provenance;
        if (chunk.actualModel !== undefined) actualModel = chunk.actualModel;
        if (chunk.intentId !== undefined) patientIntentId = chunk.intentId;
        if (chunk.matchedSource !== undefined) patientMatchedSource = chunk.matchedSource;
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      this.lastResponseError = message; this.setStatus('error', message); this.listeners.onError?.(message); return;
    } finally { if (this.requestController === controller) this.requestController = null; }
    const cleanResponse = response.trim();
    if (!cleanResponse) { this.lastResponseError = 'The configured model returned an empty response. Retry the question.'; this.setStatus('error', this.lastResponseError); this.listeners.onError?.(this.lastResponseError); return; }
    this.lastPatientText = cleanResponse; this.lastPatientProvenance = patientProvenance;
    const audioTurnId = `patient-${crypto.randomUUID()}`;
    this.messages.push({ role: 'assistant', content: cleanResponse, audioTurnId });
    this.options.onTranscript({ role: 'patient', content: cleanResponse, timestampIso: new Date().toISOString(), questionSource: null, patientProvenance, actualModel, audioTurnId, patientIntentId, patientMatchedSource });
    this.currentEmotion = detectEmotion(cleanResponse); this.listeners.onEmotion?.(this.currentEmotion);
    this.listeners.onSubtitle?.({ who: 'patient', text: cleanResponse }); this.emitMessages(); this.setStatus('ready');
    this.enqueueSpeech({ turnId: audioTurnId, text: cleanResponse, isOpeningGreeting: false, cacheable: patientProvenance !== 'openrouter' });
  }

  async retrySpeech() { if (this.lastPatientText) this.enqueueSpeech({ turnId: `replay-${crypto.randomUUID()}`, text: this.lastPatientText, isOpeningGreeting: false, cacheable: this.lastPatientProvenance !== 'openrouter' }); }
  async retryLastResponse() { if (this.lastQuestion) await this.sendTextMessage(this.lastQuestion.text, this.lastQuestion.source, this.lastQuestion.questionId); }
  async replayLastResponse() { await this.retrySpeech(); }
  replayTurn(turnId: string) { const message = this.messages.find((item) => item.audioTurnId === turnId); if (message?.role === 'assistant') this.enqueueSpeech({ turnId, text: message.content, isOpeningGreeting: turnId.startsWith('opening-'), cacheable: true }); }

  private enqueueSpeech(job: AudioJob) {
    if (this.audioQueue.length >= 12) { this.setAudioTurnState(job.turnId, 'error'); this.listeners.onError?.('Speech queue is full. Use Replay on this response when ready.'); return; }
    this.audioQueue.push(job); this.setAudioTurnState(job.turnId, 'queued'); void this.runAudioQueue();
  }
  private async runAudioQueue() {
    if (this.audioWorkerRunning || this.disposed) return;
    this.audioWorkerRunning = true;
    try { while (!this.disposed && this.audioQueue.length) await this.synthesizeAndPlay(this.audioQueue.shift()!); }
    finally { this.audioWorkerRunning = false; }
  }

  private async synthesizeAndPlay(job: AudioJob) {
    const controller = new AbortController(); this.ttsController = controller;
    const startedAt = performance.now(); this.lastAudioError = ''; this.setAudioTurnState(job.turnId, 'preparing');
    if (!['preparing', 'streaming'].includes(this.status)) this.setStatus('audio-preparing', 'Patient audio is being prepared…');
    this.listeners.onProgress?.('Generating local patient speech…');
    try {
      const response = await fetch('/tts/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ text: job.text, caseId: this.options.caseId, caseVersion: this.options.caseVersion, gender: this.options.speakerGender, isPediatric: this.options.isPediatric, isOpeningGreeting: job.isOpeningGreeting, cacheable: job.cacheable, requestId: crypto.randomUUID() }) });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { detail?: string } | null; throw new Error(payload?.detail || `Local speech request failed (${response.status})`); }
      const buffer = await response.arrayBuffer(); if (this.disposed) return; const receivedAt = performance.now();
      const decoded = await this.audioCtx.decodeAudioData(buffer.slice(0)); if (this.disposed) return; const decodedAt = performance.now();
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      const source = this.audioCtx.createBufferSource(); source.buffer = decoded; source.connect(this.gain);
      const playbackDone = new Promise<void>((resolve) => { this.currentPlaybackResolve = resolve; });
      source.onended = () => { if (this.source === source) { source.disconnect(); this.source = null; this.setAudioTurnState(job.turnId, 'played'); if (!this.requestController) this.setStatus('ready'); } this.currentPlaybackResolve?.(); this.currentPlaybackResolve = null; };
      this.source = source; this.setAudioTurnState(job.turnId, 'playing'); if (!this.requestController) this.setStatus('speaking'); source.start();
      if (import.meta.env.DEV) console.debug('[MedSim runtime]', { event: 'patient-audio-start', turnId: job.turnId, httpMs: Math.round(receivedAt - startedAt), decodeMs: Math.round(decodedAt - receivedAt), totalMs: Math.round(performance.now() - startedAt), cache: response.headers.get('X-Patient-TTS-Cache') ?? 'unknown' });
      await playbackDone;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error); this.lastAudioError = message; this.setAudioTurnState(job.turnId, 'error');
      if (!this.disposed && !this.requestController) this.setStatus('ready'); this.listeners.onError?.(`Speech unavailable: ${message}. Use Replay to try again.`);
    } finally { if (this.ttsController === controller) this.ttsController = null; }
  }

  private stopAudio() { const current = this.source; this.source = null; if (current) { current.onended = null; try { current.stop(); } catch { /* already stopped */ } current.disconnect(); } this.currentPlaybackResolve?.(); this.currentPlaybackResolve = null; }
  private cancelSpeech() { this.ttsController?.abort(); this.ttsController = null; this.stopAudio(); for (const job of this.audioQueue.splice(0)) this.setAudioTurnState(job.turnId, 'error'); }
  dispose() { this.disposed = true; this.requestController?.abort(); this.requestController = null; this.cancelSpeech(); this.gain.disconnect(); this.analyser.disconnect(); this.messageSubscribers.clear(); this.audioStateSubscribers.clear(); this.setStatus('uninitialized'); }
}
