const VOLUME_KEY = 'medsim:patient-volume';
const MUTED_KEY = 'medsim:patient-muted';

function readNumber(key: string, fallback: number): number {
  try { const parsed = Number(localStorage.getItem(key)); return Number.isFinite(parsed) ? parsed : fallback; }
  catch { return fallback; }
}

/** Owns persisted patient-audio volume and mute preferences. */
export class PatientAudioPreferences {
  private volume = Math.max(0, Math.min(1, readNumber(VOLUME_KEY, 0.85)));
  private muted = (() => { try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; } })();

  getVolume() { return this.volume; }
  isMuted() { return this.muted; }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    try { localStorage.setItem(VOLUME_KEY, String(this.volume)); } catch { /* non-fatal */ }
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0'); } catch { /* non-fatal */ }
  }
}
