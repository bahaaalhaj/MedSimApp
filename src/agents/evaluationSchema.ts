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

export const consultationManagementAssessment = z.object({
  version: z.literal('1.0.0'),
  mode: z.literal('formative-observation'),
  affects_clinical_score: z.literal(false),
  time_policy: z.literal('context-only'),
  overall: z.enum(['documented', 'review-recommended', 'partial-evidence']),
  indicators: z.array(z.object({
    id: z.enum(['focused-questioning', 'repetition-review', 'priority-sequencing', 'plan-and-safety']),
    status: z.enum(['documented', 'review-recommended', 'not-assessable']),
    evidence: z.string().min(1).max(1000),
    counts: z.record(z.number().int().nonnegative()),
    evidence_refs: z.array(z.string().max(160)).max(64),
  }).strict()).length(4).refine((rows) => new Set(rows.map((row) => row.id)).size === 4),
  limitations: z.array(z.string().max(500)).max(8),
}).strict();

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
  assessment_scope: z.object({
    policy: z.literal('examination-excluded-v1'),
    excluded_criteria: z.array(z.object({
      criterion_id: z.string().min(1), title: z.string().min(1),
      domain: z.enum(['data_gathering', 'clinical_management', 'interpersonal']),
      original_weight: z.number().nonnegative(), reason: z.string().min(1),
    })),
  }).optional(),
  safety_breach: safetyBreach.nullable().optional(),
  highlights: z.array(z.string()),
  improvements: z.array(z.string()),
  narrative: z.string().min(1),
  generation,
  consultation_management: consultationManagementAssessment.optional(),
  consultation_timing: z.object({
    elapsed_ms: z.number().finite().nonnegative(),
    elapsed_minutes: z.number().finite().nonnegative(),
    source: z.literal('client-observed'),
    scored: z.literal(false),
  }).optional(),
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
export type ConsultationManagementAssessment = z.infer<typeof consultationManagementAssessment>;
