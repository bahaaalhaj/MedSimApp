import { store, type useGameState } from '../../game/store';

type Patient = NonNullable<ReturnType<typeof useGameState>['polyclinic']['patient']>;

export function ExaminationTab({ patient }: { patient: Patient }) {
  const actions = [
    { id: 'general-observation', label: 'General observation', detail: 'Record a general visual assessment.' },
    { id: 'record-vital-signs', label: 'Review vital signs', detail: 'Record review of the displayed observations.' },
    { id: 'focused-examination', label: 'Focused examination', detail: 'Record a focused physical examination. Detailed findings are not modeled.' },
  ];
  const recorded = new Set(patient.examinationActions.map((item) => item.actionId));
  return <div style={{ display: 'grid', gap: 10 }}>
    <p style={{ margin: 0, fontWeight: 700 }}>Choose each examination action you performed. This records the action without inventing findings.</p>
    {actions.map((action) => <button key={action.id} type="button" className="btn-plush ghost" disabled={recorded.has(action.id)} onClick={() => store.recordExaminationAction(action.id)} style={{ textAlign: 'left', padding: 14 }}>
      <strong>{recorded.has(action.id) ? 'Recorded: ' : ''}{action.label}</strong><br /><span style={{ fontSize: 12 }}>{action.detail}</span>
    </button>)}
  </div>;
}
