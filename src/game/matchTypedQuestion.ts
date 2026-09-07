import type { AnamnesisQA } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'are', 'can', 'could', 'did', 'do', 'does', 'have', 'has', 'how',
  'i', 'is', 'it', 'me', 'of', 'please', 'the', 'there', 'to', 'was', 'were',
  'what', 'when', 'where', 'which', 'with', 'would', 'you', 'your',
]);

function tokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

export interface TypedQuestionMatch {
  question: AnamnesisQA;
  confidence: number;
}

/** Conservative lexical matcher for the no-model interview path. It only
 * reveals an authored answer and abstains when there is no meaningful overlap. */
export function matchTypedQuestion(
  input: string,
  candidates: AnamnesisQA[],
): TypedQuestionMatch | null {
  const inputTokens = tokens(input);
  if (inputTokens.size === 0) return null;

  const ranked = candidates
    .map((question) => {
      const candidateTokens = tokens(question.question);
      const overlap = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
      const confidence = overlap / Math.max(1, new Set([...inputTokens, ...candidateTokens]).size);
      return { question, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);

  return ranked[0] && ranked[0].confidence > 0 ? ranked[0] : null;
}

