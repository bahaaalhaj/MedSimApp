import { Conversation, type ConversationListeners } from './conversation';
import { buildInitialLine, isPediatric, parentGenderFor } from './patientPersona';
import type { LearnerPatientCase } from '../game/types';
import { store as gameStore } from '../game/store';

let sharedCtx: AudioContext | null = null;

export function ensureAudioContext(): AudioContext {
  if (!sharedCtx) {
    sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (sharedCtx.state === 'suspended') {
    // Best-effort resume. Must be called from a user gesture for this to
    // succeed — callers in the Walk-view panel are wired that way.
    sharedCtx.resume().catch(() => undefined);
  }
  return sharedCtx;
}

/** Cached conversation, keyed by bedIndex. Encounter identity is carried
 *  alongside so a new attempt cannot inherit the prior patient's history,
 *  pending requests, or voice even when it uses the same case and bed. */
interface CachedConversation {
  conv: Conversation;
  caseId: string;
  caseVersion: string;
  encounterKey: string;
}

const store = new Map<number, CachedConversation>();

/** Peek at an existing conversation without creating one. */
export function getExistingConversation(bedIndex: number): Conversation | null {
  return store.get(bedIndex)?.conv ?? null;
}

export function getOrCreatePatientConversation(
  bedIndex: number,
  patientCase: LearnerPatientCase,
  caseVersion: string,
  encounterKey: string,
  listeners: ConversationListeners
): Conversation {
  const existing = store.get(bedIndex);
  if (
    existing
    && existing.caseId === patientCase.id
    && existing.caseVersion === caseVersion
    && existing.encounterKey === encounterKey
  ) {
    existing.conv.setListeners(listeners);
    return existing.conv;
  }
  if (existing) {
    // A different patient now occupies this slot — tear down the old
    // conversation so the new persona isn't poisoned by prior history.
    existing.conv.dispose();
    store.delete(bedIndex);
  }
  const ctx = ensureAudioContext();
  // Pediatric encounters use the accompanying parent's adult voice.
  const speakerGender: 'M' | 'F' = isPediatric(patientCase)
    ? parentGenderFor(patientCase)
    : patientCase.gender;
  const conv = new Conversation(ctx, listeners, {
    initialMessage: buildInitialLine(patientCase),
    speakerGender,
    isPediatric: isPediatric(patientCase),
    caseId: patientCase.id,
    caseVersion,
    ensureAttempt: async () => {
      await gameStore.initializeInvestigationAttempt();
      const active = gameStore.getState().polyclinic.patient;
      if (
        !active
        || active.case.id !== patientCase.id
        || active.caseVersion !== caseVersion
        || active.variantSeed !== encounterKey
      ) return null;
      return active.investigationAttemptId;
    },
    onTranscript: (record) => {
      const active = gameStore.getState().polyclinic.patient;
      if (
        !active
        || active.case.id !== patientCase.id
        || active.caseVersion !== caseVersion
        || active.variantSeed !== encounterKey
      ) return;
      gameStore.appendTranscriptEntry({
        id: `${active.encounterAttemptId}-${active.transcript.length}-${Date.now()}`,
        ...record,
        caseId: active.case.id,
        caseVersion: active.caseVersion,
        attemptId: active.encounterAttemptId,
      });
    },
    onAuthorizedAnswer: (questionId, answer, relevant) => {
      gameStore.authorizePolyclinicAnswer(questionId, answer, relevant);
    },
  });
  store.set(bedIndex, { conv, caseId: patientCase.id, caseVersion, encounterKey });
  return conv;
}

export function disposePatientConversation(bedIndex: number) {
  const entry = store.get(bedIndex);
  if (entry) {
    entry.conv.dispose();
    store.delete(bedIndex);
  }
}

export function clearAllPatientConversations() {
  for (const entry of store.values()) entry.conv.dispose();
  store.clear();
  if (sharedCtx) {
    try { sharedCtx.close(); } catch { /* noop */ }
    sharedCtx = null;
  }
}

/** Remove legacy pre-text-first conversation cache entries. */
export function clearAllConversationStorage() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('conv_history_')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage may be blocked — non-fatal
  }
}
