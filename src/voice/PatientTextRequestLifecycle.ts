export type PatientTextRequest = {
  text: string;
  source: 'typed' | 'predefined';
  questionId?: string;
};

export type PatientTextRequestResult<T> =
  | { kind: 'completed'; response: T }
  | { kind: 'busy' }
  | { kind: 'cancelled' };

type ExecutePatientTextRequest<T> = (
  request: PatientTextRequest,
  signal: AbortSignal,
) => Promise<{ kind: 'completed'; response: T } | { kind: 'cancelled' }>;

/** Owns the single in-flight patient-text request and its abort lifecycle. */
export class PatientTextRequestLifecycle<T = string> {
  private readonly execute: ExecutePatientTextRequest<T>;
  private controller: AbortController | null = null;
  private disposed = false;
  private generation = 0;

  constructor(execute: ExecutePatientTextRequest<T>) { this.execute = execute; }

  isBusy(): boolean { return this.controller !== null; }

  async run(request: PatientTextRequest): Promise<PatientTextRequestResult<T>> {
    if (this.disposed) return { kind: 'cancelled' };
    if (this.controller) return { kind: 'busy' };
    const controller = new AbortController();
    const generation = ++this.generation;
    this.controller = controller;
    try {
      const result = await this.execute(request, controller.signal);
      if (this.disposed || controller.signal.aborted || generation !== this.generation) {
        return { kind: 'cancelled' };
      }
      return result;
    } catch (error: unknown) {
      if (this.disposed || controller.signal.aborted || generation !== this.generation) {
        return { kind: 'cancelled' };
      }
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  cancel() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }
}
