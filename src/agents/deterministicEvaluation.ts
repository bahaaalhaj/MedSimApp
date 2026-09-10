import type { CaseEvaluationInput, CriterionResult, VerdictBand } from './customTools';
import type { DebriefRequest } from './debriefRequest';

const CREDIT = { met: 1, 'partially-met': 0.5, missed: 0 } as const;

function band(ratio: number): VerdictBand {
  if (ratio >= 0.85) return 'excellent';
  if (ratio >= 0.7) return 'good';
  if (ratio >= 0.55) return 'satisfactory';
  if (ratio >= 0.4) return 'borderline';
  return 'clear-fail';
}

/**
 * Treat the model as an evidence matcher, never as the score calculator.
 * Unknown criteria are discarded, absent criteria become "missed / insufficient
 * evidence", and all raw/max/global values are recomputed from immutable rubric
 * weights. This is technical determinism, not clinical validation of the rubric.
 */
export function normalizeEvaluation(
  model: CaseEvaluationInput,
  request: DebriefRequest,
): CaseEvaluationInput {
  const groups = {
    data_gathering: request.rubric.data_gathering,
    clinical_management: request.rubric.clinical_management,
    interpersonal: request.rubric.interpersonal,
  };
  const returned = new Map(model.criteria.map((c) => [c.criterion_id, c]));
  const criteria: CriterionResult[] = [];
  const domain_scores = {} as CaseEvaluationInput['domain_scores'];

  for (const domain of Object.keys(groups) as Array<keyof typeof groups>) {
    let raw = 0;
    let max = 0;
    for (const rule of groups[domain]) {
      const candidate = returned.get(rule.criterion_id);
      const result: CriterionResult = candidate && candidate.domain === domain
        ? candidate
        : { criterion_id: rule.criterion_id, domain, verdict: 'missed', evidence: 'Insufficient evidence in the recorded encounter.', guideline_ref: rule.guideline_ref ?? null };
      max += rule.weight;
      raw += rule.weight * CREDIT[result.verdict];
      criteria.push({ ...result, guideline_ref: rule.guideline_ref ?? null });
    }
    domain_scores[domain] = { raw, max, verdict: band(max > 0 ? raw / max : 0) };
  }

  const totalRaw = Object.values(domain_scores).reduce((sum, x) => sum + x.raw, 0);
  const totalMax = Object.values(domain_scores).reduce((sum, x) => sum + x.max, 0);
  const global_rating = model.safety_breach ? 'clear-fail' : band(totalMax > 0 ? totalRaw / totalMax : 0);
  return { ...model, case_id: request.case_id, criteria, domain_scores, global_rating };
}
