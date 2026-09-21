import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const assets = resolve(root, 'dist/assets');
const bundles = readdirSync(assets)
  .filter((name) => name.endsWith('.js'))
  .map((name) => resolve(assets, name));

if (bundles.length === 0) throw new Error('No production JavaScript bundle found. Run npm run build first.');

const productionJavaScript = bundles.map((path) => readFileSync(path, 'utf8')).join('\n');
const serverManifest = JSON.parse(readFileSync(resolve(root, 'docs/generated/local-ai-manifest.server.json'), 'utf8')) as {
  cases: Array<{
    patient: { history: Array<{ answer: string }> };
    evaluation: {
      rubric: Array<{ description: string; observableEvidence: string[] }>;
      medicationExpectations: Array<Record<string, unknown>>;
      criticalFailureRules: Array<{ trigger: string }>;
    };
  }>;
};

const hiddenStrings = new Set<string>();
for (const clinicalCase of serverManifest.cases) {
  for (const item of clinicalCase.patient.history) if (item.answer.length >= 20) hiddenStrings.add(item.answer);
  for (const item of clinicalCase.evaluation.rubric) {
    if (item.description.length >= 20) hiddenStrings.add(item.description);
    for (const evidence of item.observableEvidence) if (evidence.length >= 20) hiddenStrings.add(evidence);
  }
  for (const item of clinicalCase.evaluation.medicationExpectations) {
    for (const value of Object.values(item)) if (typeof value === 'string' && value.length >= 20) hiddenStrings.add(value);
  }
  for (const rule of clinicalCase.evaluation.criticalFailureRules) if (rule.trigger.length >= 20) hiddenStrings.add(rule.trigger);
}

const exposed = [...hiddenStrings].filter((value) => productionJavaScript.includes(value));
if (exposed.length > 0) {
  throw new Error(`Production frontend contains ${exposed.length} server-only clinical truth string(s).`);
}

const bytes = bundles.reduce((total, path) => total + statSync(path).size, 0);
console.log(`PASS  production frontend exposes 0 of ${hiddenStrings.size} server-only clinical truth strings (${bytes} JavaScript bytes)`);
