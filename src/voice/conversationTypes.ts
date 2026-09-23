import type { ChatMessage, PatientResponseProvenance } from './localPatient';

export type ConversationStatus = 'uninitialized' | 'loading' | 'ready' | 'preparing' | 'streaming' | 'audio-preparing' | 'speaking' | 'error';
export type QuestionSource = 'typed' | 'predefined';
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
  onAuthorizedAnswer: (questionId: string, answer: string, relevant: boolean) => void;
}
