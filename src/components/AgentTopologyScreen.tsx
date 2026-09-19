import { TopBar } from './primitives';
import { store } from '../game/store';
import type { CSSProperties } from 'react';

const card: CSSProperties = {
  background: 'white', border: '3px solid var(--line)', borderRadius: 16,
  boxShadow: '0 4px 0 var(--line)', padding: 20,
};

export function AgentTopologyScreen() {
  return (
    <div className="screen paper" style={{ overflowY: 'auto' }}>
      <TopBar steps={['Home', 'Local AI topology']} here={1} />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 64px' }}>
        <button type="button" className="btn secondary" onClick={() => store.setScreen('home')}>← Home</button>
        <h1>Local AI topology</h1>
        <p>MedSim uses one loopback-only llama.cpp model process for patient dialogue and optional narrative assistance. Kokoro remains a separate CPU text-to-speech service.</p>
        <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
          <section style={card}><h2>Patient dialogue</h2><p>Browser → attempt-bound <code>/agent/patient/stream</code> → server-owned safe case facts → configured model provider → validated text → durable transcript → local Kokoro.</p></section>
          <section style={card}><h2>Clinical evaluation</h2><p>Browser evidence → <code>/api/local-ai/evaluate</code> → server-owned rubric and recorded orders → constrained evidence classification → deterministic weights, arithmetic, diagnosis and critical-failure rules.</p></section>
          <section style={card}><h2>Resource boundary</h2><p>One model, one inference at a time, 4096-token maximum context, bounded recent patient turns, no browser-controlled prompts or model endpoints, and deterministic evaluation fallback when the model is unavailable.</p></section>
        </div>
      </main>
    </div>
  );
}
