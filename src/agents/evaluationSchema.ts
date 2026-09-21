import { z } from 'zod';

export const verdictBand = z.enum(['clear-fail', 'borderline', 'satisfactory', 'good', 'excellent']);
const domainScore = z.object({ raw: z.number(), max: z.number(), verdict: verdictBand });
export const criterionResult = z.object({
  criterion_id: z.string().min(1),
  title: z.string().min(1).optional(),
  weight: z.number().nonnegative().optional(),
  domain: z.enum(['data_gathering', 'clinical_management', 'interpersonal']),
  verdict: z.enum(['met', 'partially-met', 'missed']),
  evidence: z.string().min(1),
  evidence_ids: z.array(z.string()).optional(),
  guideline_ref: z.string().nullable().optional(),
});
const safetyBreach = z.object({ what: z.string().min(1), guideline_ref: z.string().nullable().optional() });
const generation = z.object({
  mode: z.enum(['model-assisted', 'local-assisted', 'deterministic-fallback']),
  error_category: z.string().nullable(),
  provider: z.string(),
  configured_model: z.string().nullable(),
  actual_model: z.string().nullable(),
  request_id: z.string(),
});
const postSubmissionReference = z.object({
  referenceId: z.string(),
  organization: z.string(),
  title: z.string(),
  publicationYear: z.number(),
  version: z.string().optional(),
  url: z.string(),
  accessedAt: z.string(),
  verificationStatus: z.enum(['unverified', 'source-verified', 'clinician-verified', 'superseded']),
});

/** The browser validates the backend result again before rendering or persisting it. */
export const caseEvaluationInput = z.object({
  case_id: z.string().min(1),
  global_rating: verdictBand,
  domain_scores: z.object({
    data_gathering: domainScore,
    clinical_management: domainScore,
    interpersonal: domainScore,
  }),
  criteria: z.array(criterionResult),
  safety_breach: safetyBreach.nullable().optional(),
  highlights: z.array(z.string()),
  improvements: z.array(z.string()),
  narrative: z.string().min(1),
  generation,
  post_submission: z.object({
    correctDiagnosis: z.object({ diagnosisId: z.string(), label: z.string() }),
    references: z.array(postSubmissionReference),
  }).nullable().optional(),
  diagnosis_result: z.object({
    submitted_diagnosis_id: z.string().nullable(),
    correct_diagnosis_id: z.string(),
    diagnosis_was_correct: z.boolean(),
  }).optional(),
});

export type CaseEvaluationInput = z.infer<typeof caseEvaluationInput>;
export type CriterionResult = z.infer<typeof criterionResult>;
export type DomainScore = z.infer<typeof domainScore>;
export type VerdictBand = z.infer<typeof verdictBand>;
