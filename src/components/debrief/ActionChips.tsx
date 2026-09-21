import { TESTS } from '../../data/tests';
import { TREATMENTS } from '../../data/treatments';
import type { ActivePatient, LearnerPatientCase } from '../../game/types';

export function ActionChips({ patient, c }: { patient: ActivePatient; c: LearnerPatientCase }) {
  const testById = new Map(TESTS.map((t) => [t.id, t]));
  const treatmentById = new Map(TREATMENTS.map((t) => [t.id, t]));
  const chips: Array<{ key: string; label: string; tone: 'butter' | 'peach' | 'mint' | 'sky' | 'plain' }> = [];
  for (const tid of patient.orderedTestIds) {
    const name = testById.get(tid)?.name ?? tid;
    chips.push({ key: `test-${tid}`, label: `\uD83E\uDDEA ${name}`, tone: 'butter' });
  }
  for (const tid of patient.givenTreatmentIds) {
    const name = treatmentById.get(tid)?.name ?? tid;
    const legacyCritical = (c as LearnerPatientCase & { criticalTreatmentIds?: string[] }).criticalTreatmentIds ?? [];
    const tone = legacyCritical.includes(tid) ? 'mint' : 'peach';
    const icon = treatmentById.get(tid)?.category === 'medication' ? '\uD83D\uDC8A' :
      treatmentById.get(tid)?.category === 'disposition' ? '\u2197' : '\uD83E\uDE7A';
    chips.push({ key: `tx-${tid}`, label: `${icon} ${name}`, tone });
  }
  for (const p of patient.prescriptions ?? []) {
    chips.push({
      key: `rx-${p.medicationId}`,
      label: `\uD83D\uDC8A ${p.medicationId} ${p.dose} ${p.duration}`,
      tone: 'peach',
    });
  }
  if (chips.length === 0) {
    chips.push({ key: 'none', label: 'No actions taken during the encounter', tone: 'plain' });
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {chips.map((c) => (
        <span key={c.key} className={c.tone === 'plain' ? 'chip' : `chip ${c.tone}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}


