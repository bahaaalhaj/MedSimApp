import { TopBar } from './primitives';
import { store } from '../game/store';

export function AgenticRoundsScreen() {
  return (
    <div className="screen paper" style={{ overflowY: 'auto' }}>
      <TopBar here={6} steps={['Polyclinic', 'GP', 'Case', 'Brief', 'Encounter', 'Debrief', 'Architecture']} />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px 64px' }}>
        <button type="button" className="btn secondary" onClick={() => store.setScreen('home')}>← Home</button>
        <h1>Local evaluation architecture</h1>
        <p>The language model is an untrusted evidence classifier. It cannot change rubric criteria, weights, diagnosis truth, recorded investigations, medicine expectations, critical failures, arithmetic, or score bands.</p>
        <div className="card" style={{ marginTop: 20, padding: 20 }}>
          <h2>Failure behavior</h2>
          <p>Schema-invalid or unknown criterion output is rejected with one bounded retry. If local inference is unavailable or still invalid, MedSim returns a deterministic debrief and marks absent evidence as missed.</p>
        </div>
        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <h2>Academic boundary</h2>
          <p>This is synthetic educational software. A successful local inference run is not evidence of clinical validity or equivalence to a cloud model; case rules and generated feedback require physician review.</p>
        </div>
      </main>
    </div>
  );
}
