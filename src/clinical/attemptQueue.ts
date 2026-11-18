/** Browser-local ordering only. Redis remains the cross-instance authority.
 * Hold the slot through response-body consumption, not just response headers.
 * A failed operation rejects its caller; it does not poison a manual retry.
 */
export function attemptQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(attemptId: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = tails.get(attemptId) ?? Promise.resolve();
    const run = () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return operation();
    };
    const task = previous.then(run, run);
    tails.set(attemptId, task);
    const clean = () => { if (tails.get(attemptId) === task) tails.delete(attemptId); };
    void task.then(clean, clean);
    return task;
  };
}

const enqueue = attemptQueue();
const pending = new Map<string, Set<Promise<unknown>>>();

/** Includes multi-step order/result work, whose continuation may not be queued yet. */
export function trackAttemptWork<T>(attemptId: string, operation: () => Promise<T>): Promise<T> {
  const tasks = pending.get(attemptId) ?? new Set<Promise<unknown>>();
  pending.set(attemptId, tasks);
  const task = operation();
  tasks.add(task);
  const clean = () => {
    tasks.delete(task);
    if (!tasks.size && pending.get(attemptId) === tasks) pending.delete(attemptId);
  };
  void task.then(clean, clean);
  return task;
}

export function runAttemptOperation<T>(attemptId: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return trackAttemptWork(attemptId, () => enqueue(attemptId, operation, signal));
}

/** Drain work already issued by the encounter before recovery/preparation.
 * allSettled waits for every operation even when one fails; no write is retried.
 */
export async function waitForAttemptWork(attemptId: string): Promise<void> {
  const outcomes = await Promise.allSettled([...(pending.get(attemptId) ?? [])]);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
