import { TESTS, testById } from '../data/tests.ts';
import type { DifferentialDiagnosis, CaseInvestigation, InvestigationCategory, InvestigationResult } from './types.ts';

const MICROBIOLOGY = new Set(['urine-cx', 'blood-cx', 'stool-cx', 'strep-radt', 'flu-swab', 'covid-swab', 'h-pylori', 'hiv', 'hep-b', 'hep-c', 'rpr']);
const CARDIAC = new Set(['ecg', 'echo', 'troponin', 'bnp']);
const PHYSIOLOGICAL = new Set(['peak-flow', 'spirometry', 'audiometry', 'eeg', 'emg-ncs', 'visual-field']);
const PATHOLOGY = new Set(['skin-biopsy', 'pap-smear']);
const BEDSIDE = new Set(['glucose', 'urine-hcg', 'pocus', 'fundoscopy']);
const IMAGING_PREFIXES = ['xr-', 'ct-', 'mri-', 'us-'];
const IMAGING = new Set(['cxr', 'kub', 'echo', 'dexa', 'mammogram', 'oct']);

export function investigationCategory(testId: string): InvestigationCategory {
  if (MICROBIOLOGY.has(testId)) return 'microbiology';
  if (CARDIAC.has(testId)) return 'cardiac';
  if (PHYSIOLOGICAL.has(testId)) return 'physiological';
  if (PATHOLOGY.has(testId)) return 'pathology';
  if (BEDSIDE.has(testId)) return 'bedside';
  if (IMAGING.has(testId) || IMAGING_PREFIXES.some((prefix) => testId.startsWith(prefix))) return 'imaging';
  return 'laboratory';
}

function abnormality(abnormal: boolean, result: string): 'normal' | 'abnormal' | 'positive' | 'negative' | 'indeterminate' {
  if (/\b(positive|detected|reactive)\b/i.test(result)) return 'positive';
  if (/\b(negative|not detected|non-reactive)\b/i.test(result)) return 'negative';
  if (/\b(indeterminate|equivocal)\b/i.test(result)) return 'indeterminate';
  return abnormal ? 'abnormal' : 'normal';
}

function component(label: string, value: number, unit: string, abnormal: boolean) {
  return { analyteId: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, value: Math.round(value * 10) / 10, unit, abnormality: abnormal ? 'abnormal' as const : 'normal' as const };
}

function matchNumber(text: string, pattern: RegExp): number | undefined {
  const value = text.match(pattern)?.[1];
  return value === undefined ? undefined : Number(value.replace(',', ''));
}

function asStructuredResult(testId: string, result: string, abnormal: boolean): InvestigationResult {
  const components = [];
  if (testId === 'cbc') {
    const hb = matchNumber(result, /\b(?:Hgb|Hb|haemoglobin)\s*([\d.]+)/i); if (hb !== undefined) components.push(component('Haemoglobin', hb < 30 ? hb * 10 : hb, 'g/L', abnormal));
    const wbc = matchNumber(result, /\bWBC\s*([\d.]+)/i); if (wbc !== undefined) components.push(component('White-cell count', wbc, '×10⁹/L', abnormal));
    const plt = matchNumber(result, /\b(?:Plt|platelets?)\s*([\d,.]+)/i); if (plt !== undefined) components.push(component('Platelets', plt > 1000 ? plt / 1000 : plt, '×10⁹/L', abnormal));
    const mcv = matchNumber(result, /\bMCV\s*([\d.]+)/i); if (mcv !== undefined) components.push(component('MCV', mcv, 'fL', abnormal));
    const neutrophils = matchNumber(result, /\bneutrophils?\s*([\d.]+)%/i); if (neutrophils !== undefined) components.push(component('Neutrophils', neutrophils, '%', abnormal));
    const eos = matchNumber(result, /\beosinophils?\s*(?:elevated|[(:]*)\s*([\d.]+)%/i); if (eos !== undefined) components.push(component('Eosinophils', eos, '%', abnormal));
  }
  if (testId === 'bmp') {
    const sodium = matchNumber(result, /\bNa\s*([\d.]+)/i); if (sodium !== undefined) components.push(component('Sodium', sodium, 'mmol/L', abnormal));
    const potassium = matchNumber(result, /\bK\s*([\d.]+)/i); if (potassium !== undefined) components.push(component('Potassium', potassium, 'mmol/L', abnormal));
    const creatinine = matchNumber(result, /\b(?:Cr|creatinine)\s*([\d.]+)/i); if (creatinine !== undefined) components.push(component('Creatinine', creatinine < 20 ? creatinine * 88.4 : creatinine, 'µmol/L', abnormal));
    const egfr = matchNumber(result, /\beGFR\s*([\d.]+)/i); if (egfr !== undefined) components.push(component('eGFR', egfr, 'mL/min/1.73 m²', abnormal));
    const glucose = matchNumber(result, /\bglucose\s*([\d.]+)/i); if (glucose !== undefined) components.push(component('Glucose', glucose > 35 ? glucose / 18 : glucose, 'mmol/L', abnormal));
    const bicarbonate = matchNumber(result, /\b(?:bicarb|bicarbonate)\s*([\d.]+)/i); if (bicarbonate !== undefined) components.push(component('Bicarbonate', bicarbonate, 'mmol/L', abnormal));
    const gap = matchNumber(result, /\banion gap\s*([\d.]+)/i); if (gap !== undefined) components.push(component('Anion gap', gap, 'mmol/L', abnormal));
  }
  if (testId === 'abg') {
    const ph = matchNumber(result, /\bpH\s*([\d.]+)/i); if (ph !== undefined) components.push(component('Arterial pH', ph, 'pH units', abnormal));
    const pco2 = matchNumber(result, /\bpCO2\s*([\d.]+)/i); if (pco2 !== undefined) components.push(component('Arterial pCO₂', pco2 * 0.133322, 'kPa', abnormal));
    const po2 = matchNumber(result, /\bpO2\s*([\d.]+)/i); if (po2 !== undefined) components.push(component('Arterial pO₂', po2 * 0.133322, 'kPa', abnormal));
  }
  if (components.length) return { kind: 'panel', components, summary: testId === 'abg' ? 'Arterial sample; oxygen-delivery context is stated in the written case report.' : undefined };
  if (testId === 'glucose') {
    const value = matchNumber(result, /([\d.]+)/); if (value !== undefined) return { kind: 'numeric', value: Math.round((value > 35 ? value / 18 : value) * 10) / 10, unit: 'mmol/L', abnormality: abnormal ? 'abnormal' : 'normal' };
  }
  // Legacy values mix prose, panels and units. Preserve them as an explicit
  // report until a clinician-reviewed structured conversion exists; never
  // infer numeric values or reference ranges from prose.
  return { kind: 'report', report: result, abnormality: abnormality(abnormal, result) };
}

const LEARNER_REPORT_CORRECTIONS: Record<string, string> = {
  'ctv-003:cxr': 'Right lung re-expanded; small apical bleb and no recurrent pleural air are seen.',
  'ctv-003:ct-chest': 'Apical blebs in the right upper lobe with a small residual apical pleural-air pocket.',
  'nsg-006:mri-brain': 'Disproportionate ventriculomegaly with effacement of the high-convexity sulci and a callosal angle below 90 degrees.',
};

export function buildCaseInvestigations(args: {
  caseId: string;
  caseVersion: string;
  tests: Array<{ testId: string; result: string; abnormal: boolean }>;
  differentials: DifferentialDiagnosis[];
  rubricCriterionId: string;
  referenceId: string;
  timeCritical: boolean;
}): CaseInvestigation[] {
  const correctId = args.differentials.find((item) => item.isCorrect)?.diagnosisId;
  const modeled = args.tests.map((item, index): CaseInvestigation => {
    const learnerResult = LEARNER_REPORT_CORRECTIONS[`${args.caseId}:${item.testId}`] ?? item.result;
    const structuredResult = asStructuredResult(item.testId, learnerResult, item.abnormal);
    const catalogue = testById(item.testId);
    const imagingDelayRisk = index > 0 && args.timeCritical && ['ct-head', 'ct-abdomen', 'ct-angio', 'mri-brain', 'mri-cspine', 'mri-lspine', 'us-pelvis'].includes(item.testId);
    const role = imagingDelayRisk ? 'potentially-harmful' : index === 0 ? 'essential' : index === 1 ? 'useful' : index === 2 ? 'conditional' : 'optional';
    // The linked pathway source supports the investigation concept, not the
    // exact synthetic result wording. Keep every migrated value unresolved
    // and unscoreable until a qualified reviewer signs off the conversion.
    const verificationStatus = 'unresolved' as const;
    return {
      testId: item.testId,
      name: catalogue?.name ?? item.testId,
      category: investigationCategory(item.testId),
      role,
      reason: imagingDelayRisk
        ? 'May be considered only if it does not delay the time-critical specialist pathway.'
        : role === 'essential'
          ? 'Core investigation for this simulated presentation and its immediate safety assessment.'
          : 'Can refine the differential diagnosis or establish a useful baseline when clinically justified.',
      availability: imagingDelayRisk || role === 'conditional' ? 'conditional' : 'available-if-ordered',
      classification: imagingDelayRisk ? 'potentially-harmful' : role === 'essential' ? 'essential' : 'useful',
      structuredResult,
      result: investigationResultText(structuredResult, learnerResult),
      abnormal: item.abnormal,
      turnaroundSec: catalogue?.turnaroundSec ?? 60,
      prerequisite: imagingDelayRisk ? 'Order only after immediate escalation; it must not delay definitive assessment.' : role === 'conditional' ? 'Requires a case-specific indication established from the history or examination.' : undefined,
      learnerSafeSummary: 'A case-specific simulated result will be released only after this investigation is ordered.',
      postSubmissionExplanation: 'Interpret this result with the history, examination, pre-test probability, and the stated limitations.',
      supportsDiagnosisIds: item.abnormal && correctId ? [correctId] : [],
      arguesAgainstDiagnosisIds: item.abnormal ? [] : args.differentials.filter((d) => !d.isCorrect).slice(0, 2).map((d) => d.diagnosisId),
      limitations: ['A single investigation cannot confirm or exclude every diagnosis in the differential.', 'Synthetic values are formative and are not clinical guidance.'],
      verificationStatus,
      scoreable: false,
      rubricCriterionIds: [args.rubricCriterionId],
      referenceIds: [args.referenceId],
    };
  });
  const existing = new Set(modeled.map((item) => item.testId));
  const unavailable = (testId: string, role: 'conditional' | 'optional' | 'not-indicated' | 'potentially-harmful', availability: 'conditional' | 'not-modeled' | 'not-indicated', reason: string, prerequisite?: string): CaseInvestigation => ({
    testId, name: testById(testId)?.name ?? testId, category: investigationCategory(testId), role,
    reason, availability, classification: role === 'potentially-harmful' ? 'potentially-harmful' : role === 'not-indicated' ? 'unnecessary' : 'useful',
    result: '', abnormal: false, turnaroundSec: testById(testId)?.turnaroundSec ?? 60, prerequisite,
    learnerSafeSummary: availability === 'not-indicated' ? 'No result is generated because this investigation is not indicated in the modeled context.' : 'This investigation is explicitly unavailable unless its stated condition is met.',
    postSubmissionExplanation: 'Investigation selection depends on clinical indication and whether the result would change management.',
    supportsDiagnosisIds: [], arguesAgainstDiagnosisIds: [], limitations: ['No simulated result is available in the current modeled context.'],
    verificationStatus: 'unresolved', scoreable: false, rubricCriterionIds: [args.rubricCriterionId], referenceIds: [args.referenceId],
  });
  const addMissingRole = (role: 'conditional' | 'optional') => {
    if (modeled.some((item) => item.role === role)) return;
    const candidate = TESTS.find((item) => !existing.has(item.id));
    if (!candidate) return;
    existing.add(candidate.id);
    modeled.push(unavailable(candidate.id, role, role === 'conditional' ? 'conditional' : 'not-modeled', role === 'conditional' ? 'Appropriate only if a new case-specific trigger emerges.' : 'A reasonable lower-yield option, but no result is modeled for this case version.', role === 'conditional' ? 'Requires a relevant trigger from history or examination.' : undefined));
  };
  addMissingRole('conditional');
  addMissingRole('optional');
  const inappropriateId = ['ana', 'ct-angio', 'blood-cx', 'mri-brain', 'psa'].find((id) => !existing.has(id))!;
  const catalogue = testById(inappropriateId)!;
  modeled.push(unavailable(inappropriateId, 'not-indicated', 'not-indicated', `${catalogue.name} is not routinely indicated for the modeled presentation without an additional specific clinical trigger.`));
  if (args.timeCritical) {
    const delayId = ['mri-brain', 'ct-abdomen', 'ct-angio', 'us-pelvis'].find((id) => !existing.has(id) && id !== inappropriateId);
    if (delayId) modeled.push(unavailable(delayId, 'potentially-harmful', 'not-indicated', 'This investigation may dangerously delay immediate stabilization or specialist assessment.', 'Escalate and stabilize first; do not wait for this result.'));
  }
  return modeled;
}

export function investigationResultText(result: InvestigationResult | undefined, fallback = ''): string {
  if (!result) return fallback;
  if (result.kind === 'numeric') return `${result.value} ${result.unit}`.trim();
  if (result.kind === 'panel') return result.components.map((c) => `${c.label}: ${c.value}${c.unit ? ` ${c.unit}` : ''}`).join('\n');
  if (result.kind === 'score') return `${result.scale}: ${result.score}. ${result.interpretation}`;
  return result.report;
}
