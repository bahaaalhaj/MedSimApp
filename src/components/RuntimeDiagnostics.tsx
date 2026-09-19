import { useEffect, useState } from 'react';
import { runtimeDiagnostics } from '../runtimeDiagnostics.ts';
export function RuntimeDiagnostics() {
  const [, refresh] = useState(0);
  useEffect(() => { const listener = () => refresh((value) => value + 1); window.addEventListener('medsim:runtime-diagnostic', listener); return () => window.removeEventListener('medsim:runtime-diagnostic', listener); }, []);
  if (!import.meta.env?.DEV) return null;
  const rows = runtimeDiagnostics().slice(-12).reverse();
  return <details style={{ position: 'fixed', zIndex: 2000, bottom: 8, right: 8, maxWidth: 540, background: 'white', border: '2px solid #333', padding: 6, fontSize: 10 }}><summary>Runtime diagnostics ({rows.length})</summary><pre style={{ maxHeight: 180, overflow: 'auto', margin: 4, whiteSpace: 'pre-wrap' }}>{rows.map((row) => JSON.stringify(row)).join('\n')}</pre></details>;
}
