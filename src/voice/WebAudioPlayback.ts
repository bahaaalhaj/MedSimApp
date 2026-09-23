import { PatientAudioPreferences } from './PatientAudioPreferences';
import { emitPatientSpeaking } from './patientLipSync';

/** Owns Web Audio nodes and guarantees active sources are disconnected on stop/disposal. */
export class WebAudioPlayback {
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly ampBuf: Uint8Array;
  private source: AudioBufferSourceNode | null = null;
  private activeTurnId: string | null = null;
  private playbackResolve: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly audioCtx: AudioContext, private readonly preferences: PatientAudioPreferences) {
    this.gain = audioCtx.createGain();
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.55;
    this.gain.connect(this.analyser);
    this.analyser.connect(audioCtx.destination);
    this.ampBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.applyGain();
  }

  getMouthAmplitude(): number {
    if (!this.source || this.preferences.isMuted()) return 0;
    this.analyser.getByteTimeDomainData(this.ampBuf as Uint8Array<ArrayBuffer>);
    let total = 0;
    for (const sample of this.ampBuf) { const centered = (sample - 128) / 128; total += centered * centered; }
    return Math.min(1, Math.sqrt(total / this.ampBuf.length) * 3.2);
  }

  applyGain() { this.gain.gain.value = this.preferences.isMuted() ? 0 : this.preferences.getVolume(); }

  async play(buffer: AudioBuffer, turnId: string, onStarted: () => void): Promise<void> {
    if (this.disposed) return;
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    if (this.disposed) return;
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const done = new Promise<void>((resolve) => { this.playbackResolve = resolve; });
    source.onended = () => {
      if (this.source === source) {
        source.disconnect();
        this.source = null;
        this.activeTurnId = null;
        emitPatientSpeaking(false, turnId);
      }
      this.playbackResolve?.();
      this.playbackResolve = null;
    };
    this.source = source;
    this.activeTurnId = turnId;
    onStarted();
    emitPatientSpeaking(true, turnId);
    source.start();
    await done;
  }

  stop(): string | null {
    const current = this.source;
    const turnId = this.activeTurnId;
    this.source = null;
    this.activeTurnId = null;
    if (current) {
      current.onended = null;
      try { current.stop(); } catch { /* already stopped */ }
      current.disconnect();
      emitPatientSpeaking(false);
    }
    this.playbackResolve?.();
    this.playbackResolve = null;
    return turnId;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.gain.disconnect();
    this.analyser.disconnect();
  }
}
