import { CLINICAL_CASE_BY_ID } from './cases.ts';

export interface GeneratedVariant {
  seed: string;
  displayName: string;
  age: number;
  complaint: string;
  difficulty: 'introductory' | 'intermediate' | 'advanced';
}

function seeded(seedText: string): () => number {
  let seed = 2166136261 >>> 0;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateControlledVariant(caseId: string, seed: string): GeneratedVariant | null {
  const c = CLINICAL_CASE_BY_ID.get(caseId);
  if (!c?.variantPolicy) return null;
  const rand = seeded(`${caseId}:${c.caseVersion}:${seed}`);
  const policy = c.variantPolicy;
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  return {
    seed,
    displayName: pick(policy.allowedDisplayNames),
    age: policy.ageRange.min + Math.floor(rand() * (policy.ageRange.max - policy.ageRange.min + 1)),
    complaint: pick(policy.allowedComplaintPhrasings),
    difficulty: pick(policy.difficultyOptions),
  };
}
