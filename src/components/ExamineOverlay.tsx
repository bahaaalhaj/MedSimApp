import { useEffect, useState } from 'react';
import { store, useGameState } from '../game/store';
import { getDiagnosisLabel } from '../data/cases';
import { ExaminationTab as ExaminationTabFeature } from './examine/ExaminationTab';
import { HistoryTab as HistoryTabFeature } from './examine/HistoryTab';
import { ChatTab as ChatTabFeature } from './examine/ChatTab';
import { InvestigationsTab } from './examine/InvestigationsTab';
import { ResultsTab } from './examine/ResultsTab';
import { DiagnosisTab } from './examine/DiagnosisTab';
import { PrescriptionTab } from './examine/PrescriptionTab';

type Tab = 'history' | 'chat' | 'examination' | 'tests' | 'results' | 'diagnose' | 'rx';

interface Props {
  onClose: () => void;
  onFinish: () => void;
  finishError?: string;
}

const diagLabel = (caseId: string, id: string): string => getDiagnosisLabel(caseId, id);

export function ExamineOverlay({ onClose, onFinish, finishError = '' }: Props) {
  const state = useGameState();
  const patient = state.polyclinic.patient;
  const [tab, setTab] = useState<Tab>('history');

  // Esc closes the overlay (matches keyboard convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!patient) return null;
  const c = patient.case;
  const asked = new Set(patient.askedQuestionIds);
  const ordered = new Set(patient.orderedTestIds);
  const completed = new Set(patient.completedTestIds);
  const submitted = patient.submittedDiagnosisId;

  const newResultsCount = patient.orderedTestIds.filter((id) => completed.has(id)).length;
  const rxCount = patient.prescriptions?.length ?? 0;
  const rxUnlocked = submitted !== null;

  const tabs: Array<{ id: Tab; label: string; badge?: number | string; disabled?: boolean }> = [
    { id: 'history', label: 'History', badge: `${asked.size}/${c.anamnesis.length}` },
    { id: 'chat', label: 'Chat' },
    { id: 'examination', label: 'Examination', badge: patient.examinationActions.length || undefined },
    { id: 'tests', label: 'Order tests' },
    { id: 'results', label: 'Results', badge: newResultsCount > 0 ? newResultsCount : undefined },
    { id: 'diagnose', label: 'Diagnose' },
    { id: 'rx', label: 'Rx', badge: rxCount > 0 ? rxCount : undefined, disabled: !rxUnlocked },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--layer-overlay)',
        background: 'rgba(43,30,22,0.40)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '36px 36px 24px',
        overflowY: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="plush-lg popin"
        style={{
          width: 'min(960px, 100%)',
          background: 'var(--paper)',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 60px)',
        }}
      >
        {/* Header strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 22px',
            background: 'var(--cream-2)',
            borderBottom: '3px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className="chip butter" style={{ fontSize: 11 }}>
              EXAMINE
            </span>
            <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.1 }}>{c.name}</h2>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-2)' }}>
              {c.age} · {c.gender === 'F' ? 'Female' : 'Male'}
            </span>
            <span
              className={`chip ${c.severity === 'critical' ? 'rose' : c.severity === 'urgent' ? 'peach' : 'mint'}`}
              style={{ fontSize: 11 }}
            >
              {c.severity}
            </span>
          </div>
          <button
            type="button"
            className="btn-plush ghost"
            onClick={onClose}
            style={{ fontSize: 13, padding: '8px 16px' }}
            title="Close (Esc)"
          >
            ✕ Close
          </button>
        </div>

        {/* Vitals strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 8,
            padding: '12px 22px',
            background: 'var(--cream)',
            borderBottom: '3px solid var(--line)',
          }}
        >
          <Vital icon="❤" label="HR" value={String(c.vitals.hr)} unit="bpm" tone="var(--rose)" />
          <Vital icon="⌥" label="BP" value={c.vitals.bp} unit="mmHg" tone="var(--peach)" />
          <Vital icon="○" label="SpO₂" value={`${c.vitals.spo2}`} unit="%" tone="var(--mint)" />
          <Vital icon="☼" label="Temp" value={c.vitals.temp.toFixed(1)} unit="°C" tone="var(--butter)" />
          <Vital icon="~" label="RR" value={String(c.vitals.rr)} unit="/min" tone="var(--sky)" />
        </div>

        {/* Tab strip */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 22px 0',
            borderBottom: '3px solid var(--line)',
            background: 'white',
          }}
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            const disabled = !!t.disabled;
            return (
              <button
                key={t.id}
                type="button"
                className="tap"
                onClick={() => !disabled && setTab(t.id)}
                disabled={disabled}
                title={disabled ? 'Submit a diagnosis first' : undefined}
                style={{
                  background: active ? 'var(--butter)' : 'white',
                  border: '3px solid var(--line)',
                  borderBottom: active ? '3px solid var(--butter)' : '3px solid var(--line)',
                  borderRadius: '14px 14px 0 0',
                  padding: '10px 16px',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  marginBottom: -3,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: 'inherit',
                  color: 'var(--ink)',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                {t.label}
                {t.badge !== undefined && (
                  <span
                    className="chip"
                    style={{ fontSize: 10, padding: '1px 7px', background: 'white' }}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          {finishError && (
            <div role="alert" style={{ padding: '10px 12px', marginBottom: 14, background: 'var(--rose)', border: '3px solid var(--line)', borderRadius: 12, fontWeight: 800 }}>
              {finishError}
            </div>
          )}
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--cream-2)',
              border: '3px solid var(--line)',
              borderRadius: 'var(--r-md)',
              boxShadow: 'var(--plush-tiny)',
              marginBottom: 18,
              fontSize: 14,
              fontWeight: 700,
              fontStyle: 'italic',
            }}
          >
            "{c.chiefComplaint}"
          </div>

          {tab === 'history' && <HistoryTabFeature patient={patient} onQuestionAccepted={(questionId) => store.askPolyclinicQuestion(questionId)} />}
          {tab === 'chat' && <ChatTabFeature patient={patient} />}
          {tab === 'examination' && <ExaminationTabFeature patient={patient} onRecordAction={(actionId) => store.recordExaminationAction(actionId)} />}
          {tab === 'tests' && (
            <InvestigationsTab
              patient={patient}
              currentClinic={state.polyclinic.clinic}
              onOrderTest={(testId, indication) => void store.orderPolyclinicTest(testId, indication)}
              onOrderPanel={(testIds) => testIds.forEach((id) => void store.orderPolyclinicTest(id))}
            />
          )}
          {tab === 'results' && <ResultsTab patient={patient} />}
          {tab === 'diagnose' && (
            <DiagnosisTab
              caseId={c.id}
              diagnosisOptions={c.diagnosisOptions}
              diagnosisResult={patient.diagnosisResult}
              diagnosisLabel={(diagnosisId) => diagLabel(c.id, diagnosisId)}
              onSubmitDiagnosis={(diagnosisId) => store.submitPolyclinicDiagnosis(diagnosisId)}
              onFinish={onFinish}
              onGoToRx={() => setTab('rx')}
              submitted={submitted}
            />
          )}
          {tab === 'rx' && (
            <PrescriptionTab
              caseId={c.id}
              prescriptions={patient.prescriptions}
              unlocked={rxUnlocked}
              onAddPrescription={(prescription) => store.addPolyclinicPrescription(prescription)}
              onFinish={onFinish}
            />
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: '10px 22px',
            borderTop: '3px solid var(--line)',
            background: 'var(--cream-2)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--ink-2)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Press Esc to close · {ordered.size} test{ordered.size === 1 ? '' : 's'} ordered</span>
          <span>{submitted ? `Diagnosis: ${diagLabel(c.id, submitted)}` : 'Diagnosis pending'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Vital chip ────────────────────────────────────────────────────

function Vital({
  icon,
  label,
  value,
  unit,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  unit: string;
  tone: string;
}) {
  return (
    <div
      style={{
        background: tone,
        border: '3px solid var(--line)',
        borderRadius: 12,
        padding: '6px 4px',
        textAlign: 'center',
        boxShadow: 'var(--plush-tiny)',
      }}
    >
      <div style={{ fontSize: 14 }}>{icon}</div>
      <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700 }}>
        {label} <span style={{ opacity: 0.6 }}>{unit}</span>
      </div>
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────

// ── Order Tests tab ───────────────────────────────────────────────

// ── Results tab ──────────────────────────────────────────────────

// ── Rx tab — prescription pad ─────────────────────────────────────
