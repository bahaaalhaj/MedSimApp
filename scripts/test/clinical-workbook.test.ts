import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildReproducibleReviewModel, validateReviewWorkbookStructure } from '../clinical/export-review.ts';

const model = buildReproducibleReviewModel();
const original = resolve('docs/generated/medsim-medical-cases-review.xlsx');
const bytes = readFileSync(original);
const unpacked = unzipSync(bytes);
const fixtureDir = mkdtempSync(join(tmpdir(), 'medsim-workbook-ci-'));
after(() => {
  assert.equal(dirname(fixtureDir), resolve(tmpdir()));
  rmSync(fixtureDir, { recursive: true, force: true });
});

function mutated(entry: string, change: (xml: string) => string): string {
  const current = strFromU8(unpacked[entry]);
  const next = change(current);
  assert.notEqual(next, current, 'fixture mutation must actually change the workbook');
  const path = join(fixtureDir, 'changed.xlsx');
  writeFileSync(path, zipSync({ ...unpacked, [entry]: strToU8(next) }, { level: 1 }));
  return path;
}

test('tracked workbook passes portable structure/checksum validation without a rendering runtime', () => {
  validateReviewWorkbookStructure(original, model);
  assert.deepEqual(readFileSync(original), bytes, 'verification must be read-only');
});

test('portable workbook verification rejects missing sheets, renamed headers and missing rows', () => {
  const fixtures: Array<[string, (xml: string) => string, RegExp]> = [
    ['xl/workbook.xml', (xml) => xml.replace('name="Case_Index"', 'name="Changed"'), /sheet names\/order/],
    ['xl/worksheets/sheet1.xml', (xml) => xml.replace('>export_case_key<', '>changed_header<'), /headers mismatch/],
    ['xl/worksheets/sheet1.xml', (xml) => xml.replace(/<x:row\b[^>]*\br="2"[^>]*>[\s\S]*?<\/x:row>/, ''), /missing populated row 2/],
  ];
  for (const [entry, change, message] of fixtures) {
    assert.throws(() => validateReviewWorkbookStructure(mutated(entry, change), model), message);
  }
});

test('portable workbook verification rejects cached error cells, formulas and extra populated rows', () => {
  const fixtures: Array<[(xml: string) => string, RegExp]> = [
    [(xml) => xml.replace('t="str"><x:v>export_case_key', 't="e"><x:v>#REF!'), /spreadsheet error cell/],
    [(xml) => xml.replace('<x:v>export_case_key', '<x:f>1+1</x:f><x:v>export_case_key'), /Unexpected formula/],
    [(xml) => xml.replace('</x:sheetData>', '<x:row r="99999"><x:c r="A99999" t="str"><x:v>extra</x:v></x:c></x:row></x:sheetData>'), /unexpected populated rows/],
  ];
  for (const [change, message] of fixtures) {
    assert.throws(() => validateReviewWorkbookStructure(mutated('xl/worksheets/sheet1.xml', change), model), message);
  }
});

test('portable workbook verification checks table metadata and the saved semantic checksum', () => {
  assert.throws(() => validateReviewWorkbookStructure(original, {
    ...model, exportMetadata: { ...model.exportMetadata, semantic_checksum: 'sha256:changed' },
  }), /semantic checksum mismatch/);
  const table = Object.keys(unpacked).find((name) => name.startsWith('xl/tables/') && name.endsWith('.xml'))!;
  assert.throws(() => validateReviewWorkbookStructure(mutated(table, (xml) => xml.replace('name="export_case_key"', 'name="changed"')), model), /table headers mismatch/);
});
