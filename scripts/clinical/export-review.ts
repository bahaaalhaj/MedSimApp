import { createRequire } from 'node:module';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { buildExportModel, SHEET_COLUMNS, stableStringify, type ExportModel, type Row, type SheetName } from './export-review-model.ts';
import {
  CANONICAL_CLINICAL_CHECKSUM,
  GENERATED_PATHS,
  type ReviewArtifactChecksums,
} from './generated-artifacts.ts';
import {
  CANONICAL_CLINICAL_SOURCE,
  CLINICAL_GENERATOR_COMMAND,
  GENERATED_NOTICE,
  REPRODUCIBLE_GENERATED_AT,
  generatedMetadata,
  jsonSemanticSha256,
  semanticSha256,
} from './generation-metadata.ts';

const OUTPUT_DIR = resolve('docs/generated');
const XLSX_PATH = GENERATED_PATHS.reviewXlsx;
const JSON_PATH = GENERATED_PATHS.reviewJson;
const EXPECTED_SHEETS = [
  'Case_Index','Patient_Profile','Vital_Signs','History_Questions','Physical_Examination','Investigations',
  'Investigation_Catalogue','Case_Investigation_Roles','Investigation_Results','Investigation_Diff_Links',
  'Investigation_References','Investigation_Scoring','Investigation_Safety','Investigation_Review_Queue',
  'Case_Investigation_Matrix','Laboratory_Results','Imaging_Results','Investigation_Reference_Matrix',
  'Image_Provenance','Investigation_Issues','Investigation_Audit_Summary',
  'Differential_Diagnoses','Management','Medications','Rubric_Criteria','Learning_Objectives','References',
  'Case_Reference_Matrix','Review_Records','Legacy_Migration','Issues','Export_Summary',
] as const;
const TEAL = '#075E5B';
const LIGHT_TEAL = '#DCEFED';
const FONT = 'Arial';
const MAX_EXCEL_CELL = 32_767;
const REPRODUCIBLE_REVIEW_OPTIONS = {
  generatedAt: REPRODUCIBLE_GENERATED_AT,
  gitCommit: 'not-embedded-in-reproducible-export',
  workingTreeStatus: 'not-embedded-in-reproducible-export',
};

async function loadArtifactTool(): Promise<any> {
  try {
    return await import('@oai/artifact-tool');
  } catch (initialError) {
    const userProfile = process.env.USERPROFILE;
    const runtimeModules = userProfile
      ? join(userProfile, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules')
      : '';
    if (!runtimeModules || !existsSync(runtimeModules)) throw initialError;
    const entry = createRequire(import.meta.url).resolve('@oai/artifact-tool', { paths: [runtimeModules] });
    return import(pathToFileURL(entry).href);
  }
}

function columnName(index: number): string {
  let value = index + 1;
  let output = '';
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function cellValue(value: Row[string]): Row[string] {
  if (typeof value === 'string' && value.length > MAX_EXCEL_CELL) {
    return `${value.slice(0, MAX_EXCEL_CELL - 80)}\n[TRUNCATED IN XLSX; full value preserved in JSON snapshot]`;
  }
  return value;
}

function matrixFor(headers: readonly string[], rows: Row[]): Array<Array<Row[string]>> {
  return [headers.map((header) => header), ...rows.map((row) => headers.map((header) => cellValue(row[header] ?? null)))];
}

function widthFor(header: string): number {
  if (header.includes('url')) return 42;
  if (header.includes('description') || header.includes('rationale') || header.includes('evidence') || header.includes('notes') || header.includes('history') || header.includes('result') || header.includes('complaint') || header.includes('finding') || header.includes('requirement') || header.includes('limitations') || header.includes('source_files')) return 44;
  if (header.includes('hash')) return 28;
  if (header.endsWith('_ids') || header.includes('alternatives') || header.includes('comments') || header.includes('observed_value')) return 34;
  if (header.includes('name') || header.includes('title') || header.includes('action')) return 28;
  if (header.includes('source_file') || header === 'export_case_key') return 31;
  if (header.includes('status') || header.includes('classification') || header.includes('eligibility')) return 23;
  if (header.includes('id')) return 24;
  return 17;
}

function styleTableSheet(sheet: any, headers: readonly string[], rowCount: number): void {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  const lastColumn = columnName(headers.length - 1);
  const lastRow = Math.max(rowCount + 1, 1);
  const used = sheet.getRange(`A1:${lastColumn}${lastRow}`);
  used.format.font = { name: FONT, size: 10, color: '#1F2937' };
  used.format.verticalAlignment = 'top';
  if (rowCount > 0) {
    const body = sheet.getRange(`A2:${lastColumn}${lastRow}`);
    body.format.wrapText = true;
  }
  const header = sheet.getRange(`A1:${lastColumn}1`);
  header.format = {
    fill: TEAL,
    font: { name: FONT, size: 10, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'inside', style: 'thin', color: '#D5ECEA' },
  };
  header.format.rowHeight = 32;
  headers.forEach((name, index) => {
    sheet.getRange(`${columnName(index)}:${columnName(index)}`).format.columnWidth = widthFor(name);
  });
}

function addStatusFormatting(sheet: any, headers: readonly string[], rowCount: number): void {
  if (rowCount === 0) return;
  const statusIndexes = headers.map((header, index) => header.includes('status') || header === 'publication_eligibility' ? index : -1).filter((index) => index >= 0);
  const colors: Record<string, [string, string]> = {
    'approved-formative': ['#D8F3DC', '#166534'],
    'clinical-review': ['#FFF1C2', '#854D0E'],
    'technical-review': ['#DBEAFE', '#1E40AF'],
    'revision-required': ['#FEE2E2', '#991B1B'],
    'legacy-unreviewed': ['#E5E7EB', '#374151'],
    'draft': ['#EDE9FE', '#5B21B6'],
    'retired': ['#D1D5DB', '#4B5563'],
  };
  for (const index of statusIndexes) {
    const range = sheet.getRange(`${columnName(index)}2:${columnName(index)}${rowCount + 1}`);
    for (const [text, [fill, color]] of Object.entries(colors)) {
      range.conditionalFormats.add('containsText', { text, format: { fill, font: { bold: true, color } } });
    }
  }
}

function addSeverityFormatting(sheet: any, headers: readonly string[], rowCount: number): void {
  const index = headers.indexOf('severity');
  if (index < 0 || rowCount === 0) return;
  const range = sheet.getRange(`${columnName(index)}2:${columnName(index)}${rowCount + 1}`);
  const colors: Record<string, [string, string]> = {
    critical: ['#7F1D1D', '#FFFFFF'], high: ['#FECACA', '#991B1B'], medium: ['#FED7AA', '#9A3412'],
    low: ['#FEF3C7', '#92400E'], information: ['#DBEAFE', '#1E40AF'],
  };
  for (const [text, [fill, color]] of Object.entries(colors)) {
    range.conditionalFormats.add('containsText', { text, format: { fill, font: { bold: true, color } } });
  }
}

export function validateExportModel(model: ExportModel): void {
  const failures: string[] = [];
  const indexKeys = new Set(model.sheets.Case_Index.map((row) => String(row.export_case_key)));
  if (indexKeys.size !== model.sheets.Case_Index.length) failures.push('Case_Index contains duplicate export_case_key values.');
  const caseVersionKeys = new Set(model.sheets.Case_Index.map((row) => `${row.case_system}:${row.case_id}@${row.case_version}`));
  if (caseVersionKeys.size !== model.sheets.Case_Index.length) failures.push('Case_Index contains duplicate system/case/version rows.');
  for (const [sheetName, rows] of Object.entries(model.sheets)) {
    if (rows.length === 0) failures.push(`${sheetName} is unexpectedly empty.`);
    if (sheetName !== 'Case_Index' && sheetName !== 'References' && sheetName !== 'Legacy_Migration' && sheetName !== 'Issues') {
      for (const row of rows) if (row.export_case_key && !indexKeys.has(String(row.export_case_key))) failures.push(`${sheetName} has an unknown export_case_key ${row.export_case_key}.`);
    }
    const headers = SHEET_COLUMNS[sheetName as SheetName];
    for (const row of rows) for (const header of headers) if (!(header in row)) failures.push(`${sheetName} row is missing column ${header}.`);
  }
  const referenceIds = new Set(model.sheets.References.map((row) => String(row.reference_id)));
  for (const row of model.sheets.Case_Reference_Matrix) if (!referenceIds.has(String(row.reference_id))) failures.push(`Unknown reference ${row.reference_id}.`);
  const diagnosisRows = new Map<string, Row[]>();
  for (const row of model.sheets.Differential_Diagnoses) {
    const key = String(row.export_case_key);
    diagnosisRows.set(key, [...(diagnosisRows.get(key) ?? []), row]);
  }
  for (const index of model.sheets.Case_Index) {
    const options = diagnosisRows.get(String(index.export_case_key)) ?? [];
    if (options.length !== 5) failures.push(`${index.export_case_key} has ${options.length} diagnosis rows.`);
    if (options.filter((row) => row.is_correct === true).length !== 1) failures.push(`${index.export_case_key} does not have exactly one correct diagnosis row.`);
    if (!options.some((row) => row.diagnosis_option_id === index.correct_diagnosis_id)) failures.push(`${index.export_case_key} correct diagnosis does not resolve.`);
  }
  const canonicalIds = new Set(model.sheets.Case_Index.filter((row) => row.case_system === 'canonical').map((row) => String(row.case_id)));
  for (const mapping of model.sheets.Legacy_Migration) if (mapping.canonical_case_id && !canonicalIds.has(String(mapping.canonical_case_id))) failures.push(`Migration does not resolve: ${mapping.legacy_case_id}.`);
  if (model.cases.length !== model.sheets.Case_Index.length) failures.push('JSON case count does not match Case_Index.');
  for (const record of model.cases) if (!indexKeys.has(String(record.export_case_key))) failures.push(`JSON case missing from index: ${record.export_case_key}.`);
  const sensitive = /password[_ -]?hash|api[_ -]?key|session[_ -]?token|backend[_ -]?shared[_ -]?secret/i;
  if (sensitive.test(stableStringify({ cases: model.cases, references: model.references, reviewRecords: model.reviewRecords }))) failures.push('Potential sensitive-data key detected.');
  if (failures.length) throw new Error(`Export model validation failed:\n- ${[...new Set(failures)].join('\n- ')}`);
}

function reviewClinicalPayload(model: ExportModel) {
  return {
    cases: model.cases,
    references: model.references,
    reviewRecords: model.reviewRecords,
    legacyMappings: model.legacyMappings,
    issues: model.issues,
  };
}

export function reviewArtifactChecksums(model: ExportModel): ReviewArtifactChecksums {
  return {
    jsonSemanticChecksum: jsonSemanticSha256(reviewClinicalPayload(model)),
    workbookSemanticChecksum: semanticSha256({
      sheets: model.sheets,
      specialtyStatusRows: model.specialtyStatusRows,
    }),
  };
}

export function buildReproducibleReviewModel(): ExportModel {
  const model = buildExportModel(REPRODUCIBLE_REVIEW_OPTIONS);
  const checksums = reviewArtifactChecksums(model);
  Object.assign(model.exportMetadata, {
    auto_generated_notice: GENERATED_NOTICE,
    canonical_source_file: CANONICAL_CLINICAL_SOURCE,
    generator_command: CLINICAL_GENERATOR_COMMAND,
    canonical_source_checksum: `sha256:${CANONICAL_CLINICAL_CHECKSUM}`,
    semantic_checksum: `sha256:${checksums.workbookSemanticChecksum}`,
  });
  return model;
}

export function reviewJsonString(model: ExportModel): string {
  const checksums = reviewArtifactChecksums(model);
  return `${JSON.stringify({
    _generated: generatedMetadata(CANONICAL_CLINICAL_CHECKSUM, checksums.jsonSemanticChecksum),
    exportMetadata: model.exportMetadata,
    ...reviewClinicalPayload(model),
  }, null, 2)}\n`;
}

async function createWorkbook(model: ExportModel, artifact: any): Promise<any> {
  const workbook = artifact.Workbook.create();
  for (const sheetName of EXPECTED_SHEETS) workbook.worksheets.add(sheetName);
  for (const sheetName of Object.keys(SHEET_COLUMNS) as SheetName[]) {
    const sheet = workbook.worksheets.getItem(sheetName);
    const headers = SHEET_COLUMNS[sheetName];
    const rows = model.sheets[sheetName];
    const matrix = matrixFor(headers, rows);
    sheet.getRangeByIndexes(0, 0, matrix.length, headers.length).values = matrix;
    const table = sheet.tables.add(`A1:${columnName(headers.length - 1)}${matrix.length}`, true, `${sheetName.replace(/[^A-Za-z0-9]/g, '')}Table`);
    table.style = 'TableStyleMedium2';
    table.showFilterButton = true;
    styleTableSheet(sheet, headers, rows.length);
    addStatusFormatting(sheet, headers, rows.length);
    if (sheetName === 'Issues') addSeverityFormatting(sheet, headers, rows.length);
  }

  const summary = workbook.worksheets.getItem('Export_Summary');
  summary.showGridLines = false;
  summary.freezePanes.freezeRows(4);
  summary.getRange('A1').values = [['MedSim clinical case review export']];
  summary.getRange('A1').format.font = { name: FONT, size: 15, bold: true, color: TEAL };
  summary.getRange('A2').values = [['For independent clinical review — not evidence of medical accreditation.']];
  summary.getRange('A2').format.font = { name: FONT, size: 11, italic: true, color: '#7F1D1D' };
  const metadataHeaders = [
    'project_name','export_generated_at','git_commit','working_tree_status','total_unique_case_versions','total_legacy_cases',
    'total_canonical_cases','total_approved_formative','total_clinical_review','total_legacy_unreviewed','total_draft','total_retired',
    'specialty_count','reference_count','rubric_criterion_count','investigation_row_count','medication_row_count','issue_count_by_severity',
    'source_files_scanned','export_script_version','limitations',
    'auto_generated_notice','canonical_source_file','generator_command','canonical_source_checksum','semantic_checksum',
  ];
  const metadataLastColumn = columnName(metadataHeaders.length - 1);
  const metadataMatrix = [metadataHeaders, metadataHeaders.map((header) => {
    const value = model.exportMetadata[header];
    return cellValue(typeof value === 'object' ? JSON.stringify(value) : value as Row[string]);
  })];
  summary.getRange('B5').format.numberFormat = '@';
  summary.getRangeByIndexes(3, 0, 2, metadataHeaders.length).values = metadataMatrix;
  const metadataTable = summary.tables.add(`A4:${columnName(metadataHeaders.length - 1)}5`, true, 'ExportMetadataTable');
  metadataTable.style = 'TableStyleMedium2';
  metadataTable.showFilterButton = true;
  summary.getRange('B5').format.numberFormat = 'yyyy-mm-dd hh:mm:ss';
  summary.getRange(`A4:${metadataLastColumn}4`).format = { fill: TEAL, font: { name: FONT, size: 10, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
  summary.getRange(`A4:${metadataLastColumn}4`).format.rowHeight = 32;
  summary.getRange(`A5:${metadataLastColumn}5`).format.wrapText = true;
  const specialtyHeaders = ['specialty_id','specialty_name','review_status','representation_count'];
  const specialtyMatrix = matrixFor(specialtyHeaders, model.specialtyStatusRows);
  summary.getRangeByIndexes(7, 0, specialtyMatrix.length, specialtyHeaders.length).values = specialtyMatrix;
  const specialtyTable = summary.tables.add(`A8:D${7 + specialtyMatrix.length}`, true, 'SpecialtyStatusTable');
  specialtyTable.style = 'TableStyleMedium2';
  specialtyTable.showFilterButton = true;
  const specialtyHeader = summary.getRange('A8:D8');
  specialtyHeader.format = { fill: TEAL, font: { name: FONT, size: 10, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
  addStatusFormatting(summary, specialtyHeaders, model.specialtyStatusRows.length + 6);
  summary.getRange('A1:U2').format.wrapText = false;
  summary.getRange('A1:U2').format.rowHeight = 30;
  summary.getRange('A1:U2').format.fill = '#FFFFFF';
  summary.getRange('A6:U7').format.fill = '#FFFFFF';
  summary.getRange('A6').values = [['Specialty by review status (representation counts)']];
  summary.getRange('A6').format.font = { name: FONT, size: 12, bold: true, color: TEAL };
  summary.getRange(`A1:${metadataLastColumn}50`).format.font.name = FONT;
  summary.getRange(`A1:${metadataLastColumn}50`).format.verticalAlignment = 'top';
  summary.getRange(`A:${metadataLastColumn}`).format.columnWidth = 23;
  summary.getRange('A:A').format.columnWidth = 42;
  summary.getRange('B:B').format.columnWidth = 31;
  summary.getRange('D:D').format.columnWidth = 34;
  summary.getRange('R:U').format.columnWidth = 44;
  summary.getRange('V:Z').format.columnWidth = 38;
  summary.tabColor = TEAL;
  workbook.recalculate();
  return workbook;
}

async function validateSavedWorkbook(path: string, model: ExportModel, artifact: any): Promise<void> {
  const input = await artifact.FileBlob.load(path);
  const workbook = await artifact.SpreadsheetFile.importXlsx(input);
  const sheetNames = workbook.worksheets.items.map((sheet: any) => sheet.name);
  if (stableStringify(sheetNames) !== stableStringify(EXPECTED_SHEETS)) throw new Error(`Unexpected workbook sheets: ${sheetNames.join(', ')}`);
  for (const sheetName of EXPECTED_SHEETS) {
    const sheet = workbook.worksheets.getItem(sheetName);
    const used = sheet.getUsedRange(true);
    if (!used) throw new Error(`${sheetName} has no used range after reopening.`);
    if (sheetName !== 'Export_Summary') {
      const expectedRows = model.sheets[sheetName as SheetName].length + 1;
      const expectedHeaders = SHEET_COLUMNS[sheetName as SheetName];
      const lastColumn = columnName(expectedHeaders.length - 1);
      const reopenedHeaders = sheet.getRange(`A1:${lastColumn}1`).values[0];
      if (stableStringify(reopenedHeaders) !== stableStringify(expectedHeaders)) throw new Error(`${sheetName} headers changed during XLSX export.`);
      const finalRow = sheet.getRange(`A${expectedRows}:${lastColumn}${expectedRows}`).values[0];
      if (!finalRow.some((value: unknown) => value !== null && value !== '')) throw new Error(`${sheetName} final expected row is empty after reopening.`);
      const followingRow = sheet.getRange(`A${expectedRows + 1}:${lastColumn}${expectedRows + 1}`).values[0];
      if (followingRow.some((value: unknown) => value !== null && value !== '')) throw new Error(`${sheetName} contains unexpected rows after ${expectedRows}.`);
    } else {
      const savedChecksum = sheet.getRange('Z5').values[0][0];
      if (savedChecksum !== model.exportMetadata.semantic_checksum) {
        throw new Error('Export_Summary semantic checksum does not match the canonical review model.');
      }
    }
    const preview = await workbook.render({ sheetName, range: sheetName === 'Export_Summary' ? 'A1:H18' : `A1:${columnName(Math.min((SHEET_COLUMNS[sheetName as SheetName]?.length ?? 8) - 1, 7))}${Math.min((model.sheets[sheetName as SheetName]?.length ?? 12) + 1, 13)}`, scale: 1, format: 'png' });
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    if (previewBytes.length < 500) throw new Error(`${sheetName} preview was unexpectedly small.`);
    if (process.env.MEDSIM_EXPORT_PREVIEW_DIR) {
      await mkdir(process.env.MEDSIM_EXPORT_PREVIEW_DIR, { recursive: true });
      await writeFile(join(process.env.MEDSIM_EXPORT_PREVIEW_DIR, `${sheetName}.png`), previewBytes);
    }
  }
  const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 300 }, summary: 'final formula error scan' });
  if (errors.ndjson && /"match"/.test(errors.ndjson)) throw new Error(`Formula error detected: ${errors.ndjson.slice(0, 2000)}`);
}

async function normalizeXlsxContainer(path: string): Promise<void> {
  const unpacked = unzipSync(await readFile(path));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const relationshipPaths = Object.keys(unpacked).filter((name) => name.endsWith('.rels')).sort();
  for (const relationshipPath of relationshipPaths) {
    let relationships = decoder.decode(unpacked[relationshipPath]);
    const tags = [...relationships.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\/>/g)]
      .map((match) => ({ id: match[1], semanticTag: match[0].replace(/\sId="[^"]+"/, '') }))
      .sort((left, right) => left.semanticTag.localeCompare(right.semanticTag));
    const marker = '/_rels/';
    const markerIndex = relationshipPath.lastIndexOf(marker);
    const sourcePath = relationshipPath === '_rels/.rels' || markerIndex < 0
      ? null
      : `${relationshipPath.slice(0, markerIndex)}/${relationshipPath.slice(markerIndex + marker.length, -'.rels'.length)}`;
    let source = sourcePath && unpacked[sourcePath] ? decoder.decode(unpacked[sourcePath]) : null;
    tags.forEach(({ id }, index) => {
      const stableId = `rId${index + 1}`;
      relationships = relationships.replaceAll(`"${id}"`, `"${stableId}"`);
      if (source !== null) source = source.replaceAll(`"${id}"`, `"${stableId}"`);
    });
    unpacked[relationshipPath] = encoder.encode(relationships);
    if (sourcePath && source !== null) unpacked[sourcePath] = encoder.encode(source);
  }
  const reproducibleFiles: Zippable = {};
  const fixedTimestamp = new Date('1980-01-01T00:00:00.000Z');
  for (const name of Object.keys(unpacked).sort()) {
    reproducibleFiles[name] = [unpacked[name], { level: 6, mtime: fixedTimestamp }];
  }
  await writeFile(path, zipSync(reproducibleFiles, { level: 6, mtime: fixedTimestamp }));
}

export async function exportClinicalReview(): Promise<{ model: ExportModel; xlsxPath: string; jsonPath: string }> {
  const model = buildReproducibleReviewModel();
  validateExportModel(model);
  const repeat = buildReproducibleReviewModel();
  if (stableStringify(model) !== stableStringify(repeat)) throw new Error('Two unchanged model builds were not semantically identical.');
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(JSON_PATH, reviewJsonString(model), 'utf8');
  JSON.parse(await readFile(JSON_PATH, 'utf8'));
  const artifact = await loadArtifactTool();
  console.log('Creating formatted XLSX workbook...');
  const workbook = await createWorkbook(model, artifact);
  const output = await artifact.SpreadsheetFile.exportXlsx(workbook);
  await output.save(XLSX_PATH);
  await normalizeXlsxContainer(XLSX_PATH);
  const artifactInspectSidecar = `${XLSX_PATH}.inspect.ndjson`;
  if (existsSync(artifactInspectSidecar)) await unlink(artifactInspectSidecar);
  console.log(`Reopening and checking all ${EXPECTED_SHEETS.length} worksheets...`);
  await validateSavedWorkbook(XLSX_PATH, model, artifact);
  return { model, xlsxPath: XLSX_PATH, jsonPath: JSON_PATH };
}

export async function verifyClinicalReviewArtifacts(): Promise<string[]> {
  const model = buildReproducibleReviewModel();
  validateExportModel(model);
  const stale: string[] = [];
  try {
    if (await readFile(JSON_PATH, 'utf8') !== reviewJsonString(model)) stale.push(JSON_PATH);
  } catch {
    stale.push(JSON_PATH);
  }
  if (!existsSync(XLSX_PATH)) {
    stale.push(XLSX_PATH);
  } else {
    try {
      const artifact = await loadArtifactTool();
      await validateSavedWorkbook(XLSX_PATH, model, artifact);
    } catch {
      stale.push(XLSX_PATH);
    }
  }
  return stale;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  exportClinicalReview().then(({ model, xlsxPath, jsonPath }) => {
    const counts = Object.fromEntries(Object.entries(model.sheets).map(([name, rows]) => [name, rows.length]));
    console.log(JSON.stringify({ xlsxPath, jsonPath, uniqueClinicalConcepts: model.exportMetadata.unique_clinical_concepts, caseVersions: model.exportMetadata.total_unique_case_versions, sheetRows: counts }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

void dirname(fileURLToPath(import.meta.url));
