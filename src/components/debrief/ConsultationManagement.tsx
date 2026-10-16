import type { ConsultationManagementAssessment } from '../../agents/evaluationSchema';

const titles: Record<ConsultationManagementAssessment['indicators'][number]['id'], string> = {
  'focused-questioning': 'Focused questioning',
  'repetition-review': 'Repetition review',
  'priority-sequencing': 'Priority sequencing',
  'plan-and-safety': 'Plan and safety',
};
const labels = {
  documented: 'Recorded evidence',
  'review-recommended': 'Review recommended',
  'not-assessable': 'Not assessable',
  'partial-evidence': 'Partial evidence',
};

/** Render server observations, never infer competence or scores in the browser. */
export function ConsultationManagement({ assessment }: { assessment?: ConsultationManagementAssessment }) {
  if (!assessment) return null;
  return (
    <section className="plush" aria-label="Consultation management" style={{ padding: 18, marginBottom: 22 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Consultation management</h3>
      <div className="chip" style={{ marginBottom: 10 }}>{labels[assessment.overall]}</div>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-2)' }}>
        Formative observations; clinical marks unchanged. Elapsed time is context only, not a speed bonus or penalty.
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 12 }}>
        {assessment.indicators.map((indicator) => (
          <li key={indicator.id}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <strong>{titles[indicator.id]}</strong>
              <span className="chip" style={{ fontSize: 11,
                background: indicator.status === 'documented' ? 'var(--mint)' : indicator.status === 'review-recommended' ? 'var(--peach)' : 'var(--cream)' }}>
                {labels[indicator.status]}
              </span>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 12, lineHeight: 1.5 }}>{indicator.evidence}</p>
          </li>
        ))}
      </ol>
      <details style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-2)' }}>
        <summary>Evidence limits</summary>
        <ul style={{ paddingLeft: 20 }}>{assessment.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </details>
    </section>
  );
}
