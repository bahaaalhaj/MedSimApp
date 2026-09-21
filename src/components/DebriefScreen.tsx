import { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './primitives';
import { type CriterionCitation } from './debrief/CriterionCard';
import { StatusBanner } from './debrief/StatusBanner';
import { GradingProgress } from './debrief/GradingProgress';
import { SafetyBreachBanner } from './debrief/SafetyBreachBanner';
import { VerdictCard } from './debrief/VerdictCard';
import { EvaluationDetails } from './debrief/EvaluationDetails';
import { store, useGameState } from '../game/store';
import { getDiagnosisLabel, getPatientCase } from '../data/cases';
import { getRecommendation } from '../data/guidelines';
import { useLocalDebrief } from '../agents/useLocalDebrief';
import { buildDebriefRequest, summariseRequest } from '../agents/debriefRequest';
import { saveEvalHistory, getEvalHistory, type EvalHistoryEntry } from '../data/evalHistory';
import type {
  CaseEvaluationInput,
} from '../agents/evaluationSchema';
import type { ActivePatient, LearnerPatientCase } from '../game/types';

// ── verdict / colour mapping ───────────────────────────────────────

// ── DomainRing — adapted to take real data + verdict ──────────────

// ── Criterion — adapted to take CriterionResult + resolved cite ────

function buildCite(guidelineRef: string | null | undefined): CriterionCitation | undefined {
  if (!guidelineRef) return undefined;
  const r = getRecommendation(guidelineRef);
  if (!r) return undefined;
  const tags: string[] = [];
  if (r.rec.recClass) tags.push(`Class ${r.rec.recClass}`);
  if (r.rec.lev) tags.push(`LoE ${r.rec.lev}`);
  if (r.rec.gradeStrength) {
    tags.push(
      r.rec.gradeCertainty
        ? `${r.rec.gradeStrength} \u00B7 ${r.rec.gradeCertainty}`
        : r.rec.gradeStrength,
    );
  }
  return {
    title: `${r.guideline.body} ${r.guideline.year} \u00B7 ${r.guideline.title.split(/[\u2014:(]/)[0].trim()}`,
    rec: r.rec.text,
    loE: tags.length > 0 ? tags.join(' \u00B7 ') : `${r.guideline.body} ${r.guideline.year}`,
    url: r.guideline.url,
  };
}

// ── Action chips — derived from the encounter ─────────────────────

// ── Status banners (loading, error, empty) ─────────────────────────

// ── Live grading progress — animated step-by-step banner ───────────

// ── DebriefScreen ──────────────────────────────────────────────────

export function DebriefScreen() {
  const state = useGameState();

  // Review-mode: when viewedEvalHistoryId is set, render a saved evaluation
  // from the active identity's progress repository instead of running the
  // agent against a fresh request.
  const [reviewed, setReviewed] = useState<EvalHistoryEntry | null>(null);
  const [reviewLoading, setReviewLoading] = useState(Boolean(state.viewedEvalHistoryId));
  useEffect(() => {
    let active = true;
    if (!state.viewedEvalHistoryId) {
      setReviewed(null);
      setReviewLoading(false);
      return;
    }
    setReviewLoading(true);
    void getEvalHistory(state.viewedEvalHistoryId)
      .then((entry) => {
        if (active) setReviewed(entry);
      })
      .catch(() => {
        if (active) setReviewed(null);
      })
      .finally(() => {
        if (active) setReviewLoading(false);
      });
    return () => { active = false; };
  }, [state.viewedEvalHistoryId]);

  // Prefer the snapshot captured by `finishPolyclinicCase` — by the time we
  // mount, the live patient slot has been cleared so the 3D scene can play
  // the walk-out animation. Fall back to a still-seated patient (rare:
  // the screen was opened directly without ending the encounter).
  const patient = reviewed?.patientSnapshot ?? state.lastEncounter ?? state.polyclinic.patient;
  const c = useMemo<LearnerPatientCase | null>(() => {
    return patient?.case ?? (state.selectedCaseId ? getPatientCase(state.selectedCaseId) : null) ?? null;
  }, [patient, state.selectedCaseId]);

  // In review mode, skip the agent — we already have the evaluation.
  const debriefRequest = useMemo(() => {
    if (reviewed || state.viewedEvalHistoryId) return null;
    if (!c || !patient) return null;
    return buildDebriefRequest(c, patient);
  }, [reviewed, state.viewedEvalHistoryId, c, patient]);

  const live = useLocalDebrief(debriefRequest);
  const status = reviewed ? ('got-evaluation' as const) : live.status;
  const evaluation = reviewed?.evaluation ?? live.evaluation;
  const error = live.error;
  const partialNarration = live.partialNarration;

  // Persist the evaluation the FIRST time it arrives in this session.
  const savedRef = useRef(false);
  useEffect(() => {
    if (reviewed) return;
    if (savedRef.current) return;
    if (!evaluation || !patient || !c) return;
    savedRef.current = true;
    const dxId = patient.submittedDiagnosisId ?? evaluation.diagnosis_result?.correct_diagnosis_id ?? '';
    void saveEvalHistory({
      caseId: c.id,
      caseName: c.name,
      caseAge: c.age,
      caseGender: c.gender,
      diagnosisLabel: dxId ? getDiagnosisLabel(c.id, dxId) : 'Diagnosis not submitted',
      verdict: evaluation.global_rating,
      evaluation,
      patientSnapshot: patient,
      caseVersion: patient.caseVersion,
      rubricVersion: patient.rubricVersion,
      variantSeed: patient.variantSeed,
    }).catch(() => {
      // The debrief remains usable if persistence is temporarily unavailable.
    });
  }, [evaluation, patient, c, reviewed]);

  // Clear review mode when the user navigates away from this screen.
  useEffect(() => {
    return () => {
      if (state.viewedEvalHistoryId) store.clearViewedEval();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen paper" style={{ overflowY: 'auto' }}>
      <TopBar here={5} steps={['Polyclinic', 'GP', 'Case', 'Brief', 'Encounter', 'Debrief']} />

      <div style={{ padding: '28px 36px 60px', maxWidth: 1080, margin: '0 auto' }}>
        {reviewLoading ? (
          <StatusBanner title="Loading saved review…" body="Retrieving this review from your private training history." bg="var(--sky)" />
        ) : !c || !patient ? (
          <StatusBanner
            title="No active case to debrief"
            body="The encounter has already been cleared. Pick a new case from the library to start fresh."
            bg="var(--cream-2)"
          />
        ) : status === 'starting' || status === 'idle' ? (
          <StatusBanner
            title={'Preparing your debrief\u2026'}
            body={`Packaging encounter evidence (${summarise(debriefRequest)}). Deterministic grading and local feedback will start in a moment.`}
            bg="var(--sky)"
          />
        ) : status === 'streaming' && !evaluation ? (
          <GradingProgress partialNarration={partialNarration} />
        ) : status === 'error' ? (
          <StatusBanner
            title={'We couldn\u2019t generate your debrief'}
            body={error ?? 'Unknown error. The encounter is still saved \u2014 try again from the home screen.'}
            bg="var(--rose)"
          />
        ) : evaluation ? (
          <EvaluationBody evaluation={evaluation} patient={patient} c={c} />
        ) : (
          <StatusBanner
            title="No evaluation yet"
            body={'No evaluation was returned. Check the local backend health and retry the encounter.'}
            bg="var(--cream-2)"
          />
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
          <button
            type="button"
            className="btn-plush ghost"
            style={{ flex: 1 }}
            onClick={() => store.setScreen('gpRoom')}
          >
            {'\u2190 Back to polyclinic'}
          </button>
          <button
            type="button"
            className="btn-plush primary"
            style={{ flex: 1.6 }}
            onClick={() => store.setScreen('library')}
          >
            {'Next case \u2192'}
          </button>
        </div>
      </div>
    </div>
  );
}

function summarise(req: ReturnType<typeof buildDebriefRequest> | null): string {
  if (!req) return 'no data';
  const s = summariseRequest(req);
  return `${s.criterion_count} criteria \u00B7 ${s.guideline_count} guideline${s.guideline_count === 1 ? '' : 's'} \u00B7 ${s.rec_count} recs`;
}

// ── EvaluationBody — renders the full cozy debrief from real data ──

interface BodyProps {
  evaluation: CaseEvaluationInput;
  patient: ActivePatient;
  c: LearnerPatientCase;
}

function EvaluationBody({ evaluation, patient, c }: BodyProps) {
  const verdict = evaluation.global_rating;
  return (
    <>
      {evaluation.safety_breach && (
        <SafetyBreachBanner
          description={evaluation.safety_breach.what}
          cite={evaluation.safety_breach.guideline_ref ? buildCite(evaluation.safety_breach.guideline_ref) : undefined}
        />
      )}
      <VerdictCard verdict={verdict} narrative={evaluation.narrative} />

      <EvaluationDetails evaluation={evaluation} patient={patient} c={c} resolveCitation={buildCite} />

    </>
  );
}
