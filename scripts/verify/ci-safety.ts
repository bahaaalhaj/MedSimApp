import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const forbiddenArtifact = /\.(?:gguf|safetensors|pt|pth|onnx|zip|exe|dll|db|sqlite|sqlite3|wal|shm)$/i;
const forbiddenPath = /(?:^|\/)(?:\.env\.local|local-ai-logs|generated-audio|__pycache__)(?:\/|$)/i;
const artifactPaths = tracked.filter((path) => forbiddenArtifact.test(path) || forbiddenPath.test(path));
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
  const text = readFileSync(resolve(root, path), 'utf8');
  if (secretPatterns.some((pattern) => pattern.test(text))) secretHits.push(path);
}
if (secretHits.length) {
  throw new Error(`Secret-shaped values detected in tracked files:\n${secretHits.join('\n')}`);
}

const ignored = execFileSync(
  'git',
  ['check-ignore', 'backend/data/llm-models/probe.gguf', 'backend/tools/probe.exe'],
  { cwd: root, encoding: 'utf8' },
);
if (!/backend[\\/]data[\\/]llm-models[\\/]probe\.gguf/.test(ignored) || !/backend[\\/]tools[\\/]probe\.exe/.test(ignored)) {
  throw new Error('Expected model and executable probe paths to remain ignored.');
}

console.log(`CI safety scan passed: ${tracked.length} tracked paths, no secret-shaped values or runtime artifacts.`);
