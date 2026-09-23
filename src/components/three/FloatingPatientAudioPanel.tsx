import { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { ActivePatient } from '../../game/types';
import type { ConversationStatus, SubtitleEvent } from '../../voice/conversation';
import { getOrCreatePatientConversation } from '../../voice/conversationStore';

interface Props {
  bedPosition: [number, number, number];
  bedRotationY?: number;
  headOffset?: [number, number, number];
  patient: ActivePatient;
}

export function FloatingPatientAudioPanel({ bedPosition, bedRotationY = 0, headOffset, patient }: Props) {
  const [status, setStatus] = useState<ConversationStatus>('uninitialized');
  const [subtitle, setSubtitle] = useState<SubtitleEvent>({ who: 'patient', text: patient.case.chiefComplaint });
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const listenersRef = useRef({
    onStatus: (next: ConversationStatus) => setStatus(next),
    onProgress: () => setError(''),
    onSubtitle: (next: SubtitleEvent) => { if (next.who === 'patient') setSubtitle(next); },
    onError: (message: string) => setError(message),
  });

  useEffect(() => {
    let cancelled = false;
    const conversation = getOrCreatePatientConversation(
      patient.bedIndex,
      patient.case,
      patient.caseVersion,
      patient.variantSeed,
      listenersRef.current
    );
    setStatus(conversation.getStatus());
    setVolume(conversation.getVolume());
    setMuted(conversation.isMuted());
    if (conversation.getStatus() === 'uninitialized') {
      void conversation.init().catch(() => undefined).finally(() => { if (!cancelled) setStatus(conversation.getStatus()); });
    }
    return () => { cancelled = true; };
  }, [patient.bedIndex, patient.case, patient.caseVersion, patient.variantSeed]);

  const conversation = getOrCreatePatientConversation(
    patient.bedIndex,
    patient.case,
    patient.caseVersion,
    patient.variantSeed,
    listenersRef.current
  );
  const setOutputVolume = (next: number) => { setVolume(next); conversation.setVolume(next); };
  const toggleMute = () => { const next = !muted; setMuted(next); conversation.setMuted(next); };
  const firstName = patient.case.name.split(' ')[0];
  const [ox, oy, oz] = headOffset ?? [-0.88, 1, 0];
  const cos = Math.cos(bedRotationY);
  const sin = Math.sin(bedRotationY);
  const position: [number, number, number] = [bedPosition[0] + ox * cos + oz * sin, oy, bedPosition[2] - ox * sin + oz * cos];

  return (
    <Html position={position} zIndexRange={[100, 0]} style={{ pointerEvents: 'auto', userSelect: 'none', transform: 'translate(-50%, -110%)' }}>
      <div style={{ position: 'relative', width: 290, background: 'white', border: '3px solid var(--line)', borderRadius: 'var(--r-md)', boxShadow: '0 4px 0 var(--line), 0 8px 16px rgba(43,30,22,.18)', padding: '10px 14px', fontFamily: 'Nunito, system-ui, sans-serif', color: 'var(--ink)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 900, fontSize: 14 }}>
          <span>{patient.case.name}</span>
          <span style={{ fontSize: 10, color: status === 'speaking' ? 'var(--peach-deep)' : 'var(--ink-soft)' }}>
            {status === 'speaking' ? `${firstName.toUpperCase()} SPEAKING` : ['preparing', 'streaming', 'audio-preparing'].includes(status) ? 'RESPONDING…' : 'TEXT CHAT'}
          </span>
        </div>
        <div style={{ margin: '7px 0', fontStyle: 'italic', fontSize: 13, lineHeight: 1.4 }}>&ldquo;{subtitle.text}&rdquo;</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute patient audio' : 'Mute patient audio'}>{muted ? '🔇' : '🔊'}</button>
          <input aria-label="Patient audio volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setOutputVolume(Number(event.target.value))} style={{ flex: 1 }} />
          <button type="button" onClick={() => void conversation.replayLastResponse()} aria-label="Replay patient response">↻ Replay</button>
        </div>
        {error && <div role="status" style={{ marginTop: 7, fontSize: 11, color: 'var(--ink-2)' }}>{error} <button type="button" onClick={() => { setError(''); void (conversation.getLastAudioError() ? conversation.retrySpeech() : conversation.retryLastResponse()); }}>Retry</button></div>}
        <div style={{ position: 'absolute', left: '50%', bottom: -12, borderLeft: '12px solid transparent', borderRight: '12px solid transparent', borderTop: '12px solid var(--line)' }} />
      </div>
    </Html>
  );
}
