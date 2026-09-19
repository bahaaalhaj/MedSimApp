import { Conversation, type ConversationListeners } from './conversation';
import { buildInitialLine, isPediatric, parentGenderFor } from './patientPersona';
import type { PatientCase } from '../game/types';
import { store as gameStore } from '../game/store';
import { caseVersionFor } from '../clinical/cases';

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

/** Cached conversation, keyed by bedIndex. `caseId` is carried alongside so
 *  we can detect when a bed (or the polyclinic sentinel -10) receives a
 *  different patient — in that case the old conversation is disposed and a
 *  fresh one is built for the new persona. Without this, the polyclinic's
 *  single sentinel bedIndex caused new patients to inherit the previous
 *  patient's name, history, and voice. */
interface CachedConversation {
  conv: Conversation;
  caseId: string;
}

const store = new Map<number, CachedConversation>();

/** Peek at an existing conversation without creating one. */
export function getExistingConversation(bedIndex: number): Conversation | null {
  return store.get(bedIndex)?.conv ?? null;
}

export function getOrCreatePatientConversation(
  bedIndex: number,
  patientCase: PatientCase,
  listeners: ConversationListeners
): Conversation {
  const existing = store.get(bedIndex);
  if (existing && existing.caseId === patientCase.id) {
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
    caseVersion: caseVersionFor(patientCase.id),
    ensureAttempt: async () => {
      await gameStore.initializeInvestigationAttempt();
      return gameStore.getState().polyclinic.patient?.investigationAttemptId ?? null;
    },
    onTranscript: (record) => {
      const active = gameStore.getState().polyclinic.patient;
      if (!active || active.case.id !== patientCase.id) return;
      gameStore.appendTranscriptEntry({
        id: `${active.encounterAttemptId}-${active.transcript.length}-${Date.now()}`,
        ...record,
        caseId: active.case.id,
        caseVersion: active.caseVersion,
        attemptId: active.encounterAttemptId,
      });
    },
  });
  store.set(bedIndex, { conv, caseId: patientCase.id });
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
