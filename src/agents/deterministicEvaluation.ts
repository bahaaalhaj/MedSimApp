import type { CaseEvaluationInput, CriterionResult, VerdictBand } from './evaluationSchema';
import type { DebriefRequest } from './debriefRequest';

const CREDIT = { met: 1, 'partially-met': 0.5, missed: 0 } as const;

function objectiveResult(rule: DebriefRequest['rubric']['data_gathering'][number], request: DebriefRequest, historyIndex: number): CriterionResult | null {
  const log = request.encounter_log;
  const domain = rule.source_domain;
  let verdict: CriterionResult['verdict'] = 'missed';
  let evidence = 'No matching objective encounter evidence was recorded.';
  let evidence_ids: string[] = [];
  if (domain === 'history') {
    const ids = log.history_questions_asked.map((item) => item.id);
    const focused = log.history_questions_asked.filter((item) => /chest|breath|weak|vision|headache|fever|collapse|blood|vomit/i.test(item.question)).map((item) => item.id);
    const used = historyIndex === 0 ? ids : focused;
    const target = historyIndex === 0 ? Math.min(3, Math.max(1, ids.length)) : 2;
    verdict = used.length >= target ? 'met' : used.length ? 'partially-met' : 'missed';
    evidence = used.length ? `Recorded history questions: ${used.join(', ')}.` : 'No matching history question was recorded.';
    evidence_ids = used.map((id) => `history:${id}`);
  } else if (domain === 'examination') {
    const ids = log.examinations_performed.map((item) => item.action_id);
    verdict = new Set(ids).size >= 2 ? 'met' : ids.length ? 'partially-met' : 'missed';
    evidence = ids.length ? `Recorded examination actions: ${ids.join(', ')}.` : 'No examination action was recorded.';
    evidence_ids = ids.map((id) => `examination:${id}`);
  } else if (domain === 'investigation') {
    const tests = log.tests_ordered;
    verdict = tests.some((item) => item.result_shown_to_trainee !== null) ? 'met' : tests.length ? 'partially-met' : 'missed';
    evidence = tests.length ? `Recorded investigations: ${tests.map((item) => item.test_id).join(', ')}.` : 'No investigation was recorded.';
    evidence_ids = tests.map((item) => `investigation:${item.test_id}`);
  } else if (domain === 'diagnosis') {
    const id = log.submitted_diagnosis_id;
    verdict = log.diagnosis_was_correct ? 'met' : 'missed';
    evidence = id ? `Recorded diagnosis: ${id}.` : 'No diagnosis was submitted.';
    evidence_ids = id ? [`diagnosis:${id}`] : [];
  } else if (domain === 'patient-safety') {
    const met = Boolean(log.safety_netting_checks?.safety_netting_completed);
    verdict = met ? 'met' : 'missed'; evidence = met ? 'Safety-netting was recorded.' : 'Safety-netting was not recorded.';
    evidence_ids = met ? ['completion:safety-netting'] : [];
  } else if (domain === 'communication') {
    const checks = log.safety_netting_checks;
    const count = Number(Boolean(checks?.summary_completed)) + Number(Boolean(checks?.ideas_concerns_expectations_completed));
    verdict = count === 2 ? 'met' : count ? 'partially-met' : 'missed';
    evidence = `${count} of 2 communication completion checks were recorded.`;
    evidence_ids = count ? ['completion:communication'] : [];
  } else return null;
  return { criterion_id: rule.criterion_id, title: rule.label, weight: rule.weight, domain: 'data_gathering', verdict, evidence, evidence_ids, guideline_ref: rule.guideline_ref ?? null };
}

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
  let historyIndex = 0;

  for (const domain of Object.keys(groups) as Array<keyof typeof groups>) {
    let raw = 0;
    let max = 0;
    for (const rule of groups[domain]) {
      const candidate = returned.get(rule.criterion_id);
      const objective = objectiveResult(rule, request, historyIndex);
      if (rule.source_domain === 'history') historyIndex += 1;
      const result: CriterionResult = objective ? { ...objective, domain } : candidate && candidate.domain === domain
        ? candidate
        : { criterion_id: rule.criterion_id, domain, verdict: 'missed', evidence: 'Insufficient evidence in the recorded encounter.', guideline_ref: rule.guideline_ref ?? null };
      max += rule.weight;
      raw += rule.weight * CREDIT[result.verdict];
      criteria.push({ ...result, title: rule.label, weight: rule.weight, guideline_ref: rule.guideline_ref ?? null });
    }
    domain_scores[domain] = { raw, max, verdict: band(max > 0 ? raw / max : 0) };
  }

  const totalRaw = Object.values(domain_scores).reduce((sum, x) => sum + x.raw, 0);
  const totalMax = Object.values(domain_scores).reduce((sum, x) => sum + x.max, 0);
  const criticalMissed = criteria.some((criterion) => request.critical_criterion_ids.includes(criterion.criterion_id) && criterion.verdict === 'missed');
  const safety_breach = criticalMissed
    ? { what: 'A mandatory patient-safety criterion was missed.', guideline_ref: null }
    : null;
  const global_rating = criticalMissed ? 'clear-fail' : band(totalMax > 0 ? totalRaw / totalMax : 0);
  return { ...model, case_id: request.case_id, criteria, domain_scores, safety_breach, global_rating };
}

/** Conservative browser fallback for total API/transport failure.
 * It never invents credit: every rubric criterion without authoritative
 * server evidence is marked missed, while preserving rubric weights. */
export function buildConservativeDeterministicEvaluation(
  request: DebriefRequest,
  errorCategory = 'evaluation-unavailable',
): CaseEvaluationInput {
  return normalizeEvaluation({
    case_id: request.case_id,
    global_rating: 'clear-fail',
    domain_scores: {
      data_gathering: { raw: 0, max: 0, verdict: 'clear-fail' },
      clinical_management: { raw: 0, max: 0, verdict: 'clear-fail' },
      interpersonal: { raw: 0, max: 0, verdict: 'clear-fail' },
    },
    criteria: [],
    safety_breach: null,
    highlights: [],
    improvements: ['Review the recorded encounter evidence with an educator; hosted semantic enrichment was unavailable.'],
    narrative: 'A conservative deterministic debrief was generated from the captured rubric. Unverified criteria receive no credit; no model-generated clinical facts were used.',
    generation: {
      mode: 'deterministic-fallback', error_category: errorCategory,
      provider: 'browser-deterministic', configured_model: null, actual_model: null,
      request_id: crypto.randomUUID(),
    },
  }, request);
}
