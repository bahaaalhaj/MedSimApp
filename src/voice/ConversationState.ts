import type { PatientResponseProvenance } from './localPatient';
import type { ConversationListeners, ConversationMessage, ConversationStatus, PatientEmotion, QuestionSource } from './conversationTypes';

export type LastQuestion = { text: string; source: QuestionSource; questionId?: string };

export function canStartPatientText(status: ConversationStatus, requestBusy: boolean, audioBusy: boolean): boolean {
  return !requestBusy && !audioBusy && !['preparing', 'streaming'].includes(status);
}

/** Owns learner-visible dialogue state and subscriptions; it performs no I/O. */
export class ConversationState {
  private messages: ConversationMessage[];
  private listeners: ConversationListeners;
  private status: ConversationStatus = 'uninitialized';
  private lastPatientText = '';
  private lastAudioError = '';
  private lastResponseError = '';
  private lastQuestion: LastQuestion | null = null;
  private lastPatientProvenance: PatientResponseProvenance = 'deterministic-authored';
  private currentEmotion: PatientEmotion = 'neutral';
  private readonly messageSubscribers = new Set<(messages: ReadonlyArray<ConversationMessage>) => void>();

  constructor(initialMessage: ConversationMessage, listeners: ConversationListeners) {
    this.messages = [initialMessage];
    this.listeners = listeners;
  }

  setListeners(listeners: ConversationListeners) { this.listeners = listeners; }
  getListeners() { return this.listeners; }
  getStatus() { return this.status; }
  getMessages(): ReadonlyArray<ConversationMessage> { return [...this.messages]; }
  getLastPatientText() { return this.lastPatientText; }
  getLastAudioError() { return this.lastAudioError; }
  getLastResponseError() { return this.lastResponseError; }
  getLastQuestion() { return this.lastQuestion; }
  getLastPatientProvenance() { return this.lastPatientProvenance; }
  getCurrentEmotion() { return this.currentEmotion; }

  setStatus(status: ConversationStatus, detail?: string) { this.status = status; this.listeners.onStatus?.(status, detail); }
  setLastPatient(text: string, provenance: PatientResponseProvenance) { this.lastPatientText = text; this.lastPatientProvenance = provenance; }
  setLastAudioError(value: string) { this.lastAudioError = value; }
  setLastResponseError(value: string) { this.lastResponseError = value; }
  setLastQuestion(value: LastQuestion | null) { this.lastQuestion = value; }
  setEmotion(value: PatientEmotion, notify = true) { this.currentEmotion = value; if (notify) this.listeners.onEmotion?.(value); }
  pushMessage(message: ConversationMessage) { this.messages.push(message); this.emitMessages(); }
  popMessage() { this.messages.pop(); this.emitMessages(); }
  emitMessages() { const snapshot = [...this.messages]; this.messageSubscribers.forEach((fn) => fn(snapshot)); }
  subscribeMessages(fn: (messages: ReadonlyArray<ConversationMessage>) => void) { this.messageSubscribers.add(fn); return () => { this.messageSubscribers.delete(fn); }; }
  dispose() { this.messageSubscribers.clear(); this.setStatus('uninitialized'); }
}
