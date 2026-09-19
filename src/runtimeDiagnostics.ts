export interface RuntimeDiagnostic { at: number; event: string; id?: string; detail?: Record<string, string | number | boolean | null>; }
const entries: RuntimeDiagnostic[] = [];
export function recordRuntimeDiagnostic(event: string, id?: string, detail?: RuntimeDiagnostic['detail']) {
  if (!import.meta.env?.DEV) return;
  entries.push({ at: performance.now(), event, id, detail });
  if (entries.length > 80) entries.shift();
  window.dispatchEvent(new CustomEvent('medsim:runtime-diagnostic'));
}
export function runtimeDiagnostics() { return [...entries]; }
