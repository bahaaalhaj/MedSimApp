import { useState } from 'react';
import { store, POLYCLINIC_BED_INDEX } from '../../game/store';
import { getExistingConversation } from '../../voice/conversationStore';
import type { ActivePatient } from '../../game/types';

/** Predefined-history controls; the overlay keeps tab selection and closing state. */
export function HistoryTab({ patient }: { patient: ActivePatient }) {
  const clinicalCase = patient.case;
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState('');
  const asked = new Set(patient.askedQuestionIds);
  const answered = clinicalCase.anamnesis.filter((question) => asked.has(question.id));
  const unanswered = clinicalCase.anamnesis.filter((question) => !asked.has(question.id));

  if (clinicalCase.anamnesis.length === 0) return <div style={{ color: 'var(--ink-2)', fontWeight: 700 }}>No anamnesis questions for this case.</div>;

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {answered.map((question) => <div key={question.id} className="plush" style={{ padding: 12, background: question.relevant ? 'var(--mint)' : 'white', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink-2)' }}>You asked</div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{question.question}</div>
      <div style={{ marginTop: 4, fontSize: 14, fontStyle: 'italic' }}><strong>{clinicalCase.name.split(' ')[0]}:</strong> "{question.answer}"</div>
    </div>)}
    {unanswered.length === 0 ? <div className="plush" style={{ padding: 12, fontWeight: 700, color: 'var(--ink-2)' }}>All questions covered. Move on to ordering tests or making a diagnosis.</div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 8 }}>Ask</div>
      {unanswered.map((question) => <button key={question.id} type="button" className="tap btn-plush ghost" style={{ fontSize: 14, padding: '10px 14px', textAlign: 'left', fontWeight: 700 }} disabled={submittingId !== null} onClick={async () => {
        const conversation = getExistingConversation(POLYCLINIC_BED_INDEX);
        if (!conversation) { setQuestionError('Patient conversation is not ready. Close and reopen Examine, then retry.'); return; }
        setQuestionError('');
        setSubmittingId(question.id);
        const accepted = await conversation.sendTextMessage(question.question, 'predefined', question.id);
        if (!accepted) setQuestionError(conversation.getLastResponseError() || 'The local patient response failed. Please retry the question.');
        else store.askPolyclinicQuestion(question.id);
        setSubmittingId(null);
      }}>{submittingId === question.id ? 'Patient is responding…' : question.question}</button>)}
      {questionError && <div role="alert" style={{ color: 'var(--rose-deep)', fontWeight: 700 }}>{questionError}</div>}
    </div>}
  </div>;
}
