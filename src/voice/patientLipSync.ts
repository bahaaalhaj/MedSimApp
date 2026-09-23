export function emitPatientSpeaking(speaking: boolean, turnId?: string) {
  window.dispatchEvent(new CustomEvent('medsim:patient-audio', { detail: { speaking, ...(turnId ? { turnId } : {}) } }));
}
