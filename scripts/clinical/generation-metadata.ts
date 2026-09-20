import { createHash } from 'node:crypto';

export const CANONICAL_CLINICAL_SOURCE = 'src/clinical/cases.ts';
export const CLINICAL_GENERATOR_COMMAND = 'npm run clinical:generate';
export const GENERATED_NOTICE = 'AUTO-GENERATED. DO NOT EDIT.';
export const REPRODUCIBLE_GENERATED_AT = '1970-01-01T00:00:00.000Z';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function semanticSha256(value: unknown): string {
  return sha256Text(stableStringify(value));
}

export function jsonSemanticSha256(value: unknown): string {
  return semanticSha256(JSON.parse(JSON.stringify(value)));
}

export interface GeneratedMetadata {
  notice: typeof GENERATED_NOTICE;
  sourceFile: typeof CANONICAL_CLINICAL_SOURCE;
  generatorCommand: typeof CLINICAL_GENERATOR_COMMAND;
  canonicalSourceChecksum: string;
  semanticChecksum: string;
}

export function generatedMetadata(canonicalSourceChecksum: string, semanticChecksum: string): GeneratedMetadata {
  return {
    notice: GENERATED_NOTICE,
    sourceFile: CANONICAL_CLINICAL_SOURCE,
    generatorCommand: CLINICAL_GENERATOR_COMMAND,
    canonicalSourceChecksum: `sha256:${canonicalSourceChecksum}`,
    semanticChecksum: `sha256:${semanticChecksum}`,
  };
}
