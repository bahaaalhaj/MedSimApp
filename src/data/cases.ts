import type { FaceAccessory, FaceMood } from '../components/primitives';
import type { LearnerPatientCase } from '../game/types';
import type { ClinicId } from '../game/clinic';
import { CLINIC_LABELS } from '../game/clinic.ts';
import type { CaseReviewStatus, LearnerLevel, TrainingMode } from '../clinical/types';
import learnerManifest from '../generated/learner-case-manifest.json' with { type: 'json' };

export interface Case {
  id: string;
  name: string;
  age: number;
  sex: 'M' | 'F';
  complaint: string;
  tags: string[];
  guideline: string;
  skin: string;
  hair: string;
  mood: FaceMood;
  cond: string;
  attempted?: boolean;
  score?: string;
  accessory?: FaceAccessory;
  clinic: ClinicId;
  reviewStatus: CaseReviewStatus;
  caseVersion: string;
  difficulty: 'introductory' | 'intermediate' | 'advanced';
  learnerLevel: LearnerLevel;
}

interface LearnerManifestCase {
  caseId: string;
  caseVersion: string;
  rubricVersion: string;
  specialtyId: ClinicId;
  displayName: string;
  age: number;
  gender: 'M' | 'F';
  severity: LearnerPatientCase['severity'];
  arrivalBlurb: string;
  publicComplaint: string;
  vitalSigns: LearnerPatientCase['vitals'];
  historyQuestions: Array<{ id: string; question: string }>;
  diagnosisOptions: Array<{ diagnosisId: string; label: string }>;
  difficulty: Case['difficulty'];
  learnerLevel: LearnerLevel;
  reviewStatus: CaseReviewStatus;
  variantPolicy?: LearnerPatientCase['variantPolicy'];
}

const records = learnerManifest.cases as LearnerManifestCase[];
if (records.length !== 72) throw new Error('Learner case manifest must contain exactly 72 assignable cases');

const SKIN_TONES = ['#FFE0BD', '#FFD8B5', '#FFD0B0', '#E8B68F', '#D89B6E', '#B47148', '#7B4F2E', '#4A2E1C'];
const HAIR_TONES = ['#1F1410', '#2B1810', '#3B2A1F', '#5A3A22', '#A8855E', '#D9B380', '#E5DACE', '#9F9F9F'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickSkin(p: LearnerPatientCase): string {
  return SKIN_TONES[hash(p.id + 'skin') % SKIN_TONES.length];
}

function pickHair(p: LearnerPatientCase): string {
  if (p.age >= 65) return HAIR_TONES[6 + (hash(p.id) % 2)];
  return HAIR_TONES[hash(p.id + 'hair') % 6];
}

function pickMood(p: LearnerPatientCase): FaceMood {
  if (p.severity === 'critical') return 'sad';
  if (p.severity === 'urgent') return 'sick';
  const cc = p.chiefComplaint.toLowerCase();
  if (/(pain|chest|headache|bleed)/.test(cc)) return 'worried';
  if (/(fever|cough|nausea|vomit|sore)/.test(cc)) return 'sick';
  return 'neutral';
}

function tagsFor(p: LearnerPatientCase, clinic: ClinicId): string[] {
  const out: string[] = [];
  if (p.severity === 'critical') out.push('red flag');
  else if (p.severity === 'urgent') out.push('urgent');
  out.push(CLINIC_LABELS[clinic].toLowerCase());
  return out;
}

const PATIENT_BY_ID = new Map<string, LearnerPatientCase>();
const META_BY_ID = new Map(records.map((record) => [record.caseId, record]));

export const CASES: Case[] = records.map((record) => {
  const patient: LearnerPatientCase = {
    id: record.caseId,
    name: record.displayName,
    age: record.age,
    gender: record.gender,
    severity: record.severity,
    arrivalBlurb: record.arrivalBlurb,
    chiefComplaint: record.publicComplaint,
    vitals: record.vitalSigns,
    anamnesis: record.historyQuestions,
    diagnosisOptions: record.diagnosisOptions.map((item) => item.diagnosisId),
    diagnosisLabels: Object.fromEntries(record.diagnosisOptions.map((item) => [item.diagnosisId, item.label])),
    variantPolicy: record.variantPolicy,
  };
  PATIENT_BY_ID.set(record.caseId, patient);
  return {
    id: record.caseId,
    name: record.displayName,
    age: record.age,
    sex: record.gender,
    complaint: record.publicComplaint,
    tags: tagsFor(patient, record.specialtyId),
    guideline: record.reviewStatus === 'source-verified-formative' ? 'Educational case · Source-backed formative case' : 'Not assignable',
    skin: pickSkin(patient),
    hair: pickHair(patient),
    mood: pickMood(patient),
    cond: 'Clinical reasoning case',
    clinic: record.specialtyId,
    reviewStatus: record.reviewStatus,
    caseVersion: record.caseVersion,
    difficulty: record.difficulty,
    learnerLevel: record.learnerLevel,
  };
});

export function getAssignableCases(_mode: TrainingMode): Case[] {
  return CASES.filter((c) => c.reviewStatus === 'source-verified-formative');
}

const conditionSet = new Set(CASES.map((c) => c.cond));
export const CONDITION_FILTERS: string[] = ['All', ...Array.from(conditionSet).slice(0, 8), 'Red-flag only'];
const PALETTE_VARS = ['var(--rose)', 'var(--peach)', 'var(--mint)', 'var(--sky)', 'var(--butter)'];
export const CONDITION_COLORS: Record<string, string> = Object.fromEntries(
  Array.from(conditionSet).map((label) => [label, PALETTE_VARS[hash(label) % PALETTE_VARS.length]]),
);

export function getCase(id: string): Case {
  const found = CASES.find((c) => c.id === id);
  if (found) return found;
  throw new Error(`Unknown case id: ${id}`);
}

export function getPatientCase(id: string): LearnerPatientCase | undefined {
  return PATIENT_BY_ID.get(id);
}

export function getCaseClinic(id: string): ClinicId | undefined {
  return META_BY_ID.get(id)?.specialtyId;
}

export function getCaseVersion(id: string): string {
  return META_BY_ID.get(id)?.caseVersion ?? 'legacy-1';
}

export function getRubricVersion(id: string): string {
  return META_BY_ID.get(id)?.rubricVersion ?? 'legacy-auto';
}

export function getDiagnosisLabel(caseId: string, diagnosisId: string): string {
  return PATIENT_BY_ID.get(caseId)?.diagnosisLabels[diagnosisId]
    ?? diagnosisId.replace(/-/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase());
}
