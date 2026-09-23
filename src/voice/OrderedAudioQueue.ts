export type PatientAudioState = 'queued' | 'preparing' | 'playing' | 'played' | 'skipped' | 'error';

export interface AudioJob {
  turnId: string;
  text: string;
  isOpeningGreeting: boolean;
  cacheable: boolean;
}

interface OrderedAudioQueueOptions<TAudio> {
  synthesize: (job: AudioJob, signal: AbortSignal) => Promise<TAudio>;
  play: (audio: TAudio, job: AudioJob, onStarted: () => void) => Promise<void>;
  stop: () => void;
  onState?: (turnId: string, state: PatientAudioState) => void;
  onPreparing?: (job: AudioJob) => void;
  onPlaying?: (job: AudioJob, audio: TAudio) => void;
  onPlayed?: (job: AudioJob) => void;
  onError?: (job: AudioJob, error: unknown) => void;
  onSkipped?: (job: AudioJob) => void;
}

/** Owns FIFO synthesis/playback ordering and the active synthesis abort signal. */
export class OrderedAudioQueue<TAudio = unknown> {
  private readonly options: OrderedAudioQueueOptions<TAudio>;
  private readonly queue: AudioJob[] = [];
  private readonly states = new Map<string, PatientAudioState>();
  private readonly subscribers = new Set<() => void>();
  private readonly idleWaiters = new Set<() => void>();
  private controller: AbortController | null = null;
  private activeJob: AudioJob | null = null;
  private workerRunning = false;
  private disposed = false;

  constructor(options: OrderedAudioQueueOptions<TAudio>) { this.options = options; }

  isBusy(): boolean { return this.workerRunning || this.controller !== null || this.activeJob !== null || this.queue.length > 0; }
  getState(turnId: string): PatientAudioState | undefined { return this.states.get(turnId); }
  getQueuePosition(turnId: string): number | null {
    const index = this.queue.findIndex((item) => item.turnId === turnId);
    return index < 0 ? null : index + 1;
  }
  subscribe(fn: () => void) { this.subscribers.add(fn); return () => { this.subscribers.delete(fn); }; }

  enqueue(job: AudioJob): boolean {
    if (this.disposed) return false;
    if (this.queue.length >= 6) {
      this.setState(job.turnId, 'error');
      this.options.onError?.(job, new Error('Speech queue is full. Use Replay on this response when ready.'));
      return false;
    }
    this.queue.push(job);
    this.setState(job.turnId, 'queued');
    void this.run();
    return true;
  }

  skipCurrent() {
    if (!this.activeJob) return;
    const job = this.activeJob;
    this.controller?.abort();
    this.options.stop();
    this.setState(job.turnId, 'skipped');
    this.options.onSkipped?.(job);
  }

  cancelAll() {
    this.controller?.abort();
    this.controller = null;
    if (this.activeJob) {
      const job = this.activeJob;
      this.options.stop();
      this.setState(job.turnId, 'skipped');
      this.options.onSkipped?.(job);
    }
    for (const pending of this.queue.splice(0)) this.setState(pending.turnId, 'error');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    this.subscribers.clear();
    this.resolveIdleIfNeeded();
  }

  waitForIdle(): Promise<void> {
    if (!this.isBusy()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private async run() {
    if (this.workerRunning || this.disposed) return;
    this.workerRunning = true;
    try {
      while (!this.disposed && this.queue.length) {
        const job = this.queue.shift()!;
        await this.process(job);
      }
    } finally {
      this.workerRunning = false;
      this.resolveIdleIfNeeded();
    }
  }

  private async process(job: AudioJob) {
    const controller = new AbortController();
    this.controller = controller;
    this.activeJob = job;
    this.setState(job.turnId, 'preparing');
    this.options.onPreparing?.(job);
    try {
      const audio = await this.options.synthesize(job, controller.signal);
      if (this.disposed || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await this.options.play(audio, job, () => {
        this.setState(job.turnId, 'playing');
        this.options.onPlaying?.(job, audio);
      });
      if (this.disposed || controller.signal.aborted) {
        this.setState(job.turnId, 'skipped');
        this.options.onSkipped?.(job);
      } else {
        this.setState(job.turnId, 'played');
        this.options.onPlayed?.(job);
      }
    } catch (error: unknown) {
      if (this.disposed || controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        this.setState(job.turnId, 'skipped');
        this.options.onSkipped?.(job);
      } else {
        this.setState(job.turnId, 'error');
        this.options.onError?.(job, error);
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      if (this.activeJob === job) this.activeJob = null;
    }
  }

  private setState(turnId: string, state: PatientAudioState) {
    this.states.set(turnId, state);
    this.options.onState?.(turnId, state);
    this.subscribers.forEach((fn) => fn());
  }

  private resolveIdleIfNeeded() {
    if (this.workerRunning || this.controller || this.activeJob || this.queue.length) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
