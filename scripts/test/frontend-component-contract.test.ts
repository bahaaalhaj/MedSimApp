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
    read('src/components/examine/DiagnosisTab.tsx'),
    read('src/components/examine/PrescriptionTab.tsx'),
  ].join('\n');
  for (const label of ['History', 'Chat', 'Examination', 'Order tests', 'Results', 'Diagnose', 'Rx']) {
    assert.match(overlay, new RegExp(`label: '${label}'`));
  }
  assert.match(overlay, /e\.key === 'Escape'/);
  assert.match(overlay, /onClick=\{onFinish\}[\s\S]*Finish consultation/);
  assert.match(overlay, /role="alert"/);
  assert.match(overlay, /sendTextMessage\((q|question)\.question, 'predefined', (q|question)\.id\)/);
  assert.match(overlay, /onRecordAction=\{\(actionId\) => store\.recordExaminationAction\(actionId\)\}/);
  assert.match(overlay, /orderPolyclinicTest\(id\)/);
  assert.match(overlay, /submitPolyclinicDiagnosis\(diagnosisId\)/);
  assert.match(overlay, /addPolyclinicPrescription/);
  assert.match(overlay, /sendTextMessage\(text, 'typed'\)/);
  assert.equal((overlay.match(/id="patient-question"/g) ?? []).length, 1);
  assert.equal((read('src/components/ExamineOverlay.tsx').match(/function ChatTab/g) ?? []).length, 0);
});

test('History and examination tabs receive encounter mutations through narrow callbacks', () => {
  const overlay = read('src/components/ExamineOverlay.tsx');
  const history = read('src/components/examine/HistoryTab.tsx');
  const examination = read('src/components/examine/ExaminationTab.tsx');

  assert.match(overlay, /<HistoryTabFeature patient=\{patient\} onQuestionAccepted=\{\(questionId\) => store\.askPolyclinicQuestion\(questionId\)\}/);
  assert.match(overlay, /<ExaminationTabFeature patient=\{patient\} onRecordAction=\{\(actionId\) => store\.recordExaminationAction\(actionId\)\}/);
  assert.match(history, /onQuestionAccepted\(question\.id\)/);
  assert.match(examination, /onRecordAction\(action\.id\)/);
  assert.doesNotMatch(history + examination, /\bstore\./);
});

test('Diagnosis tab retains learner-visible options and callback boundaries', () => {
  const overlay = read('src/components/ExamineOverlay.tsx');
  const diagnosis = read('src/components/examine/DiagnosisTab.tsx');

  assert.match(overlay, /<DiagnosisTab[\s\S]*submitted=\{submitted\}/);
  assert.match(diagnosis, /shuffledOptions\.map/);
  assert.match(diagnosis, /disabled=\{submitted !== null\}/);
  assert.match(diagnosis, /onClick=\{\(\) => onSubmitDiagnosis\(dxId\)\}/);
  assert.match(diagnosis, /onClick=\{onGoToRx\}/);
  assert.match(diagnosis, /onClick=\{onFinish\}/);
  assert.equal((diagnosis.match(/export function DiagnosisTab/g) ?? []).length, 1);
  assert.doesNotMatch(diagnosis, /from ['"][^'"]*(clinical|rubric|cases)/);
});

test('Prescription tab retains controlled inputs and callback boundaries', () => {
  const overlay = read('src/components/ExamineOverlay.tsx');
  const prescription = read('src/components/examine/PrescriptionTab.tsx');

  assert.match(overlay, /<PrescriptionTab[\s\S]*prescriptions=\{patient\.prescriptions\}/);
  assert.match(prescription, /value=\{dose\}/);
  assert.match(prescription, /value=\{duration\}/);
  assert.match(prescription, /updatePicked\(med\.id, 'dose', e\.target\.value\)/);
  assert.match(prescription, /updatePicked\(med\.id, 'duration', e\.target\.value\)/);
  assert.match(prescription, /onClick=\{\(\) => togglePick\(med\)\}/);
  assert.match(prescription, /onClick=\{onSubmitAll\}/);
  assert.match(prescription, /onClick=\{onFinish\}/);
  assert.match(prescription, /if \(!unlocked\)/);
  assert.equal((prescription.match(/export function PrescriptionTab/g) ?? []).length, 1);
  assert.doesNotMatch(prescription, /from ['"][^'"]*(rubric|answer|expectation)/);
});

test('Criterion card retains presentation-only verdict and citation rendering', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  const details = read('src/components/debrief/EvaluationDetails.tsx');
  const criterionCard = read('src/components/debrief/CriterionCard.tsx');

  assert.match(criterionCard, /met: \{ icon:/);
  assert.match(criterionCard, /'partially-met': \{ icon:/);
  assert.match(criterionCard, /missed: \{ icon:/);
  assert.match(criterionCard, /label: 'MET'/);
  assert.match(criterionCard, /label: 'PARTIAL'/);
  assert.match(criterionCard, /label: 'MISSED'/);
  assert.match(criterionCard, /\{text\}/);
  assert.match(criterionCard, /\{evidence\}/);
  assert.match(criterionCard, /\{cite && \(/);
  assert.match(criterionCard, /target="_blank" rel="noreferrer"/);
  assert.match(debrief, /import \{ EvaluationDetails \}/);
  assert.match(details, /<CriterionCard/);
  assert.equal((criterionCard.match(/export function CriterionCard/g) ?? []).length, 1);
  assert.doesNotMatch(criterionCard, /store|rubric|answer|score|from ['"][^'"]*(clinical|agents|game)/);
});

test('Action chips retain learner-visible ordering, tones, and presentation boundaries', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  const details = read('src/components/debrief/EvaluationDetails.tsx');
  const actionChips = read('src/components/debrief/ActionChips.tsx');

  assert.match(debrief, /<EvaluationDetails evaluation=\{evaluation\} patient=\{patient\} c=\{c\} resolveCitation=\{buildCite\}/);
  assert.match(details, /<ActionChips patient=\{patient\} c=\{c\}/);
  assert.match(actionChips, /for \(const tid of patient\.orderedTestIds\)/);
  assert.match(actionChips, /for \(const tid of patient\.givenTreatmentIds\)/);
  assert.match(actionChips, /for \(const p of patient\.prescriptions \?\? \[\]\)/);
  assert.match(actionChips, /\\uD83E\\uDDEA/);
  assert.match(actionChips, /category === 'medication'/);
  assert.match(actionChips, /category === 'disposition'/);
  assert.match(actionChips, /\\uD83D\\uDC8A/);
  assert.match(actionChips, /\\u2197/);
  assert.match(actionChips, /\\uD83E\\uDE7A/);
  assert.match(actionChips, /legacyCritical\.includes\(tid\) \? 'mint' : 'peach'/);
  assert.match(actionChips, /No actions taken during the encounter/);
  assert.equal((actionChips.match(/export function ActionChips/g) ?? []).length, 1);
  assert.doesNotMatch(actionChips, /store|rubric|answer|score|from ['"][^'"]*(agents|clinical)/);
});

test('Evaluation details retain grouped successful-result presentation boundaries', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  const details = read('src/components/debrief/EvaluationDetails.tsx');

  assert.match(debrief, /<EvaluationDetails evaluation=\{evaluation\} patient=\{patient\} c=\{c\} resolveCitation=\{buildCite\}/);
  for (const domain of ['data_gathering', 'clinical_management', 'interpersonal']) {
    assert.match(details, new RegExp(`domain === '${domain}'`));
  }
  for (const label of ['Data Gathering', 'Clinical Management', 'Interpersonal']) {
    assert.match(details, new RegExp(`label="${label}"`));
  }
  assert.match(details, /\.max > 0/);
  assert.match(details, /Model-assisted feedback/);
  assert.match(details, /Deterministic evidence grading/);
  assert.match(details, /Data gathering/);
  assert.match(details, /Clinical management/);
  assert.match(details, /<CriterionCard/);
  assert.match(details, /HIGHLIGHTS/);
  assert.match(details, /NEXT TIME/);
  assert.match(details, /<ActionChips patient=\{patient\} c=\{c\}/);
  assert.match(details, /CASE VERSION &amp; SOURCES/);
  assert.match(details, /target="_blank" rel="noreferrer"/);
  assert.match(details, /Source verification confirms metadata and link provenance/);
  assert.match(details, /history questions/);
  assert.match(details, /tests/);
  assert.match(details, /treatments/);
  assert.equal((details.match(/export function EvaluationDetails/g) ?? []).length, 1);
  assert.doesNotMatch(details, /store|fetch|from ['"][^'"]*(clinical|data|store)/);
});

test('Debrief status and grading-progress components retain presentation contracts', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  const statusBanner = read('src/components/debrief/StatusBanner.tsx');
  const gradingProgress = read('src/components/debrief/GradingProgress.tsx');

  assert.match(statusBanner, /ATTENDING/);
  assert.match(statusBanner, /<Doodle kind="star" size=\{86\} color="#FFD86B"/);
  assert.match(statusBanner, /background: bg/);
  assert.match(statusBanner, /\{title\}/);
  assert.match(statusBanner, /\{body\}/);
  assert.match(gradingProgress, /Replaying your conversation with the patient/);
  assert.match(gradingProgress, /Drafting personalised feedback for each criterion/);
  assert.match(gradingProgress, /Math\.min\(s \+ 1, GRADING_STEPS\.length - 1\)/);
  assert.match(gradingProgress, /\}, 1400\)/);
  assert.match(gradingProgress, /window\.clearInterval\(id\)/);
  assert.match(gradingProgress, /if \(partialNarration\.length > 0\)/);
  assert.match(gradingProgress, /body=\{truncate\(partialNarration, 320\)\}/);
  assert.match(gradingProgress, /state === 'done'/);
  assert.match(gradingProgress, /state === 'active'/);
  assert.match(gradingProgress, /state === 'pending'/);
  assert.match(debrief, /import \{ StatusBanner \}/);
  assert.match(debrief, /import \{ GradingProgress \}/);
  assert.equal((statusBanner.match(/export function StatusBanner/g) ?? []).length, 1);
  assert.equal((gradingProgress.match(/export function GradingProgress/g) ?? []).length, 1);
  assert.doesNotMatch(statusBanner + gradingProgress, /store|rubric|answer|score|from ['"][^'"]*(agents|clinical|game)/);
});

test('Debrief safety and verdict headers retain presentation-only contracts', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  const safetyBanner = read('src/components/debrief/SafetyBreachBanner.tsx');
  const verdictCard = read('src/components/debrief/VerdictCard.tsx');

  assert.match(debrief, /<SafetyBreachBanner[\s\S]*cite=\{evaluation\.safety_breach\.guideline_ref \? buildCite/);
  assert.match(debrief, /<VerdictCard verdict=\{verdict\} narrative=\{evaluation\.narrative\}/);
  assert.match(safetyBanner, /SAFETY BREACH/);
  assert.match(safetyBanner, /\{description\}/);
  assert.match(safetyBanner, /\{cite && \(/);
  assert.match(safetyBanner, /\{cite\.title\}/);
  assert.match(safetyBanner, /\{cite\.rec\}/);
  assert.match(safetyBanner, /\{cite\.loE\}/);
  for (const band of ['excellent', 'good', 'satisfactory', 'borderline', 'clear-fail']) {
    assert.match(verdictCard, new RegExp(band));
  }
  assert.match(verdictCard, /YOUR MARK/);
  assert.match(verdictCard, /<Doodle kind="star" size=\{86\} color="#FFD86B"/);
  assert.match(verdictCard, /\{narrative\}/);
  assert.equal((safetyBanner.match(/export function SafetyBreachBanner/g) ?? []).length, 1);
  assert.equal((verdictCard.match(/export function VerdictCard/g) ?? []).length, 1);
  assert.doesNotMatch(safetyBanner + verdictCard, /store|rubric|answer|score|fetch|from ['"][^'"]*(agents|clinical|game)/);
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
