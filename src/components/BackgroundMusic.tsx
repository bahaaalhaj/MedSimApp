import { useEffect, useState } from 'react';
import { useScreen } from '../game/store';

const MUTED_KEY = 'medsim:music-muted';
const VOLUME = 0.18;
const DUCKED_VOLUME = 0.055;
function readMuted(): boolean { try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; } }
function writeMuted(value: boolean) { try { localStorage.setItem(MUTED_KEY, value ? '1' : '0'); } catch { /* non-fatal */ } }

class MusicController {
  private audio: HTMLAudioElement | null = null;
  private muted = readMuted();
  private speaking = false;
  private initialized = false;
  private ensure() {
    if (this.audio) return this.audio;
    const audio = new Audio('/medsim.mp3');
    audio.loop = true; audio.preload = 'auto'; audio.volume = 0;
    if (import.meta.env.DEV) ['play', 'pause', 'ended', 'stalled', 'error'].forEach((event) => audio.addEventListener(event, () => console.debug('[MedSim music]', { event, time: audio.currentTime })));
    this.audio = audio;
    return audio;
  }
  init() {
    if (this.initialized) return;
    this.initialized = true;
    const start = () => { void this.play(); };
    window.addEventListener('pointerdown', start, { passive: true });
    window.addEventListener('keydown', start);
    this.ensure();
  }
  async play() {
    const audio = this.ensure();
    if (this.muted) return;
    this.ramp(this.speaking ? DUCKED_VOLUME : VOLUME);
    try { await audio.play(); } catch { /* retry on a later user gesture */ }
  }
  setMuted(value: boolean) { this.muted = value; writeMuted(value); if (value) this.ramp(0); else void this.play(); }
  setSpeaking(value: boolean) { this.speaking = value; if (!this.muted) this.ramp(value ? DUCKED_VOLUME : VOLUME); }
  private ramp(target: number) {
    const audio = this.ensure(); const start = audio.volume; const started = performance.now();
    const tick = () => { const ratio = Math.min(1, (performance.now() - started) / 180); audio.volume = start + (target - start) * ratio; if (ratio < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}
const music = new MusicController();

export function BackgroundMusic() {
  const screen = useScreen();
  const [userMuted, setUserMuted] = useState(readMuted);
  useEffect(() => {
    music.init(); void music.play();
    const onPatientAudio = (event: Event) => music.setSpeaking(Boolean((event as CustomEvent<{ speaking?: boolean }>).detail?.speaking));
    window.addEventListener('medsim:patient-audio', onPatientAudio);
    return () => window.removeEventListener('medsim:patient-audio', onPatientAudio);
  }, []);
  if (screen === 'splash') return null;
  return <button type="button" onClick={() => { const next = !userMuted; setUserMuted(next); music.setMuted(next); }} title={userMuted ? 'Music muted — click to unmute' : 'Music on — click to mute'} aria-label={userMuted ? 'Unmute music' : 'Mute music'} style={{ position: 'fixed', top: 18, right: 156, zIndex: 1000, width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--line)', background: userMuted ? 'var(--cream)' : 'var(--butter)', boxShadow: '0 2px 0 var(--line)', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><span aria-hidden style={{ lineHeight: 1 }}>{userMuted ? '🔇' : '🎵'}</span></button>;
}
