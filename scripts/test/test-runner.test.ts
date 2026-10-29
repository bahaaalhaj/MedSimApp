import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

function fixture(fail: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'medsim-runner-ci-'));
  try {
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, 'run-all.ts'), readFileSync(new URL('./run-all.ts', import.meta.url)));
    writeFileSync(join(directory, 'fixture.test.ts'), `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      for (let index = 0; index < 128; index++) {
        test('fixture-' + index + '-' + 'x'.repeat(1000), () => {
          if (${fail} && index === 127) assert.fail('intentional fixture failure');
        });
      }
    `);
    const env = { ...process.env };
    // This subprocess is a new test coordinator, not a child of this worker.
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [join(directory, 'run-all.ts')], {
      cwd: directory, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    });
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('test runner drains the full reporter output and summary before a successful exit', () => {
  const result = fixture(false);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture-127-/);
  assert.match(result.stdout, /tests 128/);
  assert.match(result.stdout, /pass 128/);
  assert.match(result.stdout, /fail 0/);
});

test('test runner still returns failure and prints the terminal failure summary', () => {
  const result = fixture(true);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /intentional fixture failure/);
  assert.match(result.stdout, /tests 128/);
  assert.match(result.stdout, /fail 1/);
});
