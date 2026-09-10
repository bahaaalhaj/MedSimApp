import type { CaseInvestigation } from './types.ts';

export interface InvestigationEvaluationInput {
  investigations: CaseInvestigation[];
  orderedInvestigationIds: string[];
  correctlyInterpretedIds: string[];
}

export interface InvestigationEvaluation {
  selection: number;
  interpretation: number;
  stewardship: number;
  safety: number;
  total: number;
  missedEssentialIds: string[];
  harmfulOrderIds: string[];
  unscoreableIds: string[];
}

const percent = (earned: number, possible: number) => possible === 0 ? 100 : Math.round(100 * earned / possible);

/** Pure, deterministic scoring. Model-generated prose cannot change these
 * values. Unresolved records are reported but excluded from every score. */
export function evaluateInvestigations(input: InvestigationEvaluationInput): InvestigationEvaluation {
  const ordered = new Set(input.orderedInvestigationIds);
  const interpreted = new Set(input.correctlyInterpretedIds);
  const scoreable = input.investigations.filter((item) => item.scoreable && item.verificationStatus === 'source-verified');
  const selectable = scoreable.filter((item) => ['essential', 'useful'].includes(item.role));
  const selectionPossible = selectable.reduce((sum, item) => sum + (item.role === 'essential' ? 2 : 1), 0);
  const selectionEarned = selectable.reduce((sum, item) => sum + (ordered.has(item.testId) ? (item.role === 'essential' ? 2 : 1) : 0), 0);
  const orderedScoreable = scoreable.filter((item) => ordered.has(item.testId) && !['not-indicated', 'potentially-harmful'].includes(item.role));
  const interpretation = percent(orderedScoreable.filter((item) => interpreted.has(item.testId)).length, orderedScoreable.length);
  const stewardshipCandidates = scoreable.filter((item) => ['optional', 'not-indicated'].includes(item.role));
  const stewardship = percent(stewardshipCandidates.filter((item) => !ordered.has(item.testId)).length, stewardshipCandidates.length);
  const harmfulOrderIds = scoreable.filter((item) => item.role === 'potentially-harmful' && ordered.has(item.testId)).map((item) => item.testId);
  const safety = harmfulOrderIds.length ? 0 : 100;
  const selection = percent(selectionEarned, selectionPossible);
  return {
    selection, interpretation, stewardship, safety,
    total: Math.round(selection * 0.35 + interpretation * 0.35 + stewardship * 0.15 + safety * 0.15),
    missedEssentialIds: scoreable.filter((item) => item.role === 'essential' && !ordered.has(item.testId)).map((item) => item.testId),
    harmfulOrderIds,
    unscoreableIds: input.investigations.filter((item) => !item.scoreable || item.verificationStatus === 'unresolved').map((item) => item.testId),
  };
}
