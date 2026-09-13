/** Text-first AI patient conversation with local backend TTS playback. */
import { streamClaude, type ChatMessage } from './claude';

export type ConversationStatus = 'uninitialized' | 'loading' | 'ready' | 'thinking' | 'speaking' | 'error';
export type QuestionSource = 'typed' | 'predefined';

export interface SubtitleEvent {
  who: 'patient' | 'you';
  text: string;
}

export type PatientEmotion = 'neutral' | 'pain' | 'fear' | 'relief' | 'confused';

export interface ConversationListeners {
  onStatus?: (status: ConversationStatus, detail?: string) => void;
  onProgress?: (message: string) => void;
  onSubtitle?: (subtitle: SubtitleEvent) => void;
  onError?: (error: string) => void;
  onEmotion?: (emotion: PatientEmotion) => void;
}

export interface TranscriptRecord {
  role: 'trainee' | 'patient';
  content: string;
  timestampIso: string;
  questionSource: QuestionSource | null;
}

export interface ConversationOptions {
  systemPrompt: string;
  initialMessage: { role: 'assistant'; content: string };
  speakerGender: 'M' | 'F';
  isPediatric: boolean;
  caseId: string;
  onTranscript: (record: TranscriptRecord) => void;
}

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
  try {
    const parsed = Number(localStorage.getItem(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

export class Conversation {
  private messages: ChatMessage[];
  private listeners: ConversationListeners;
  private status: ConversationStatus = 'uninitialized';
  private readonly options: ConversationOptions;
  private readonly audioCtx: AudioContext;
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private ampBuf: Uint8Array;
  private source: AudioBufferSourceNode | null = null;
  private requestController: AbortController | null = null;
  private lastPatientText = '';
  private lastAudioError = '';
  private currentEmotion: PatientEmotion = 'neutral';
  private volume = Math.max(0, Math.min(1, readNumber(VOLUME_KEY, 0.85)));
  private muted = (() => { try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; } })();
  private messageSubscribers = new Set<(messages: ReadonlyArray<ChatMessage>) => void>();

  constructor(audioCtx: AudioContext, listeners: ConversationListeners, options: ConversationOptions) {
    this.audioCtx = audioCtx;
    this.listeners = listeners;
    this.options = options;
    this.messages = [options.initialMessage];
    this.gain = audioCtx.createGain();
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.55;
    this.gain.connect(this.analyser);
    this.analyser.connect(audioCtx.destination);
    this.ampBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.applyGain();
  }

  setListeners(listeners: ConversationListeners) { this.listeners = listeners; }
  getStatus() { return this.status; }
  getMessages(): ReadonlyArray<ChatMessage> { return [...this.messages]; }
  getCurrentEmotion() { return this.currentEmotion; }
  getVolume() { return this.volume; }
  isMuted() { return this.muted; }
  getLastPatientText() { return this.lastPatientText; }
  getLastAudioError() { return this.lastAudioError; }

  subscribeMessages(fn: (messages: ReadonlyArray<ChatMessage>) => void) {
    this.messageSubscribers.add(fn);
    return () => { this.messageSubscribers.delete(fn); };
  }

  private emitMessages() {
    const snapshot = [...this.messages];
    this.messageSubscribers.forEach((subscriber) => subscriber(snapshot));
  }

  private setStatus(status: ConversationStatus, detail?: string) {
    this.status = status;
    this.listeners.onStatus?.(status, detail);
  }

  private applyGain() { this.gain.gain.value = this.muted ? 0 : this.volume; }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
    try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch { /* non-fatal */ }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyGain();
    try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0'); } catch { /* non-fatal */ }
  }

  getMouthAmplitude(): number {
    if (!this.source || this.muted) return 0;
    this.analyser.getByteTimeDomainData(this.ampBuf as Uint8Array<ArrayBuffer>);
    let total = 0;
    for (const sample of this.ampBuf) {
      const centered = (sample - 128) / 128;
      total += centered * centered;
    }
    return Math.min(1, Math.sqrt(total / this.ampBuf.length) * 3.2);
  }

  async init() {
    if (this.status !== 'uninitialized') return;
    this.setStatus('loading');
    this.lastPatientText = this.options.initialMessage.content;
    this.currentEmotion = detectEmotion(this.lastPatientText);
    this.options.onTranscript({ role: 'patient', content: this.lastPatientText, timestampIso: new Date().toISOString(), questionSource: null });
    this.listeners.onSubtitle?.({ who: 'patient', text: this.lastPatientText });
    this.emitMessages();
    this.setStatus('ready');
    await this.synthesizeAndPlay(this.lastPatientText);
  }

  async sendTextMessage(text: string, source: QuestionSource = 'typed'): Promise<void> {
    const clean = text.trim();
    if (!clean || this.status === 'thinking') return;
    this.requestController?.abort();
    this.stopAudio();
    this.listeners.onSubtitle?.({ who: 'you', text: clean });
    this.messages.push({ role: 'user', content: clean });
    this.options.onTranscript({ role: 'trainee', content: clean, timestampIso: new Date().toISOString(), questionSource: source });
    this.emitMessages();
    this.setStatus('thinking', 'Patient is responding…');

    const controller = new AbortController();
    this.requestController = controller;
    let response = '';
    try {
      for await (const token of streamClaude(this.options.systemPrompt, this.messages, controller.signal)) response += token;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', message);
      this.listeners.onError?.(`Patient response failed: ${message}`);
      return;
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }

    const cleanResponse = response.trim();
    if (!cleanResponse) {
      this.setStatus('error', 'The patient returned an empty response.');
      return;
    }
    this.lastPatientText = cleanResponse;
    this.messages.push({ role: 'assistant', content: cleanResponse });
    this.options.onTranscript({ role: 'patient', content: cleanResponse, timestampIso: new Date().toISOString(), questionSource: null });
    this.currentEmotion = detectEmotion(cleanResponse);
    this.listeners.onEmotion?.(this.currentEmotion);
    this.listeners.onSubtitle?.({ who: 'patient', text: cleanResponse });
    this.emitMessages();
    this.setStatus('ready');
    await this.synthesizeAndPlay(cleanResponse);
  }

  async retrySpeech() {
    if (this.lastPatientText) await this.synthesizeAndPlay(this.lastPatientText);
  }

  async replayLastResponse() { await this.retrySpeech(); }

  private async synthesizeAndPlay(text: string, waitForEnd = false) {
    this.lastAudioError = '';
    this.listeners.onProgress?.('Generating local patient speech…');
    try {
      const response = await fetch('/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          caseId: this.options.caseId,
          gender: this.options.speakerGender,
          isPediatric: this.options.isPediatric,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || `Local speech request failed (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      const decoded = await this.audioCtx.decodeAudioData(buffer.slice(0));
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      this.stopAudio();
      const source = this.audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(this.gain);
      let resolvePlayback: (() => void) | null = null;
      const playbackDone = new Promise<void>((resolve) => { resolvePlayback = resolve; });
      source.onended = () => {
        if (this.source === source) {
          source.disconnect();
          this.source = null;
          this.setStatus('ready');
        }
        resolvePlayback?.();
      };
      this.source = source;
      this.setStatus('speaking');
      source.start();
      if (waitForEnd) await playbackDone;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastAudioError = message;
      this.setStatus('ready');
      this.listeners.onError?.(`Speech unavailable: ${message}`);
    }
  }

  private stopAudio() {
    const current = this.source;
    this.source = null;
    if (current) {
      current.onended = null;
      try { current.stop(); } catch { /* already stopped */ }
      current.disconnect();
    }
  }

  async sayFarewell() {
    const text = 'Thank you, doctor. Take care.';
    this.lastPatientText = text;
    this.messages.push({ role: 'assistant', content: text });
    this.options.onTranscript({ role: 'patient', content: text, timestampIso: new Date().toISOString(), questionSource: null });
    this.listeners.onSubtitle?.({ who: 'patient', text });
    this.emitMessages();
    await this.synthesizeAndPlay(text, true);
  }

  dispose() {
    this.requestController?.abort();
    this.requestController = null;
    this.stopAudio();
    this.gain.disconnect();
    this.analyser.disconnect();
    this.messageSubscribers.clear();
    this.setStatus('uninitialized');
  }
}
