import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const forbiddenArtifact = /\.(?:gguf|safetensors|pt|pth|onnx|zip|exe|dll|db|sqlite|sqlite3|wal|shm|pyc|pyo|tsbuildinfo|log)$|\.(?:db|sqlite3?)-(?:wal|shm|journal)$/i;
const forbiddenPath = /(?:^|\/)(?:\.local-quarantine|\.venv(?:-voice)?|node_modules|dist|\.ruff_cache|\.pytest_cache|local-ai-logs|generated-audio|__pycache__)(?:\/|$)|^backend\/(?:data|backend\/data|tools)\//i;
const artifactPaths = tracked.filter((path) => forbiddenArtifact.test(path) || forbiddenPath.test(path));
artifactPaths.push(...tracked.filter((path) => /(?:^|\/)\.env(?:\.[^/]+)?$/.test(path) && !/\.example$/.test(path)));
if (artifactPaths.length) {
  throw new Error(`Tracked runtime/model artifacts detected:\n${artifactPaths.join('\n')}`);
}

const secretPatterns = [
  /sk-or-v1-[a-z0-9]{20,}/i,
  /(?:OPENROUTER_API_KEY|ANTHROPIC_API_KEY|BACKEND_SHARED_SECRET)[ \t]*[:=][ \t]*['"]?[A-Za-z0-9_-]{20,}/i,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /(?:ghp|github_pat|xox[baprs])-[a-z0-9-]{20,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
];
const textExtensions = /\.(?:cjs|css|env|html|ini|js|json|md|py|ps1|sh|sql|ts|tsx|txt|yaml|yml)$/i;
const secretHits: string[] = [];
for (const path of tracked) {
  if (!textExtensions.test(path)) continue;
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) continue;
  const text = readFileSync(absolutePath, 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(text))) secretHits.push(path);
}
if (secretHits.length) {
  throw new Error(`Secret-shaped values detected in tracked files:\n${secretHits.join('\n')}`);
}

const probes = [
  'backend/data/llm-models/probe.gguf', 'backend/tools/probe.exe',
  '.env.production', 'backend/.env.production', '.local-quarantine/probe.json',
  'probe.sqlite3-wal', 'probe.db-journal', 'scripts/__pycache__/probe.pyc',
  '.ruff_cache/probe',
];
const ignored = execFileSync(
  'git',
  ['check-ignore', ...probes],
  { cwd: root, encoding: 'utf8' },
);
const ignoredPaths = new Set(ignored.replaceAll('\\', '/').trim().split(/\r?\n/));
if (probes.some((path) => !ignoredPaths.has(path))) {
  throw new Error('Expected private runtime, database, model and cache probe paths to remain ignored.');
}

console.log(`CI safety scan passed: ${tracked.length} tracked paths, no secret-shaped values or runtime artifacts.`);
