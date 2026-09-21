import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('Examine preserves tab, keyboard, finish, and evidence contracts', () => {
  const overlay = [
    read('src/components/ExamineOverlay.tsx'),
    read('src/components/examine/HistoryTab.tsx'),
    read('src/components/examine/ExaminationTab.tsx'),
    read('src/components/examine/ChatTab.tsx'),
  ].join('\n');
  for (const label of ['History', 'Chat', 'Examination', 'Order tests', 'Results', 'Diagnose', 'Rx']) {
    assert.match(overlay, new RegExp(`label: '${label}'`));
  }
  assert.match(overlay, /e\.key === 'Escape'/);
  assert.match(overlay, /onClick=\{onFinish\}[\s\S]*Finish consultation/);
  assert.match(overlay, /role="alert"/);
  assert.match(overlay, /sendTextMessage\((q|question)\.question, 'predefined', (q|question)\.id\)/);
  assert.match(overlay, /recordExaminationAction\(action\.id\)/);
  assert.match(overlay, /orderPolyclinicTest\(id\)/);
  assert.match(overlay, /submitPolyclinicDiagnosis\(dxId\)/);
  assert.match(overlay, /addPolyclinicPrescription/);
  assert.match(overlay, /sendTextMessage\(text, 'typed'\)/);
  assert.equal((overlay.match(/id="patient-question"/g) ?? []).length, 1);
  assert.equal((read('src/components/ExamineOverlay.tsx').match(/function ChatTab/g) ?? []).length, 0);
});

test('scene and debrief retain their presentational and lifecycle seams', () => {
  const scene = read('src/components/three/Polyclinic.tsx');
  const debrief = read('src/components/DebriefScreen.tsx');
  assert.match(scene, /E[^\n]*Examine/);
  assert.match(scene, /WalkingPatient/);
  assert.match(scene, /DoorLeaf open=\{doorOpen\}/);
  assert.match(debrief, /status === 'starting' \|\| status === 'idle'/);
  assert.match(debrief, /status === 'streaming'/);
  assert.match(debrief, /if \(savedRef\.current\) return/);
  assert.match(debrief, /EvaluationBody evaluation=\{evaluation\}/);
});
