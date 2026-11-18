import { spawnSync } from 'node:child_process';

// Isolated output and process environment; never write the Windows pilot dist
// or any local provider/audio configuration.
for (const args of [
  ['scripts/verify/vercel-configuration.mjs'],
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-demo', '--emptyOutDir'],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, VITE_MEDSIM_DEPLOYMENT_MODE: 'vercel-guest-demo' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
