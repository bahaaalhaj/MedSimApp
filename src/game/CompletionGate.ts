/** Guards the synchronous finish transition while allowing a failed attempt to be retried. */
export class CompletionGate {
  private started = false;

  tryStart(): boolean {
    if (this.started) return false;
    this.started = true;
    return true;
  }

  reset() { this.started = false; }
}
