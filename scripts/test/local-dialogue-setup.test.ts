import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('local presentation artifacts are revision-pinned, hashed, and separate from legacy weights', () => {
  const manifest = JSON.parse(read('scripts/local-dialogue-artifacts.json'));
  assert.equal(manifest.models['4b'].original, 'Qwen/Qwen3-4B-Instruct-2507');
  assert.equal(manifest.models['4b'].quantization, 'Q4_K_M');
  assert.equal(manifest.models['4b'].license, 'Apache-2.0');
  for (const artifact of [...manifest.runtime.archives, ...Object.values(manifest.models)] as { sha256: string; url: string; bytes: number }[]) {
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.match(artifact.url, /^https:\/\/(?:github\.com|huggingface\.co)\//);
    assert.ok(artifact.bytes > 1_000_000);
  }
  assert.match(manifest.models['4b'].url, new RegExp(`/resolve/${manifest.models['4b'].revision}/`));
});

test('presentation launcher retains memory floor, loopback, one slot and positive CUDA evidence', () => {
  const script = read('scripts/local-dialogue.ps1');
  assert.match(script, /2500000000/);
  assert.match(script, /3200000000/);
  assert.match(script, /LOCALAPPDATA/);
  assert.match(script, /'--ctx-size',"\$ContextSize",'--parallel','1'/);
  assert.match(script, /'--host','127\.0\.0\.1'/);
  assert.match(script, /offloaded \[1-9\]/);
  assert.doesNotMatch(script, /taskkill|Stop-Process\s+-Name|PATIENT_TTS_PROVIDER\s*=\s*['"]disabled/i);
});

test('presentation stop validates creation time and launch identity; secrets are not rewritten', () => {
  const script = read('scripts/local-dialogue.ps1');
  assert.match(script, /CreationDate\.ToUniversalTime\(\)\.ToString\('o'\) -ne \$record\.created/);
  assert.match(script, /ExecutablePath -ne \$record\.executable/);
  assert.match(script, /CommandLine\.Contains\(\$record\.marker\)/);
  assert.match(script, /finally \{ foreach \(\$key in \$saved\.Keys\)/);
  assert.doesNotMatch(script, /OPENROUTER_API_KEY|Set-Content[^\n]*\.env/);
  const entry = read('backend/local_dialogue_entry.py');
  assert.ok(entry.indexOf('    load_env_local()') < entry.indexOf('    from local_llm import settings'));
});
