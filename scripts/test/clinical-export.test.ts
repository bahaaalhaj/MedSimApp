import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportModel, SHEET_COLUMNS, stableStringify } from '../clinical/export-review-model.ts';
import { validateExportModel } from '../clinical/export-review.ts';

const options = { generatedAt: '2026-09-10T00:00:00.000Z', gitCommit: 'test-commit', workingTreeStatus: 'test-status' };

test('clinical review export reconciles legacy and canonical representations', () => {
  const model = buildExportModel(options);
  assert.equal(model.exportMetadata.unique_clinical_concepts, 240);
  assert.equal(model.exportMetadata.total_legacy_cases, 240);
  assert.equal(model.exportMetadata.total_canonical_cases, 72);
  assert.equal(model.exportMetadata.total_unique_case_versions, 312);
  assert.equal(model.exportMetadata.duplicate_representations, 72);
  assert.equal(model.exportMetadata.total_approved_formative, 0);
  assert.equal(model.sheets.Case_Index.length, 312);
  validateExportModel(model);
});

test('clinical review export is deterministic and every normalized sheet has exact headers', () => {
  const first = buildExportModel(options);
  const second = buildExportModel(options);
  assert.equal(stableStringify(first), stableStringify(second));
  for (const [sheetName, headers] of Object.entries(SHEET_COLUMNS)) {
    assert.ok(first.sheets[sheetName as keyof typeof SHEET_COLUMNS].length > 0, `${sheetName} should not be empty`);
    const keys = new Set(Object.keys(first.sheets[sheetName as keyof typeof SHEET_COLUMNS][0]));
    for (const header of headers) assert.ok(keys.has(header), `${sheetName} is missing ${header}`);
  }
});

test('investigation export contains only modeled case-specific results and never substitutes defaults', () => {
  const model = buildExportModel(options);
  assert.equal(model.sheets.Investigations.length, 1210);
  assert.ok(model.sheets.Investigations.some((row) => row.result_is_case_specific === true));
  assert.equal(model.sheets.Investigations.some((row) => row.result_source === 'UNAVAILABLE / NOT MODELED'), false);
  assert.equal(model.sheets.Investigations.some((row) => row.result_is_default === true), false);
  assert.equal(model.sheets.Investigation_Catalogue.length, 422);
  assert.equal(model.sheets.Investigation_Review_Queue.length, 422);
});

test('all child case and reference relationships resolve', () => {
  const model = buildExportModel(options);
  const caseKeys = new Set(model.sheets.Case_Index.map((row) => row.export_case_key));
  const referenceIds = new Set(model.sheets.References.map((row) => row.reference_id));
  for (const [sheetName, rows] of Object.entries(model.sheets)) {
    if (['Case_Index', 'References', 'Legacy_Migration', 'Issues'].includes(sheetName)) continue;
    for (const row of rows) if (row.export_case_key !== null) assert.ok(caseKeys.has(row.export_case_key), `${sheetName}: ${row.export_case_key}`);
  }
  for (const row of model.sheets.Case_Reference_Matrix) assert.ok(referenceIds.has(row.reference_id), String(row.reference_id));
});
