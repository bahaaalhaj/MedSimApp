import { existsSync } from 'node:fs';
import { CLINICAL_CASES, isAssignableCase } from '../../src/clinical/cases.ts';
import { LEGACY_CASE_MIGRATIONS } from '../../src/clinical/migration.ts';
import { CLINICAL_REFERENCES } from '../../src/clinical/references.ts';
import { POLYCLINIC_CASES, POLYCLINIC_DIAGNOSIS_LABELS } from '../../src/data/polyclinicPatients.ts';
import { TESTS } from '../../src/data/tests.ts';
import { MEDICATIONS } from '../../src/data/medications.ts';
import { TREATMENTS } from '../../src/data/treatments.ts';
import { GUIDELINES } from '../../src/data/guidelines.ts';
import { deriveAutoRubric } from '../../src/data/autoRubric.ts';
import { CLINIC_LABELS, type ClinicId } from '../../src/game/clinic.ts';
import type { CaseRubric, PatientCase, RubricCriterion } from '../../src/game/types.ts';
import type { ClinicalCase } from '../../src/clinical/types.ts';
import { semanticSha256, stableStringify } from './generation-metadata.ts';

export { stableStringify } from './generation-metadata.ts';

export const EXPORT_SCRIPT_VERSION = '1.0.0';

export const SHEET_COLUMNS = {
  Case_Index: ['export_case_key','case_id','canonical_case_id','legacy_case_id','case_version','schema_version','case_system','migration_status','review_status','publication_eligibility','specialty_id','specialty_name','case_title','patient_name','age','gender','difficulty','target_learner_level','severity','chief_complaint','arrival_blurb','correct_diagnosis_id','correct_diagnosis_name','number_of_diagnosis_options','number_of_history_items','number_of_investigations','number_of_medications','number_of_rubric_criteria','number_of_references','variant_policy_present','source_file','source_export_name','record_hash'],
  Patient_Profile: ['export_case_key','case_id','case_version','patient_name','age','gender','occupation','social_context','chief_complaint','symptom_onset','symptom_duration','symptom_character','associated_symptoms','negative_symptoms','past_medical_history','past_surgical_history','medications','allergies','family_history','social_history','smoking_history','alcohol_history','pregnancy_context','other_profile_information','source_file'],
  Vital_Signs: ['export_case_key','case_id','case_version','stage','heart_rate','heart_rate_unit','blood_pressure','systolic_bp','diastolic_bp','blood_pressure_unit','respiratory_rate','respiratory_rate_unit','spo2','spo2_unit','temperature','temperature_unit','weight','weight_unit','height','height_unit','bmi','consciousness','pain_score','other_vitals','source_file'],
  History_Questions: ['export_case_key','case_id','case_version','history_item_id','category','question','patient_answer','relevant_flag','essential_flag','information_release_condition','learning_objective_ids','rubric_criterion_ids','reference_ids','source_file'],
  Physical_Examination: ['export_case_key','case_id','case_version','examination_id','system','examination_name','finding','normal_or_abnormal','essential_flag','learning_objective_ids','rubric_criterion_ids','reference_ids','source_file'],
  Investigations: ['export_case_key','case_id','case_version','test_id','test_name','test_category','reason_for_test','result','unit','reference_range','abnormal_flag','essential_or_optional','appropriateness_classification','result_source','result_is_case_specific','result_is_default','result_is_unavailable','imaging_present','imaging_id','imaging_url','imaging_source','imaging_license','image_is_patient_specific','interpretation','learning_objective_ids','rubric_criterion_ids','reference_ids','source_file'],
  Investigation_Catalogue: ['export_case_key','case_id','case_version','investigation_id','name','category','role','availability','reason','turnaround_seconds','prerequisite','verification_status','scoreable'],
  Case_Investigation_Roles: ['export_case_key','case_id','case_version','investigation_id','role','selection_weight','stewardship_effect','safety_effect','rubric_criterion_ids'],
  Investigation_Results: ['export_case_key','case_id','case_version','investigation_id','result_kind','structured_result','display_result','abnormal','unit','reference_range','variability_notes'],
  Investigation_Diff_Links: ['export_case_key','case_id','case_version','investigation_id','supports_diagnosis_ids','argues_against_diagnosis_ids','limitations','learner_safe_summary','post_submission_explanation'],
  Investigation_References: ['export_case_key','case_id','case_version','investigation_id','reference_id','verification_status','scoreable'],
  Investigation_Scoring: ['export_case_key','case_id','case_version','investigation_id','scoreable','selection_points','interpretation_points','stewardship_rule','safety_rule'],
  Investigation_Safety: ['export_case_key','case_id','case_version','investigation_id','role','prerequisite','potential_delay_or_harm','required_safety_action'],
  Investigation_Review_Queue: ['export_case_key','case_id','case_version','investigation_id','verification_status','scoreable','review_reason','recommended_reviewer','resolution_status'],
  Case_Investigation_Matrix: ['export_case_key','case_id','case_version','specialty','investigation_id','category','role','indication','availability','turnaround_seconds','scoreable'],
  Laboratory_Results: ['export_case_key','case_id','case_version','investigation_id','category','result_type','structured_result','units','reference_range','abnormality','learner_visible_report'],
  Imaging_Results: ['export_case_key','case_id','case_version','investigation_id','result_type','structured_report','learner_visible_report','limitations','turnaround_seconds','educational_image_status'],
  Investigation_Reference_Matrix: ['export_case_key','case_id','case_version','investigation_id','reference_id','verification_status','scoreable','clinical_field_supported'],
  Image_Provenance: ['export_case_key','case_id','case_version','investigation_id','asset_id','source_type','attribution','license','original_url','synthetic','retention_status'],
  Investigation_Issues: ['export_case_key','case_id','case_version','investigation_id','severity','issue_code','description','blocks_scoring','status'],
  Investigation_Audit_Summary: ['export_case_key','case_id','case_version','specialty','investigation_count','essential_count','conditional_count','not_indicated_count','harmful_count','unresolved_count','scoreable_count','audit_status'],
  Differential_Diagnoses: ['export_case_key','case_id','case_version','diagnosis_option_id','diagnosis_name','display_order_if_fixed','is_correct','supporting_findings','findings_against','differential_rationale','same_diagnostic_level_flag','reference_ids','source_file'],
  Management: ['export_case_key','case_id','case_version','management_action_id','management_category','action_name','acceptable_flag','critical_flag','contraindicated_flag','timing','indication','monitoring','referral_requirement','escalation_requirement','safety_netting','acceptable_alternatives','learning_objective_ids','rubric_criterion_ids','reference_ids','source_file'],
  Medications: ['export_case_key','case_id','case_version','medication_id','generic_name','brand_name_if_present','indication_in_case','expected_status','dose','dose_min','dose_max','dose_unit','route','frequency','duration','acceptable_alternatives','contraindications','allergy_considerations','renal_adjustment','hepatic_adjustment','pregnancy_considerations','age_restrictions','monitoring','case_specific_expectation','review_sufficiency','reference_ids','source_file'],
  Rubric_Criteria: ['export_case_key','case_id','case_version','rubric_version','criterion_id','domain','description','observable_evidence','weight','maximum_points','critical_flag','critical_failure_consequence','learning_objective_ids','reference_ids','rubric_origin','source_file'],
  Learning_Objectives: ['export_case_key','case_id','case_version','learning_objective_id','objective','measurable_flag','mapped_rubric_criterion_ids','reference_ids','source_file'],
  References: ['reference_id','organization','title','publication_year','version','region','source_type','url','doi','pubmed_id','section','recommendation_id','page','accessed_at','verification_status','superseded_by','notes','cases_using_reference','number_of_cases_using_reference','source_file'],
  Case_Reference_Matrix: ['export_case_key','case_id','case_version','specialty_id','case_topic','reference_id','reference_role','rubric_criterion_ids','management_action_ids','medication_ids','investigation_ids','verification_status','review_status'],
  Review_Records: ['export_case_key','case_id','case_version','review_status','reviewer_id','reviewer_role','reviewer_specialty','institution','review_date','next_review_due','approval_statement','diagnosis_review','history_review','examination_review','investigation_review','differential_review','management_review','medication_review','safety_review','reference_review','learner_level_review','rubric_review','unresolved_comments','unresolved_critical_comments','review_evidence_present','source_file'],
  Legacy_Migration: ['legacy_case_id','canonical_case_id','canonical_version','migration_status','legacy_review_status','canonical_review_status','historical_compatibility_preserved','migration_notes','legacy_source_file','canonical_source_file'],
  Issues: ['issue_id','severity','category','export_case_key','case_id','case_version','field_or_section','issue_code','issue_description','observed_value','expected_requirement','source_file','automatic_or_manual','blocks_publication','recommended_reviewer'],
} as const;

export type SheetName = keyof typeof SHEET_COLUMNS;
export type Row = Record<string, string | number | boolean | null>;

const LEGACY_SOURCE = 'src/data/polyclinicPatients.ts';
const CANONICAL_SOURCE = 'src/clinical/cases.ts';
const TEST_SOURCE = 'src/data/tests.ts';
const MED_SOURCE = 'src/data/medications.ts';
const TREATMENT_SOURCE = 'src/data/treatments.ts';
const GUIDELINE_SOURCE = 'src/data/guidelines.ts';

const j = (value: unknown): string => JSON.stringify(value ?? null);
const nullIfUndefined = <T>(value: T | undefined): T | null => value === undefined ? null : value;

export function sha256(value: unknown): string {
  return semanticSha256(value);
}

function diagnosisName(id: string): string {
  return POLYCLINIC_DIAGNOSIS_LABELS[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function splitBp(bp: string): [number | null, number | null] {
  const match = /^(\d{2,3})\/(\d{2,3})$/.exec(bp.trim());
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

interface Representation {
  exportCaseKey: string;
  caseId: string;
  caseVersion: string;
  caseSystem: 'legacy' | 'canonical';
  specialtyId: ClinicId;
  legacy: PatientCase;
  canonical: ClinicalCase | null;
  sourceFile: string;
  sourceExportName: string;
  rawRecord: PatientCase | ClinicalCase;
}

export interface ExportBuildOptions {
  generatedAt: string;
  gitCommit: string;
  workingTreeStatus: string;
}

export interface ExportModel {
  exportMetadata: Record<string, unknown>;
  cases: Array<Record<string, unknown>>;
  references: Array<Record<string, unknown>>;
  reviewRecords: Array<Record<string, unknown>>;
  legacyMappings: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  sheets: Record<SheetName, Row[]>;
  specialtyStatusRows: Row[];
}

function legacyEntries(): Array<{ specialtyId: ClinicId; patientCase: PatientCase }> {
  const entries: Array<{ specialtyId: ClinicId; patientCase: PatientCase }> = [];
  for (const [specialtyId, cases] of Object.entries(POLYCLINIC_CASES) as Array<[ClinicId, PatientCase[]]>) {
    if (specialtyId === 'all-specialties') continue;
    for (const patientCase of cases) entries.push({ specialtyId, patientCase });
  }
  return entries;
}

function sourceFilesScanned(): string[] {
  const requested = [
    'src/clinical/types.ts','src/clinical/cases.ts','src/clinical/references.ts','src/clinical/migration.ts','src/clinical/variants.ts','src/clinical/prescriptionValidation.ts',
    'src/data/polyclinicPatients.ts','src/data/patients.ts','src/data/cases.ts','src/data/tests.ts','src/data/defaultTestResults.ts','src/data/radiologyImages.ts','src/data/medications.ts','src/data/treatments.ts','src/data/guidelines.ts','src/data/autoRubric.ts',
    'src/game/types.ts','src/game/clinic.ts','src/agents/debriefRequest.ts','src/agents/deterministicEvaluation.ts',
    'docs/clinical-case-governance.md','docs/clinical-review-checklist.md','docs/reference-policy.md','docs/legacy-case-migration.md',
    'scripts/clinical/generate.ts','scripts/clinical/generated-artifacts.ts','scripts/clinical/generation-metadata.ts',
    'scripts/clinical/export-curation.ts','scripts/clinical/export-investigation-manifest.ts','scripts/clinical/export-local-ai-manifest.ts',
    'scripts/clinical/references.ts','scripts/clinical/export-review.ts','scripts/clinical/export-review-model.ts',
  ];
  return [...new Set(requested.filter(existsSync))].sort();
}

function refsFromLegacyRubric(rubric: CaseRubric): string[] {
  return [...new Set([
    ...rubric.data_gathering,
    ...rubric.clinical_management,
    ...rubric.interpersonal,
  ].map((criterion) => criterion.guideline_ref).filter((value): value is string => Boolean(value))
    .concat(rubric.safety_netting?.guideline_ref ? [rubric.safety_netting.guideline_ref] : []))].sort();
}

function legacyRubricRows(rep: Representation): Row[] {
  const explicit = rep.legacy.rubric;
  const rubric = explicit ?? deriveAutoRubric(rep.legacy);
  const origin = explicit ? 'legacy' : 'auto-generated';
  const rows: Row[] = [];
  const add = (domain: string, criterion: RubricCriterion) => rows.push({
    export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
    rubric_version: 'legacy-1', criterion_id: criterion.criterion_id, domain,
    description: criterion.label, observable_evidence: criterion.evidence, weight: criterion.weight,
    maximum_points: criterion.weight, critical_flag: false, critical_failure_consequence: null,
    learning_objective_ids: j([]), reference_ids: j(criterion.guideline_ref ? [criterion.guideline_ref] : []),
    rubric_origin: origin, source_file: explicit ? LEGACY_SOURCE : 'src/data/autoRubric.ts',
  });
  rubric.data_gathering.forEach((criterion) => add('data_gathering', criterion));
  rubric.clinical_management.forEach((criterion) => add('clinical_management', criterion));
  rubric.interpersonal.forEach((criterion) => add('interpersonal', criterion));
  if (rubric.safety_netting) rows.push({
    export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
    rubric_version: 'legacy-1', criterion_id: 'safety-netting', domain: 'patient-safety',
    description: 'Safety-netting required elements', observable_evidence: j(rubric.safety_netting.required_elements),
    weight: rubric.safety_netting.weight, maximum_points: rubric.safety_netting.weight, critical_flag: false,
    critical_failure_consequence: null, learning_objective_ids: j([]),
    reference_ids: j(rubric.safety_netting.guideline_ref ? [rubric.safety_netting.guideline_ref] : []),
    rubric_origin: origin, source_file: explicit ? LEGACY_SOURCE : 'src/data/autoRubric.ts',
  });
  return rows;
}

function canonicalManagement(rep: Representation): Row[] {
  const c = rep.canonical!;
  const rows: Row[] = [];
  const add = (id: string, category: string, name: string, extra: Partial<Row> = {}) => rows.push({
    export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
    management_action_id: id, management_category: category, action_name: name,
    acceptable_flag: true, critical_flag: false, contraindicated_flag: false, timing: null,
    indication: null, monitoring: null, referral_requirement: null, escalation_requirement: null,
    safety_netting: null, acceptable_alternatives: j([]), learning_objective_ids: j([]),
    rubric_criterion_ids: j([]), reference_ids: j([]), source_file: CANONICAL_SOURCE, ...extra,
  });
  add('management-summary', 'management-plan', c.managementPlan.summary);
  c.managementPlan.nonPharmacological.forEach((value, index) => add(`non-pharmacological-${index + 1}`, 'non-pharmacological-management', value));
  c.managementPlan.referral.forEach((value, index) => add(`referral-${index + 1}`, 'referral', value, { referral_requirement: value }));
  c.redFlags.forEach((value, index) => add(`red-flag-${index + 1}`, 'escalation', value.description, { critical_flag: true, escalation_requirement: value.action, reference_ids: j(value.referenceIds) }));
  c.referralCriteria.forEach((value, index) => add(`referral-criterion-${index + 1}`, 'referral', value.criterion, { referral_requirement: value.action, reference_ids: j(value.referenceIds) }));
  c.safetyNetting.forEach((value, index) => add(`safety-netting-${index + 1}`, 'safety-netting', value.instruction, { safety_netting: value.instruction, reference_ids: j(value.referenceIds) }));
  c.contraindications.forEach((value, index) => add(`contraindication-${index + 1}`, 'contraindication', value.description, { acceptable_flag: false, contraindicated_flag: true, reference_ids: j(value.referenceIds) }));
  return rows;
}

function legacyManagement(rep: Representation): Row[] {
  const treatmentMap = new Map(TREATMENTS.map((value) => [value.id, value]));
  const ids = [...new Set([...rep.legacy.acceptableTreatmentIds, ...rep.legacy.criticalTreatmentIds])];
  return ids.map((id) => {
    const treatment = treatmentMap.get(id);
    return {
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      management_action_id: id, management_category: treatment?.category ?? null,
      action_name: treatment?.name ?? id, acceptable_flag: rep.legacy.acceptableTreatmentIds.includes(id),
      critical_flag: rep.legacy.criticalTreatmentIds.includes(id), contraindicated_flag: false,
      timing: null, indication: null, monitoring: null, referral_requirement: null,
      escalation_requirement: null, safety_netting: null, acceptable_alternatives: j([]),
      learning_objective_ids: j([]), rubric_criterion_ids: j([]), reference_ids: j([]), source_file: treatment ? TREATMENT_SOURCE : LEGACY_SOURCE,
    };
  });
}

function investigationRows(rep: Representation): Row[] {
  const explicit = new Map((rep.canonical?.investigations ?? rep.legacy.testResults).map((result) => [result.testId, result]));
  const canonicalImaging = new Map((rep.canonical?.imaging ?? []).map((item) => [item.testId, item]));
  return TESTS.filter((test) => explicit.has(test.id)).map((test) => {
    const result = explicit.get(test.id) as any;
    const canonicalResult = rep.canonical ? result : null;
    const modeledInterpretation = canonicalImaging.get(test.id)?.interpretation;
    return {
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      test_id: test.id, test_name: test.name, test_category: test.category,
      reason_for_test: canonicalResult?.reason ?? null, result: result?.result ?? null,
      unit: canonicalResult?.units ?? null, reference_range: canonicalResult?.referenceRange ?? null,
      abnormal_flag: result ? Boolean(result.abnormal) : null,
      essential_or_optional: canonicalResult?.classification === 'essential' ? 'essential' : canonicalResult ? 'optional' : null,
      appropriateness_classification: canonicalResult?.classification ?? null,
      result_source: result ? (rep.caseSystem === 'canonical' ? 'canonical-case-specific' : 'legacy-case-specific') : 'UNAVAILABLE / NOT MODELED',
      result_is_case_specific: Boolean(result), result_is_default: false, result_is_unavailable: !result,
      imaging_present: false, imaging_id: null, imaging_url: null, imaging_source: null,
      imaging_license: null, image_is_patient_specific: null,
      interpretation: modeledInterpretation ?? canonicalResult?.postSubmissionExplanation ?? null,
      learning_objective_ids: j([]), rubric_criterion_ids: j(canonicalResult?.rubricCriterionIds ?? []),
      reference_ids: j(canonicalResult?.referenceIds ?? []), source_file: result ? rep.sourceFile : 'src/data/defaultTestResults.ts',
    };
  });
}

function medicationRows(rep: Representation): Row[] {
  if (rep.canonical) return rep.canonical.medicationExpectations.map((medication) => ({
    export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
    medication_id: medication.medicationId, generic_name: medication.genericName, brand_name_if_present: null,
    indication_in_case: medication.indication, expected_status: rep.canonical!.reviewStatus === 'approved-formative' ? 'case-specific reviewed expectation' : 'case-specific pending-review expectation',
    dose: medication.dose, dose_min: null, dose_max: null, dose_unit: medication.unit, route: medication.route,
    frequency: medication.frequency, duration: medication.duration, acceptable_alternatives: j(medication.acceptableAlternatives),
    contraindications: j(medication.contraindications), allergy_considerations: j(medication.allergies),
    renal_adjustment: medication.renalAdjustment, hepatic_adjustment: medication.hepaticAdjustment,
    pregnancy_considerations: medication.pregnancyOrAgeRestrictions, age_restrictions: medication.pregnancyOrAgeRestrictions,
    monitoring: j(medication.monitoring), case_specific_expectation: true,
    review_sufficiency: rep.canonical!.reviewStatus === 'approved-formative' ? 'reviewed' : 'pending clinical review',
    reference_ids: j(medication.referenceIds), source_file: CANONICAL_SOURCE,
  }));
  const related = MEDICATIONS.filter((medication) => medication.indications.includes(rep.legacy.correctDiagnosisId));
  if (related.length === 0) return [{
    export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
    medication_id: null, generic_name: null, brand_name_if_present: null, indication_in_case: null,
    expected_status: 'missing expectation', dose: null, dose_min: null, dose_max: null, dose_unit: null,
    route: null, frequency: null, duration: null, acceptable_alternatives: j([]), contraindications: j([]),
    allergy_considerations: j([]), renal_adjustment: null, hepatic_adjustment: null, pregnancy_considerations: null,
    age_restrictions: null, monitoring: j([]), case_specific_expectation: false,
    review_sufficiency: 'No case-specific medication expectation or generic catalog relationship.', reference_ids: j([]), source_file: LEGACY_SOURCE,
  }];
  return related.map((medication) => ({
    export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
    medication_id: medication.id, generic_name: medication.name, brand_name_if_present: null,
    indication_in_case: rep.legacy.correctDiagnosisId, expected_status: 'generic catalog information',
    dose: medication.defaultDose, dose_min: null, dose_max: null, dose_unit: null, route: null, frequency: null,
    duration: medication.defaultDuration, acceptable_alternatives: j([]), contraindications: j(medication.contraindications ?? []),
    allergy_considerations: j([]), renal_adjustment: null, hepatic_adjustment: null, pregnancy_considerations: null,
    age_restrictions: null, monitoring: j([]), case_specific_expectation: false,
    review_sufficiency: 'Generic catalog relationship only; not a case-specific reviewed expectation.', reference_ids: j([]), source_file: MED_SOURCE,
  }));
}

export function buildExportModel(options: ExportBuildOptions): ExportModel {
  const legacy = legacyEntries();
  const specialtyByCase = new Map(legacy.map(({ specialtyId, patientCase }) => [patientCase.id, specialtyId]));
  const legacyById = new Map(legacy.map(({ patientCase }) => [patientCase.id, patientCase]));
  const migrationById = new Map(LEGACY_CASE_MIGRATIONS.map((item) => [item.legacyCaseId, item]));
  const representations: Representation[] = [
    ...legacy.map(({ specialtyId, patientCase }) => ({ exportCaseKey: `legacy:${patientCase.id}@legacy-1`, caseId: patientCase.id, caseVersion: 'legacy-1', caseSystem: 'legacy' as const, specialtyId, legacy: patientCase, canonical: null, sourceFile: LEGACY_SOURCE, sourceExportName: 'POLYCLINIC_CASES', rawRecord: patientCase })),
    ...CLINICAL_CASES.map((clinicalCase) => ({ exportCaseKey: `canonical:${clinicalCase.caseId}@${clinicalCase.caseVersion}`, caseId: clinicalCase.caseId, caseVersion: clinicalCase.caseVersion, caseSystem: 'canonical' as const, specialtyId: clinicalCase.specialtyId, legacy: legacyById.get(clinicalCase.caseId)!, canonical: clinicalCase, sourceFile: CANONICAL_SOURCE, sourceExportName: 'CLINICAL_CASES', rawRecord: clinicalCase })),
  ].sort((a, b) => a.exportCaseKey.localeCompare(b.exportCaseKey));

  const sheets = Object.fromEntries(Object.keys(SHEET_COLUMNS).map((name) => [name, []])) as Record<SheetName, Row[]>;
  const issues: Array<Record<string, unknown>> = [];
  const addIssue = (issue: Omit<Row, 'issue_id'>) => {
    const issueId = `ISS-${sha256(issue).slice(0, 16).toUpperCase()}`;
    const row = { issue_id: issueId, ...issue };
    sheets.Issues.push(row);
    issues.push(row);
  };

  const treatmentIds = new Set(TREATMENTS.map((item) => item.id));
  const referenceStatus = new Map<string, string>();
  for (const reference of CLINICAL_REFERENCES) referenceStatus.set(reference.referenceId, reference.verificationStatus);
  for (const guideline of GUIDELINES) for (const recommendation of guideline.recommendations) referenceStatus.set(`${guideline.id}:${recommendation.recId}`, guideline.verificationStatus);

  const caseReferenceRelationships = new Map<string, { rep: Representation; rubric: Set<string>; management: Set<string>; medication: Set<string>; investigation: Set<string> }>();
  const relationship = (rep: Representation, referenceId: string) => {
    const key = `${rep.exportCaseKey}\u0000${referenceId}`;
    let value = caseReferenceRelationships.get(key);
    if (!value) {
      value = { rep, rubric: new Set(), management: new Set(), medication: new Set(), investigation: new Set() };
      caseReferenceRelationships.set(key, value);
    }
    return value;
  };

  for (const rep of representations) {
    const c = rep.canonical;
    const migration = migrationById.get(rep.caseId);
    const rubricRows = c ? c.assessmentRubric.criteria.map((criterion) => ({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      rubric_version: c.rubricVersion, criterion_id: criterion.criterionId, domain: criterion.domain,
      description: criterion.description, observable_evidence: j(criterion.observableEvidence), weight: criterion.weight,
      maximum_points: criterion.weight, critical_flag: criterion.isCritical,
      critical_failure_consequence: nullIfUndefined(criterion.failureConsequence), learning_objective_ids: j(criterion.learningObjectiveIds),
      reference_ids: j(criterion.referenceIds), rubric_origin: 'explicit-case-specific', source_file: CANONICAL_SOURCE,
    })) : legacyRubricRows(rep);
    const meds = medicationRows(rep);
    const investigations = investigationRows(rep);
    const management = c ? canonicalManagement(rep) : legacyManagement(rep);
    const refs = c ? [...c.references].sort() : refsFromLegacyRubric(rep.legacy.rubric ?? deriveAutoRubric(rep.legacy));
    const correctId = c?.correctDiagnosis.diagnosisId ?? rep.legacy.correctDiagnosisId;
    const diagnosisOptions = c?.differentialDiagnoses.map((item) => item.diagnosisId) ?? rep.legacy.diagnosisOptions;
    const [systolic, diastolic] = splitBp(c?.vitalSigns.bp ?? rep.legacy.vitals.bp);
    const reviewStatus = c?.reviewStatus ?? 'legacy-unreviewed';
    const rawRecordHash = sha256(rep.rawRecord);

    sheets.Case_Index.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, canonical_case_id: migration?.canonicalCaseId ?? null,
      legacy_case_id: rep.caseId, case_version: rep.caseVersion, schema_version: c?.schemaVersion ?? null,
      case_system: rep.caseSystem, migration_status: migration?.migrationStatus ?? null, review_status: reviewStatus,
      publication_eligibility: c ? isAssignableCase(c.caseId, 'curated') : false, specialty_id: rep.specialtyId,
      specialty_name: CLINIC_LABELS[rep.specialtyId], case_title: c?.title ?? null,
      patient_name: c?.patientProfile.displayName ?? rep.legacy.name, age: c?.patientProfile.age ?? rep.legacy.age,
      gender: c?.patientProfile.gender ?? rep.legacy.gender, difficulty: c?.difficulty ?? 'intermediate',
      target_learner_level: c?.targetLearnerLevel ?? 'undergraduate-clinical-years', severity: rep.legacy.severity,
      chief_complaint: c?.presentingComplaint.publicSummary ?? rep.legacy.chiefComplaint,
      arrival_blurb: c?.presentingComplaint.fullClinicalDescription ?? rep.legacy.arrivalBlurb,
      correct_diagnosis_id: correctId, correct_diagnosis_name: c?.correctDiagnosis.label ?? diagnosisName(correctId),
      number_of_diagnosis_options: diagnosisOptions.length,
      number_of_history_items: c?.history.length ?? rep.legacy.anamnesis.length,
      number_of_investigations: c?.investigations.length ?? rep.legacy.testResults.length,
      number_of_medications: meds.filter((row) => row.medication_id !== null).length,
      number_of_rubric_criteria: rubricRows.length, number_of_references: refs.length,
      variant_policy_present: Boolean(c?.variantPolicy), source_file: rep.sourceFile,
      source_export_name: rep.sourceExportName, record_hash: rawRecordHash,
    });

    sheets.Patient_Profile.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      patient_name: c?.patientProfile.displayName ?? rep.legacy.name, age: c?.patientProfile.age ?? rep.legacy.age,
      gender: c?.patientProfile.gender ?? rep.legacy.gender, occupation: null, social_context: null,
      chief_complaint: c?.presentingComplaint.publicSummary ?? rep.legacy.chiefComplaint,
      symptom_onset: null, symptom_duration: null, symptom_character: null, associated_symptoms: null,
      negative_symptoms: null, past_medical_history: null, past_surgical_history: null, medications: null,
      allergies: null, family_history: null, social_history: null, smoking_history: null, alcohol_history: null,
      pregnancy_context: null, other_profile_information: c ? j({ syntheticComposite: c.patientProfile.syntheticComposite, clinicalRegion: c.clinicalRegion, language: c.language, intendedUse: c.intendedUse }) : null,
      source_file: rep.sourceFile,
    });
    const vitals = c?.vitalSigns ?? rep.legacy.vitals;
    sheets.Vital_Signs.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion, stage: 'initial',
      heart_rate: vitals.hr, heart_rate_unit: null, blood_pressure: vitals.bp, systolic_bp: systolic,
      diastolic_bp: diastolic, blood_pressure_unit: null, respiratory_rate: vitals.rr,
      respiratory_rate_unit: null, spo2: vitals.spo2, spo2_unit: null, temperature: vitals.temp,
      temperature_unit: null, weight: null, weight_unit: null, height: null, height_unit: null, bmi: null,
      consciousness: null, pain_score: null, other_vitals: null, source_file: rep.sourceFile,
    });
    const histories = c?.history.map((item) => ({ id: item.itemId, question: item.question, answer: item.answer, relevant: null }))
      ?? rep.legacy.anamnesis.map((item) => ({ id: item.id, question: item.question, answer: item.answer, relevant: item.relevant }));
    histories.forEach((item) => sheets.History_Questions.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      history_item_id: item.id, category: null, question: item.question, patient_answer: item.answer,
      relevant_flag: item.relevant, essential_flag: null, information_release_condition: null,
      learning_objective_ids: j([]), rubric_criterion_ids: j([]), reference_ids: j([]), source_file: rep.sourceFile,
    }));
    c?.physicalExamination.forEach((finding) => sheets.Physical_Examination.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      examination_id: finding.findingId, system: null, examination_name: null, finding: finding.description,
      normal_or_abnormal: null, essential_flag: null, learning_objective_ids: j([]), rubric_criterion_ids: j([]),
      reference_ids: j([]), source_file: CANONICAL_SOURCE,
    }));
    sheets.Investigations.push(...investigations);
    if (c) for (const investigation of c.investigations) {
      const common = { export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion, investigation_id: investigation.testId };
      sheets.Investigation_Catalogue.push({ ...common, name: investigation.name, category: investigation.category, role: investigation.role, availability: investigation.availability, reason: investigation.reason, turnaround_seconds: investigation.turnaroundSec, prerequisite: investigation.prerequisite ?? null, verification_status: investigation.verificationStatus, scoreable: investigation.scoreable });
      sheets.Case_Investigation_Roles.push({ ...common, role: investigation.role, selection_weight: investigation.role === 'essential' ? 2 : investigation.role === 'useful' ? 1 : 0, stewardship_effect: ['optional', 'not-indicated'].includes(investigation.role) ? 'avoid unless justified' : 'neutral', safety_effect: investigation.role === 'potentially-harmful' ? 'critical penalty if ordered' : 'none', rubric_criterion_ids: j(investigation.rubricCriterionIds) });
      sheets.Investigation_Results.push({ ...common, result_kind: investigation.structuredResult?.kind ?? null, structured_result: j(investigation.structuredResult), display_result: investigation.result, abnormal: investigation.abnormal, unit: investigation.units ?? null, reference_range: investigation.referenceRange ?? null, variability_notes: investigation.variabilityNotes ?? null });
      sheets.Investigation_Diff_Links.push({ ...common, supports_diagnosis_ids: j(investigation.supportsDiagnosisIds), argues_against_diagnosis_ids: j(investigation.arguesAgainstDiagnosisIds), limitations: j(investigation.limitations), learner_safe_summary: investigation.learnerSafeSummary, post_submission_explanation: investigation.postSubmissionExplanation });
      for (const referenceId of investigation.referenceIds) sheets.Investigation_References.push({ ...common, reference_id: referenceId, verification_status: investigation.verificationStatus, scoreable: investigation.scoreable });
      sheets.Investigation_Scoring.push({ ...common, scoreable: investigation.scoreable, selection_points: investigation.role === 'essential' ? 2 : investigation.role === 'useful' ? 1 : 0, interpretation_points: investigation.scoreable ? 1 : 0, stewardship_rule: ['optional', 'not-indicated'].includes(investigation.role) ? 'credit when appropriately omitted' : 'not applicable', safety_rule: investigation.role === 'potentially-harmful' ? 'zero safety domain if ordered' : 'no penalty' });
      sheets.Investigation_Safety.push({ ...common, role: investigation.role, prerequisite: investigation.prerequisite ?? null, potential_delay_or_harm: investigation.role === 'potentially-harmful', required_safety_action: investigation.prerequisite ?? 'None modeled' });
      if (investigation.verificationStatus === 'unresolved') sheets.Investigation_Review_Queue.push({ ...common, verification_status: investigation.verificationStatus, scoreable: investigation.scoreable, review_reason: 'Legacy wording is ambiguous, generic, or lacks a sufficiently specific verified value/report.', recommended_reviewer: `${c.specialtyId} clinician`, resolution_status: 'open' });
      sheets.Case_Investigation_Matrix.push({ ...common, specialty: c.specialtyId, category: investigation.category, role: investigation.role, indication: investigation.reason, availability: investigation.availability, turnaround_seconds: investigation.turnaroundSec, scoreable: investigation.scoreable });
      const resultRow = { ...common, category: investigation.category, result_type: investigation.structuredResult?.kind ?? null, structured_result: j(investigation.structuredResult), units: investigation.units ?? null, reference_range: investigation.referenceRange ?? null, abnormality: investigation.structuredResult && 'abnormality' in investigation.structuredResult ? investigation.structuredResult.abnormality : investigation.abnormal ? 'abnormal' : 'normal', learner_visible_report: investigation.result };
      if (investigation.category === 'imaging') sheets.Imaging_Results.push({ ...common, result_type: investigation.structuredResult?.kind ?? null, structured_report: j(investigation.structuredResult), learner_visible_report: investigation.result, limitations: j(investigation.limitations), turnaround_seconds: investigation.turnaroundSec, educational_image_status: 'Educational image not available for this case version.' });
      else sheets.Laboratory_Results.push(resultRow);
      for (const referenceId of investigation.referenceIds) sheets.Investigation_Reference_Matrix.push({ ...common, reference_id: referenceId, verification_status: investigation.verificationStatus, scoreable: investigation.scoreable, clinical_field_supported: 'Investigation selection and interpretation pathway; exact simulated value remains pending clinician review.' });
      if (investigation.category === 'imaging') sheets.Image_Provenance.push({ ...common, asset_id: null, source_type: null, attribution: null, license: null, original_url: null, synthetic: false, retention_status: 'No image retained; written case-specific report only.' });
      if (investigation.verificationStatus === 'unresolved') sheets.Investigation_Issues.push({ ...common, severity: 'high', issue_code: 'RESULT_PENDING_CLINICIAN_VERIFICATION', description: 'Exact simulated value/report has not been independently verified.', blocks_scoring: true, status: 'open' });
    }
    if (c) sheets.Investigation_Audit_Summary.push({ export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion, specialty: c.specialtyId, investigation_count: c.investigations.length, essential_count: c.investigations.filter((i) => i.role === 'essential').length, conditional_count: c.investigations.filter((i) => i.role === 'conditional').length, not_indicated_count: c.investigations.filter((i) => i.role === 'not-indicated').length, harmful_count: c.investigations.filter((i) => i.role === 'potentially-harmful').length, unresolved_count: c.investigations.filter((i) => i.verificationStatus === 'unresolved').length, scoreable_count: c.investigations.filter((i) => i.scoreable).length, audit_status: c.investigations.every((i) => i.verificationStatus === 'source-verified') ? 'verified' : 'clinical review required' });
    if (c) c.differentialDiagnoses.forEach((diagnosis, index) => sheets.Differential_Diagnoses.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      diagnosis_option_id: diagnosis.diagnosisId, diagnosis_name: diagnosis.label, display_order_if_fixed: index + 1,
      is_correct: diagnosis.isCorrect, supporting_findings: j(diagnosis.supportingFindings), findings_against: j(diagnosis.findingsAgainst),
      differential_rationale: diagnosis.rationale, same_diagnostic_level_flag: null, reference_ids: j([]), source_file: CANONICAL_SOURCE,
    }));
    else rep.legacy.diagnosisOptions.forEach((id, index) => sheets.Differential_Diagnoses.push({
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
      diagnosis_option_id: id, diagnosis_name: diagnosisName(id), display_order_if_fixed: index + 1,
      is_correct: id === rep.legacy.correctDiagnosisId, supporting_findings: null, findings_against: null,
      differential_rationale: null, same_diagnostic_level_flag: null, reference_ids: j([]), source_file: LEGACY_SOURCE,
    }));
    sheets.Management.push(...management);
    sheets.Medications.push(...meds);
    sheets.Rubric_Criteria.push(...rubricRows);
    c?.learningObjectives.forEach((objective) => {
      const criteria = c.assessmentRubric.criteria.filter((criterion) => criterion.learningObjectiveIds.includes(objective.objectiveId));
      sheets.Learning_Objectives.push({
        export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion,
        learning_objective_id: objective.objectiveId, objective: objective.description, measurable_flag: null,
        mapped_rubric_criterion_ids: j(criteria.map((criterion) => criterion.criterionId)),
        reference_ids: j([...new Set(criteria.flatMap((criterion) => criterion.referenceIds))]), source_file: CANONICAL_SOURCE,
      });
    });
    const review = c?.reviewRecord;
    const reviewers = review ? [...review.clinicalReviewers, ...(review.educationalReviewer ? [review.educationalReviewer] : []), ...(review.authoredBy ? [review.authoredBy] : [])] : [];
    const reviewEvidence = Boolean(reviewers.length || review?.approvalStatement);
    const checklist = review?.checklist;
    const reviewRow = {
      export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion, review_status: reviewStatus,
      reviewer_id: reviewers[0]?.reviewerId ?? null, reviewer_role: reviewers[0]?.role ?? null,
      reviewer_specialty: reviewers[0]?.specialty ?? null, institution: reviewers[0]?.institution ?? null,
      review_date: review?.lastReviewedAt ?? reviewers[0]?.reviewedAt ?? null, next_review_due: review?.nextReviewDueAt ?? null,
      approval_statement: review?.approvalStatement ?? null, diagnosis_review: checklist?.diagnosisAccurate ?? 'not-reviewed',
      history_review: checklist?.historyInternallyConsistent ?? 'not-reviewed', examination_review: checklist?.examinationConsistent ?? 'not-reviewed',
      investigation_review: checklist?.investigationsAppropriate ?? 'not-reviewed', differential_review: checklist?.differentialDiagnosesPlausible ?? 'not-reviewed',
      management_review: checklist?.managementAppropriate ?? 'not-reviewed', medication_review: checklist?.medicationDetailsAppropriate ?? 'not-reviewed',
      safety_review: checklist?.safetyAndReferralAppropriate ?? 'not-reviewed', reference_review: checklist?.referencesVerified ?? 'not-reviewed',
      learner_level_review: checklist?.learnerLevelAppropriate ?? 'not-reviewed', rubric_review: checklist?.rubricObservableAndFair ?? 'not-reviewed',
      unresolved_comments: j(review?.unresolvedComments ?? []), unresolved_critical_comments: (review?.unresolvedComments ?? []).filter((comment) => comment.critical && !comment.resolvedAt).length,
      review_evidence_present: reviewEvidence, source_file: c ? CANONICAL_SOURCE : 'src/clinical/migration.ts',
    };
    sheets.Review_Records.push(reviewRow);

    for (const row of rubricRows) for (const ref of JSON.parse(String(row.reference_ids)) as string[]) relationship(rep, ref).rubric.add(String(row.criterion_id));
    for (const row of management) for (const ref of JSON.parse(String(row.reference_ids)) as string[]) relationship(rep, ref).management.add(String(row.management_action_id));
    for (const row of meds) for (const ref of JSON.parse(String(row.reference_ids)) as string[]) relationship(rep, ref).medication.add(String(row.medication_id));
    for (const row of investigations) for (const ref of JSON.parse(String(row.reference_ids)) as string[]) relationship(rep, ref).investigation.add(String(row.test_id));
    for (const ref of refs) relationship(rep, ref);

    const issueBase = { export_case_key: rep.exportCaseKey, case_id: rep.caseId, case_version: rep.caseVersion, automatic_or_manual: 'automatic', recommended_reviewer: 'qualified clinician' };
    if (!c) {
      addIssue({ severity: 'medium', category: 'Missing data', ...issueBase, field_or_section: 'physicalExamination', issue_code: 'LEGACY_PHYSICAL_EXAM_ABSENT', issue_description: 'The legacy schema contains no structured physical-examination findings.', observed_value: null, expected_requirement: 'Independent reviewer needs examination findings or an explicit not-modeled decision.', source_file: LEGACY_SOURCE, blocks_publication: true });
      addIssue({ severity: 'low', category: 'Differential diagnosis problem', ...issueBase, field_or_section: 'diagnosisOptions', issue_code: 'LEGACY_DIFFERENTIAL_RATIONALE_ABSENT', issue_description: 'Legacy diagnosis options have no supporting findings, findings against, or rationale.', observed_value: j(rep.legacy.diagnosisOptions), expected_requirement: 'Each differential should be independently reviewed for plausibility and diagnostic level.', source_file: LEGACY_SOURCE, blocks_publication: true });
      addIssue({ severity: 'information', category: 'Missing data', ...issueBase, field_or_section: 'learningObjectives', issue_code: 'LEGACY_LEARNING_OBJECTIVES_ABSENT', issue_description: 'The legacy schema has no explicit learning objectives.', observed_value: null, expected_requirement: 'Learning objectives must not be invented by the exporter.', source_file: LEGACY_SOURCE, blocks_publication: false });
      addIssue({ severity: rep.legacy.rubric ? 'low' : 'medium', category: rep.legacy.rubric ? 'Missing review evidence' : 'Auto-generated rubric', ...issueBase, field_or_section: 'rubric', issue_code: rep.legacy.rubric ? 'LEGACY_RUBRIC_UNREVIEWED' : 'AUTO_GENERATED_RUBRIC', issue_description: rep.legacy.rubric ? 'An explicit legacy rubric exists but has no recorded qualified-clinician review evidence.' : 'The runtime derives this rubric automatically from legacy fields and generic communication criteria.', observed_value: rep.legacy.rubric ? 'explicit legacy rubric' : 'deriveAutoRubric()', expected_requirement: 'Do not present the rubric as clinically reviewed.', source_file: rep.legacy.rubric ? LEGACY_SOURCE : 'src/data/autoRubric.ts', blocks_publication: true });
      addIssue({ severity: meds[0]?.expected_status === 'missing expectation' ? 'medium' : 'low', category: 'Medication ambiguity', ...issueBase, field_or_section: 'medications', issue_code: meds[0]?.expected_status === 'missing expectation' ? 'MISSING_MEDICATION_EXPECTATION' : 'GENERIC_MEDICATION_RELATIONSHIP_ONLY', issue_description: meds[0]?.expected_status === 'missing expectation' ? 'No medication expectation or generic catalog relationship is stored for this diagnosis.' : 'Only generic catalog indication relationships exist; no case-specific medication expectation is stored.', observed_value: j(meds.map((row) => row.medication_id)), expected_requirement: 'Medication choice and dosing require case-specific clinical review.', source_file: meds[0]?.expected_status === 'missing expectation' ? LEGACY_SOURCE : MED_SOURCE, blocks_publication: true });
    }
    addIssue({ severity: 'high', category: 'Missing review evidence', ...issueBase, field_or_section: 'reviewRecord', issue_code: 'NO_GENUINE_REVIEW_EVIDENCE', issue_description: 'No reviewer identity or approval statement is recorded for this case representation.', observed_value: reviewStatus, expected_requirement: 'A qualified reviewer must record review evidence before publication eligibility.', source_file: c ? CANONICAL_SOURCE : 'src/clinical/migration.ts', blocks_publication: true });
    const unavailable = investigations.filter((row) => row.result_is_unavailable).map((row) => row.test_id);
    if (unavailable.length) addIssue({ severity: 'information', category: 'Missing investigation result', ...issueBase, field_or_section: 'investigations', issue_code: 'INVESTIGATIONS_UNAVAILABLE_NOT_MODELED', issue_description: `${unavailable.length} explicitly unavailable investigations have no case-specific result.`, observed_value: j(unavailable), expected_requirement: 'Unavailable and not-indicated investigations must not fabricate a result.', source_file: 'src/clinical/investigations.ts', blocks_publication: false });
    if (diagnosisOptions.length !== 5 || new Set(diagnosisOptions).size !== 5) addIssue({ severity: 'high', category: 'Differential diagnosis problem', ...issueBase, field_or_section: 'diagnosisOptions', issue_code: 'DIAGNOSIS_OPTION_COUNT_OR_DUPLICATE', issue_description: 'The case does not contain exactly five distinct diagnosis options.', observed_value: j(diagnosisOptions), expected_requirement: 'Exactly five distinct options.', source_file: rep.sourceFile, blocks_publication: true });
    if (diagnosisOptions.filter((id) => id === correctId).length !== 1) addIssue({ severity: 'critical', category: 'Broken relationship', ...issueBase, field_or_section: 'correctDiagnosisId', issue_code: 'CORRECT_DIAGNOSIS_NOT_EXACTLY_ONCE', issue_description: 'The correct diagnosis is not present exactly once among diagnosis options.', observed_value: correctId, expected_requirement: 'Exactly one option must match the correct diagnosis.', source_file: rep.sourceFile, blocks_publication: true });
    for (const id of [...rep.legacy.acceptableTreatmentIds, ...rep.legacy.criticalTreatmentIds]) if (!treatmentIds.has(id)) addIssue({ severity: 'medium', category: 'Broken relationship', ...issueBase, field_or_section: 'treatmentIds', issue_code: 'UNKNOWN_TREATMENT_ID', issue_description: 'A legacy treatment ID does not resolve in the treatment catalog.', observed_value: id, expected_requirement: 'Treatment IDs should resolve in TREATMENTS.', source_file: LEGACY_SOURCE, blocks_publication: true });
    if (c) for (const medication of c.medicationExpectations) if (medication.unit === 'not-finalized' || medication.dose.includes('requires reviewer confirmation')) addIssue({ severity: 'high', category: 'Missing dose', ...issueBase, field_or_section: `medicationExpectations.${medication.medicationId}`, issue_code: 'CANONICAL_DOSE_NOT_FINALIZED', issue_description: 'The case-specific dose is explicitly pending reviewer confirmation.', observed_value: `${medication.dose} ${medication.unit}`, expected_requirement: 'Qualified medication review is required; the exporter must not infer a dose.', source_file: CANONICAL_SOURCE, blocks_publication: true });
    for (const ref of refs) if (referenceStatus.get(ref) !== 'clinician-verified') addIssue({ severity: referenceStatus.get(ref) === 'auto-fetched' ? 'medium' : 'information', category: referenceStatus.has(ref) ? 'Unverified reference' : 'Broken relationship', ...issueBase, field_or_section: 'references', issue_code: referenceStatus.has(ref) ? 'REFERENCE_NOT_CLINICIAN_VERIFIED' : 'UNKNOWN_REFERENCE_ID', issue_description: referenceStatus.has(ref) ? 'The stored reference is not marked clinician-verified.' : 'The referenced ID does not resolve in either reference registry.', observed_value: `${ref}:${referenceStatus.get(ref) ?? 'missing'}`, expected_requirement: 'Preserve stored status and obtain independent reference review.', source_file: referenceStatus.get(ref) === 'auto-fetched' ? GUIDELINE_SOURCE : 'src/clinical/references.ts', blocks_publication: true });
  }

  const duplicateLegacyIds = new Map<string, number>();
  for (const { patientCase } of legacy) duplicateLegacyIds.set(patientCase.id, (duplicateLegacyIds.get(patientCase.id) ?? 0) + 1);
  for (const [id, count] of duplicateLegacyIds) if (count > 1) addIssue({ severity: 'critical', category: 'Duplicate ID', export_case_key: null, case_id: id, case_version: 'legacy-1', field_or_section: 'POLYCLINIC_CASES', issue_code: 'DUPLICATE_LEGACY_CASE_ID', issue_description: 'A legacy case ID occurs in more than one non-virtual specialty collection.', observed_value: count, expected_requirement: 'Legacy case IDs must be unique.', source_file: LEGACY_SOURCE, automatic_or_manual: 'automatic', blocks_publication: true, recommended_reviewer: 'technical maintainer' });

  for (const mapping of LEGACY_CASE_MIGRATIONS.slice().sort((a, b) => a.legacyCaseId.localeCompare(b.legacyCaseId))) sheets.Legacy_Migration.push({
    legacy_case_id: mapping.legacyCaseId, canonical_case_id: mapping.canonicalCaseId, canonical_version: mapping.migratedVersion,
    migration_status: mapping.migrationStatus, legacy_review_status: 'legacy-unreviewed',
    canonical_review_status: mapping.canonicalCaseId ? CLINICAL_CASES.find((item) => item.caseId === mapping.canonicalCaseId)?.reviewStatus ?? null : null,
    historical_compatibility_preserved: true, migration_notes: mapping.notes, legacy_source_file: LEGACY_SOURCE,
    canonical_source_file: mapping.canonicalCaseId ? CANONICAL_SOURCE : null,
  });

  for (const [relationshipKey, item] of [...caseReferenceRelationships].sort(([a], [b]) => a.localeCompare(b))) sheets.Case_Reference_Matrix.push({
    export_case_key: item.rep.exportCaseKey, case_id: item.rep.caseId, case_version: item.rep.caseVersion,
    specialty_id: item.rep.specialtyId, case_topic: item.rep.canonical?.title ?? item.rep.legacy.chiefComplaint,
    reference_id: relationshipKey.slice(item.rep.exportCaseKey.length + 1),
    reference_role: 'unspecified', rubric_criterion_ids: j([...item.rubric].sort()), management_action_ids: j([...item.management].sort()),
    medication_ids: j([...item.medication].sort()), investigation_ids: j([...item.investigation].sort()),
    verification_status: null, review_status: item.rep.canonical?.reviewStatus ?? 'legacy-unreviewed',
  });
  for (const row of sheets.Case_Reference_Matrix) {
    row.verification_status = referenceStatus.get(String(row.reference_id)) ?? 'missing';
  }

  const casesByReference = new Map<string, string[]>();
  for (const row of sheets.Case_Reference_Matrix) {
    const id = String(row.reference_id);
    const keys = casesByReference.get(id) ?? [];
    keys.push(String(row.export_case_key));
    casesByReference.set(id, keys);
  }
  for (const reference of CLINICAL_REFERENCES.slice().sort((a, b) => a.referenceId.localeCompare(b.referenceId))) {
    const cases = [...new Set(casesByReference.get(reference.referenceId) ?? [])].sort();
    sheets.References.push({ reference_id: reference.referenceId, organization: reference.organization, title: reference.title,
      publication_year: reference.publicationYear, version: reference.version ?? null, region: reference.region,
      source_type: reference.sourceType, url: reference.url, doi: reference.doi ?? null, pubmed_id: reference.pubmedId ?? null,
      section: reference.section ?? null, recommendation_id: reference.recommendationId ?? null, page: reference.page ?? null,
      accessed_at: reference.accessedAt, verification_status: reference.verificationStatus, superseded_by: reference.supersededBy ?? null,
      notes: reference.notes ?? null, cases_using_reference: j(cases), number_of_cases_using_reference: cases.length,
      source_file: 'src/clinical/references.ts' });
  }
  for (const guideline of GUIDELINES.slice().sort((a, b) => a.id.localeCompare(b.id))) for (const recommendation of guideline.recommendations.slice().sort((a, b) => a.recId.localeCompare(b.recId))) {
    const id = `${guideline.id}:${recommendation.recId}`;
    const cases = [...new Set(casesByReference.get(id) ?? [])].sort();
    sheets.References.push({ reference_id: id, organization: guideline.body, title: guideline.title,
      publication_year: guideline.year, version: null, region: guideline.region, source_type: 'clinical-practice-guideline',
      url: guideline.url, doi: guideline.doi ?? null, pubmed_id: guideline.pubmedId ?? null,
      section: recommendation.topic, recommendation_id: recommendation.recId, page: null, accessed_at: guideline.lastVerified,
      verification_status: guideline.verificationStatus, superseded_by: guideline.supersededBy ?? null,
      notes: j({ guidelineNotes: guideline.notes ?? null, recommendationText: recommendation.text, system: recommendation.system, pdfUrl: guideline.pdfUrl ?? null }),
      cases_using_reference: j(cases), number_of_cases_using_reference: cases.length, source_file: GUIDELINE_SOURCE });
  }

  const severityOrder = new Map(['critical','high','medium','low','information'].map((value, index) => [value, index]));
  for (const name of Object.keys(sheets) as SheetName[]) sheets[name].sort((a, b) => {
    if (name === 'Issues') {
      const severity = (severityOrder.get(String(a.severity)) ?? 99) - (severityOrder.get(String(b.severity)) ?? 99);
      if (severity) return severity;
    }
    const aKey = String(a.export_case_key ?? a.legacy_case_id ?? a.reference_id ?? a.issue_id ?? '');
    const bKey = String(b.export_case_key ?? b.legacy_case_id ?? b.reference_id ?? b.issue_id ?? '');
    return aKey.localeCompare(bKey) || stableStringify(a).localeCompare(stableStringify(b));
  });
  const legacyConceptIds = [...new Set(legacy.map(({ patientCase }) => patientCase.id))].sort();
  const statuses = new Map<string, number>();
  const specialtyStatuses = new Map<string, number>();
  for (const row of sheets.Case_Index) {
    const status = String(row.review_status);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    const key = `${row.specialty_id}\u0000${status}`;
    specialtyStatuses.set(key, (specialtyStatuses.get(key) ?? 0) + 1);
  }
  const specialtyStatusRows = [...specialtyStatuses].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => {
    const [specialtyId, reviewStatus] = key.split('\u0000');
    return { specialty_id: specialtyId, specialty_name: CLINIC_LABELS[specialtyId as ClinicId], review_status: reviewStatus, representation_count: count };
  });
  const severityCounts = Object.fromEntries(['critical','high','medium','low','information'].map((severity) => [severity, sheets.Issues.filter((row) => row.severity === severity).length]));
  const files = sourceFilesScanned();
  const exportMetadata: Record<string, unknown> = {
    project_name: 'MedSim', export_generated_at: options.generatedAt, git_commit: options.gitCommit,
    working_tree_status: options.workingTreeStatus, total_unique_case_versions: representations.length,
    unique_clinical_concepts: legacyConceptIds.length, duplicate_representations: representations.length - legacyConceptIds.length,
    total_legacy_cases: legacy.length, total_canonical_cases: CLINICAL_CASES.length,
    total_approved_formative: statuses.get('approved-formative') ?? 0, total_clinical_review: statuses.get('clinical-review') ?? 0,
    total_legacy_unreviewed: statuses.get('legacy-unreviewed') ?? 0, total_draft: statuses.get('draft') ?? 0,
    total_retired: statuses.get('retired') ?? 0, specialty_count: new Set(legacy.map((item) => item.specialtyId)).size,
    reference_count: sheets.References.length, rubric_criterion_count: sheets.Rubric_Criteria.length,
    investigation_row_count: sheets.Investigations.length, medication_row_count: sheets.Medications.length,
    issue_count_by_severity: severityCounts, source_files_scanned: files, export_script_version: EXPORT_SCRIPT_VERSION,
    limitations: [
      'For independent clinical review — not evidence of medical accreditation.',
      'The 243 Case_Index rows are versioned representations: 240 legacy versions plus 3 canonical pilot versions mapped to the same underlying legacy concepts. They represent 240 unique clinical concepts, not 243 independent clinically approved cases.',
      'Only case-catalogued investigations are listed. Unavailable and not-indicated options never receive a fabricated result.',
      'Legacy medication rows are generic catalog relationships only unless explicitly marked otherwise.',
      'No case is currently approved-formative, and no genuine clinician review evidence is recorded.',
      'Clinical plausibility and medical validity require independent qualified-clinician review.',
      'src/data/patients.ts was requested for inspection but does not exist in the current repository.',
    ],
  };
  const jsonCases = representations.map((rep) => ({
    export_case_key: rep.exportCaseKey, case_id: rep.caseId,
    canonical_case_id: migrationById.get(rep.caseId)?.canonicalCaseId ?? null, legacy_case_id: rep.caseId,
    case_version: rep.caseVersion, case_system: rep.caseSystem, specialty_id: rep.specialtyId,
    review_status: rep.canonical?.reviewStatus ?? 'legacy-unreviewed', source_file: rep.sourceFile,
    source_export_name: rep.sourceExportName, record_hash: sha256(rep.rawRecord), raw_record: rep.rawRecord,
  }));
  const jsonReferences = sheets.References.map((row) => ({ ...row, record_hash: sha256(row) }));
  const jsonReviews = sheets.Review_Records.map((row) => ({ ...row, record_hash: sha256(row) }));
  const jsonMappings = sheets.Legacy_Migration.map((row) => ({ ...row, record_hash: sha256(row) }));
  const jsonIssues = sheets.Issues.map((row) => ({ ...row, record_hash: sha256(row) }));
  return { exportMetadata, cases: jsonCases, references: jsonReferences, reviewRecords: jsonReviews, legacyMappings: jsonMappings, issues: jsonIssues, sheets, specialtyStatusRows };
}
