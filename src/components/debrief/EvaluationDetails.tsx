import { ActionChips } from './ActionChips';
import { CriterionCard, type CriterionCitation } from './CriterionCard';
import { DomainRing } from './DomainRing';
import type { CaseEvaluationInput, CriterionResult } from '../../agents/evaluationSchema';
import type { ActivePatient, LearnerPatientCase } from '../../game/types';

interface EvaluationDetailsProps {
  evaluation: CaseEvaluationInput;
  patient: ActivePatient;
  c: LearnerPatientCase;
  resolveCitation: (guidelineRef: string | null | undefined) => CriterionCitation | undefined;
}

/** Renders learner-visible evaluation detail from values already resolved by the debrief screen. */
export function EvaluationDetails({ evaluation, patient, c, resolveCitation }: EvaluationDetailsProps) {
  const dgItems = evaluation.criteria.filter((x) => x.domain === 'data_gathering');
  const cmItems = evaluation.criteria.filter((x) => x.domain === 'clinical_management');
  const ipItems = evaluation.criteria.filter((x) => x.domain === 'interpersonal');
  const labelByCriterionId = new Map<string, string>();
  const elapsedSec = patient.arrivedAt ? Math.round((Date.now() - patient.arrivedAt) / 1000) : 0;
  const elapsedLabel = `${Math.floor(elapsedSec / 60)} min ${elapsedSec % 60} sec`;
  const postSubmission = evaluation.post_submission;

  return (
    <>
      <div className="plush" style={{ padding: 18, marginBottom: 22 }}>
        <SectionLabel>DOMAIN SCORES</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {evaluation.domain_scores.data_gathering.max > 0 && <DomainRing label="Data Gathering" score={evaluation.domain_scores.data_gathering} />}
          {evaluation.domain_scores.clinical_management.max > 0 && <DomainRing label="Clinical Management" score={evaluation.domain_scores.clinical_management} />}
          {evaluation.domain_scores.interpersonal.max > 0 && <DomainRing label="Interpersonal" score={evaluation.domain_scores.interpersonal} />}
        </div>
        <div className="chip" style={{ marginTop: 12 }}>{evaluation.generation.mode === 'model-assisted' ? 'Model-assisted feedback' : 'Deterministic evidence grading'}</div>
      </div>

      {(dgItems.length + cmItems.length + ipItems.length) > 0 && (
        <div className="plush" style={{ padding: 18, marginBottom: 22 }}>
          <SectionLabel>PER-CRITERION</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {dgItems.length > 0 && <CriterionGroup title="Data gathering" items={dgItems} labelMap={labelByCriterionId} resolveCitation={resolveCitation} />}
            {cmItems.length > 0 && <CriterionGroup title="Clinical management" items={cmItems} labelMap={labelByCriterionId} resolveCitation={resolveCitation} />}
            {ipItems.length > 0 && <CriterionGroup title="Interpersonal" items={ipItems} labelMap={labelByCriterionId} resolveCitation={resolveCitation} />}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 22 }}>
        {evaluation.highlights.length > 0 && (
          <div className="plush" style={{ background: 'var(--mint)', padding: 16 }}>
            <div className="chip" style={{ background: 'white', marginBottom: 10 }}>{'\u2713 HIGHLIGHTS'}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 700, fontSize: 14, lineHeight: 1.6 }}>
              {evaluation.highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}
        {evaluation.improvements.length > 0 && (
          <div className="plush" style={{ background: 'var(--peach)', padding: 16 }}>
            <div className="chip" style={{ background: 'white', marginBottom: 10 }}>{'\u2191 NEXT TIME'}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 700, fontSize: 14, lineHeight: 1.6 }}>
              {evaluation.improvements.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="plush" style={{ padding: 16, marginBottom: 22 }}>
        <SectionLabel>ACTIONS YOU TOOK</SectionLabel>
        <ActionChips patient={patient} c={c} />
      </div>

      {postSubmission && (
        <div className="plush" style={{ padding: 16, marginBottom: 22 }}>
          <SectionLabel>CASE VERSION &amp; SOURCES</SectionLabel>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 10 }}>
            Case {evaluation.case_id} v{patient.caseVersion} {'\u00B7'} rubric v{patient.rubricVersion} {'\u00B7'} Educational case {'\u00B7'} Source-backed formative case
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {postSubmission.references.map((reference) => (
              <a key={reference.referenceId} href={reference.url} target="_blank" rel="noreferrer" className="plush" style={{ padding: 10, color: 'var(--ink)', textDecoration: 'none', fontSize: 12 }}>
                <strong>{reference.organization}: {reference.title}</strong>
                <div style={{ color: 'var(--ink-2)', marginTop: 3 }}>{reference.version ?? reference.publicationYear} {'\u00B7'} {reference.verificationStatus} {'\u00B7'} accessed {reference.accessedAt}</div>
              </a>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', marginTop: 10 }}>
            Source verification confirms metadata and link provenance; it does not constitute clinical approval of this case.
          </div>
        </div>
      )}

      <div className="plush" style={{ padding: 16, marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Encounter</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>
            {`${elapsedLabel} \u00B7 ${patient.askedQuestionIds.length} history questions \u00B7 ${patient.orderedTestIds.length} tests \u00B7 ${patient.givenTreatmentIds.length} treatments`}
          </div>
        </div>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 14 }}>{children}</div>;
}

function CriterionGroup({ title, items, labelMap, resolveCitation }: { title: string; items: CriterionResult[]; labelMap: Map<string, string>; resolveCitation: EvaluationDetailsProps['resolveCitation'] }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink-2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((cr) => {
          const label = cr.title ?? labelMap.get(cr.criterion_id) ?? 'Assessment criterion';
          const cite = resolveCitation(cr.guideline_ref);
          return (
            <div key={cr.criterion_id}>
              <CriterionCard status={cr.verdict} text={label} evidence={cr.evidence} cite={cite} />
              <details style={{ marginLeft: 48, marginTop: -6, fontSize: 10, color: 'var(--ink-2)' }}>
                <summary>Technical evidence</summary>
                <div>ID: {cr.criterion_id}{cr.weight !== undefined ? ` \u00B7 weight ${cr.weight}` : ''}</div>
                {cr.evidence_ids?.length ? <div>{cr.evidence_ids.join(', ')}</div> : null}
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
