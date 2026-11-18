import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, jsonPointers: true });
const schema = JSON.parse(readFileSync(new URL('./schemas/vercel.schema.json', import.meta.url), 'utf8'));
// The official snapshot declares draft-04 but contains newer const/numeric
// exclusiveMinimum constraints. Correct only its dialect declaration; preserve
// every constraint and keep schema meta-validation enabled (draft-07 accepts it).
const validate = ajv.compile({ ...schema, $schema: 'http://json-schema.org/draft-07/schema#' });

/** Validate the complete config, offline, against the pinned official schema. */
export function validateVercelConfiguration(configuration) {
  if (!validate(configuration)) {
    throw new Error(`Invalid Vercel configuration: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = resolve(process.argv[2] ?? 'vercel.json');
  validateVercelConfiguration(JSON.parse(readFileSync(path, 'utf8')));
  console.log('PASS  complete Vercel configuration matches the pinned official schema');
}
