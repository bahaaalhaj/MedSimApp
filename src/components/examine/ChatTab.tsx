import { useEffect, useRef, useState } from 'react';
import type { ActivePatient } from '../../game/types';
import { POLYCLINIC_BED_INDEX } from '../../game/store';
import { getExistingConversation } from '../../voice/conversationStore';
import type { ConversationMessage } from '../../voice/conversation';

export function ChatTab({ patient }: { patient: ActivePatient }) {
  const patientName = patient.case.name;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [messages, setMessages] = useState<ReadonlyArray<ConversationMessage>>(() => getExistingConversation(POLYCLINIC_BED_INDEX)?.getMessages() ?? []);
  const [, setAudioRevision] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const conversation = getExistingConversation(POLYCLINIC_BED_INDEX);
    if (!conversation) return;
    setMessages(conversation.getMessages());
    const unsubscribeMessages = conversation.subscribeMessages((next) => setMessages(next));
    const unsubscribeAudio = conversation.subscribeAudioStates(() => setAudioRevision((value) => value + 1));
    return () => { unsubscribeMessages(); unsubscribeAudio(); };
  }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);
  const visible = messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  if (visible.length === 0) return <div className="plush" style={{ padding: 14, fontWeight: 700, color: 'var(--ink-2)' }}>No conversation yet. The transcript appears here as you talk to {patientName.split(' ')[0]} — and updates live during the consultation.</div>;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const text = draft.trim(); if (!text || sending) return;
    const conversation = getExistingConversation(POLYCLINIC_BED_INDEX);
    if (!conversation) { setSendError('Patient conversation is not ready. Close and reopen Examine, then retry.'); return; }
    setSending(true); setSendError(''); setDraft('');
    const accepted = await conversation.sendTextMessage(text, 'typed');
    if (!accepted) { setDraft(text); setSendError(`${conversation.getLastResponseError() || 'The local patient response failed.'} Your question was restored so you can retry.`); }
    setSending(false);
  };
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div ref={scrollRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto', paddingRight: 6 }}>
      {visible.map((message, index) => { const mine = message.role === 'user'; return <div key={index} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%', background: mine ? 'var(--sky)' : 'white', border: '3px solid var(--line)', borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding: '10px 14px', boxShadow: 'var(--plush-tiny)', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>{mine ? 'You' : patientName.split(' ')[0]}</div>
        {message.content}
        {!mine && message.audioTurnId && (() => { const conversation = getExistingConversation(POLYCLINIC_BED_INDEX); const audioState = conversation?.getAudioTurnState(message.audioTurnId); const queuePosition = conversation?.getAudioQueuePosition(message.audioTurnId); return <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', fontSize: 10 }}><span>Audio: {audioState ?? 'not requested'}{queuePosition ? ` · queue ${queuePosition}` : ''}</span>{audioState === 'playing' && <button type="button" onClick={() => conversation?.skipCurrentSpeech()} style={{ font: 'inherit' }}>Skip</button>}{(audioState === 'played' || audioState === 'error') && <button type="button" onClick={() => conversation?.replayTurn(message.audioTurnId!)} style={{ font: 'inherit' }}>Replay</button>}</div>; })()}
      </div>; })}
    </div>
    <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}><label htmlFor="patient-question" style={{ position: 'absolute', left: -10000 }}>Type a question for the patient</label><input id="patient-question" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={sending} placeholder={`Ask ${patientName.split(' ')[0]} a question…`} style={{ flex: 1, border: '3px solid var(--line)', borderRadius: 12, padding: '10px 12px', font: 'inherit' }} /><button type="submit" className="btn-plush primary" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Ask'}</button></form>
    {sendError && <div role="alert" style={{ color: 'var(--rose-deep)', fontWeight: 700 }}>{sendError}</div>}
  </div>;
}
