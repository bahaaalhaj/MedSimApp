import type { LearnerPatientCase } from '../game/types';

const PEDIATRIC_AGE_THRESHOLD = 14;

export function isPediatric(c: LearnerPatientCase): boolean {
  return c.age < PEDIATRIC_AGE_THRESHOLD;
}

/** Stable parent gender shared by the scene and Kokoro voice selection. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function parentGenderForId(caseId: string): 'M' | 'F' {
  return hashString(`${caseId}-parent`) % 2 === 0 ? 'F' : 'M';
}

export function parentGenderFor(c: LearnerPatientCase): 'M' | 'F' {
  return parentGenderForId(c.id);
}

/**
 * Public, deterministic opening line. The backend independently constructs
 * the same line when it creates the owner-bound attempt. No persona, hidden
 * case facts, or model configuration is built or accepted in the browser.
 */
export function buildInitialLine(c: LearnerPatientCase) {
  const complaint = c.chiefComplaint.trim();
  const naturalComplaint = complaint
    ? complaint[0].toLowerCase() + complaint.slice(1)
    : 'I have not been feeling well.';
  return {
    role: 'assistant' as const,
    content: `Hello, doctor. I came in because ${naturalComplaint}`,
  };
}
