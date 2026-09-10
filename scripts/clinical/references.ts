import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLINICAL_CASES } from '../../src/clinical/cases.ts';
import { CLINICAL_REFERENCE_BY_ID } from '../../src/clinical/references.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDir = resolve(root, 'docs/generated');
mkdirSync(outputDir, { recursive: true });

const rows = [['Case ID','Case version','Specialty','Clinical topic','Reference ID','Organization','Title','Year','Recommendation or section','URL','Access date','Verification status','Review status']];
for (const c of CLINICAL_CASES) for (const id of c.references) {
  const r = CLINICAL_REFERENCE_BY_ID.get(id);
  if (!r) continue;
  rows.push([c.caseId,c.caseVersion,c.specialtyId,c.title,id,r.organization,r.title,String(r.publicationYear),r.recommendationId ?? r.section ?? '',r.url,r.accessedAt,r.verificationStatus,c.reviewStatus]);
}
const csv = rows.map((row) => row.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
writeFileSync(resolve(outputDir, 'case-reference-matrix.csv'), csv, 'utf8');

const md = ['# Clinical references', '', '> Generated metadata export. Source verification does not constitute clinical approval of a case.', ''];
let n = 1;
for (const r of CLINICAL_REFERENCE_BY_ID.values()) {
  const used = CLINICAL_CASES.filter((c) => c.references.includes(r.referenceId));
  if (used.length === 0) continue;
  md.push(`${n}. ${r.organization}. ${r.title}. ${r.version ?? r.publicationYear}. ${r.url} (accessed ${r.accessedAt}).`);
  md.push(`   - Reference ID: \`${r.referenceId}\`; status: \`${r.verificationStatus}\`; region: ${r.region}; section: ${r.recommendationId ?? r.section ?? 'unavailable'}.`);
  md.push(`   - Cases: ${used.map((c) => `\`${c.caseId}@${c.caseVersion}\` (${c.reviewStatus})`).join(', ')}.`);
  md.push(''); n += 1;
}
writeFileSync(resolve(outputDir, 'clinical-references.md'), md.join('\n'), 'utf8');
console.log(`Wrote ${rows.length - 1} case-reference rows and ${n - 1} references.`);
