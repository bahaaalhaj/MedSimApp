import type { CaseEvaluationInput } from '../agents/customTools';
import type { ActivePatient } from '../game/types';
import { getAuthSnapshot } from '../auth/AuthProvider';
import { deleteAccountEncounter, getAccountEncounter, listAccountEncounters, saveAccountEncounter } from '../auth/authApi';

const LEGACY_STORAGE_KEY = 'gr_eval_history';
const MAX_ENTRIES = 100;

export interface EvalHistoryEntry {
  id: string;
  savedAt: number;
  caseId: string;
  caseName: string;
  caseAge: number;
  caseGender: 'M' | 'F';
  diagnosisLabel: string;
  verdict: CaseEvaluationInput['global_rating'];
  evaluation: CaseEvaluationInput;
  patientSnapshot: ActivePatient;
}

type NewEvalHistoryEntry = Omit<EvalHistoryEntry, 'id' | 'savedAt'>;

function guestKey(guestId: string): string {
  return `medsim:guest:${guestId}:eval-history`;
}

function readGuest(guestId: string): EvalHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(guestKey(guestId)) ?? '[]');
    return Array.isArray(parsed) ? parsed as EvalHistoryEntry[] : [];
  } catch {
    return [];
  }
}

function writeGuest(guestId: string, entries: EvalHistoryEntry[]): void {
  try {
    localStorage.setItem(guestKey(guestId), JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota or privacy mode failures should not interrupt a debrief.
  }
}

export async function listEvalHistory(): Promise<EvalHistoryEntry[]> {
  const auth = getAuthSnapshot();
  if (auth.status === 'authenticated') return listAccountEncounters<EvalHistoryEntry>();
  if (auth.status === 'guest' && auth.guestId) return readGuest(auth.guestId);
  return [];
}

export async function saveEvalHistory(payload: NewEvalHistoryEntry): Promise<EvalHistoryEntry> {
  const auth = getAuthSnapshot();
  if (auth.status === 'authenticated') return saveAccountEncounter<EvalHistoryEntry>(payload);
  if (auth.status === 'guest' && auth.guestId) {
    const entry: EvalHistoryEntry = { ...payload, id: `eh_${Date.now()}_${crypto.randomUUID()}`, savedAt: Date.now() };
    writeGuest(auth.guestId, [entry, ...readGuest(auth.guestId)]);
    return entry;
  }
  throw new Error('An authenticated or guest session is required to save progress.');
}

export async function deleteEvalHistory(id: string): Promise<void> {
  const auth = getAuthSnapshot();
  if (auth.status === 'authenticated') return deleteAccountEncounter(id);
  if (auth.status === 'guest' && auth.guestId) writeGuest(auth.guestId, readGuest(auth.guestId).filter((entry) => entry.id !== id));
}

export async function clearEvalHistory(): Promise<void> {
  const auth = getAuthSnapshot();
  if (auth.status === 'guest' && auth.guestId) writeGuest(auth.guestId, []);
  if (auth.status === 'authenticated') {
    const entries = await listAccountEncounters<EvalHistoryEntry>();
    await Promise.all(entries.map((entry) => deleteAccountEncounter(entry.id)));
  }
}

export async function getEvalHistory(id: string): Promise<EvalHistoryEntry | null> {
  const auth = getAuthSnapshot();
  if (auth.status === 'authenticated') return getAccountEncounter<EvalHistoryEntry>(id);
  if (auth.status === 'guest' && auth.guestId) return readGuest(auth.guestId).find((entry) => entry.id === id) ?? null;
  return null;
}

// Existing anonymous progress remains untouched and is never silently merged.
void LEGACY_STORAGE_KEY;
