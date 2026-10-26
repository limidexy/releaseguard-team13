export const PROVIDER_REQUEST_TIMEOUT_MS = 20000;
export const PROVIDER_START_INTERVAL_MS = 20000;
export const PROVIDER_MAX_OUTPUT_TOKENS = 1536;
export const REAL_EXECUTION_TIMEOUT_MS = 400000;
export const REAL_RUNNER_TIMEOUT_MS = 450000;

// Local start pacing, NOT a distributed quota or proof of provider Free eligibility.
// Only one pending start per execution is queued. Cancelled waiters cannot reserve
// future starts or let later callers jump over a still-live predecessor.
export class ProviderStartGate {
  private nextStart = -Infinity;
  private queue: { signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void; onAbort: () => void }[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  async wait(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.queue.length >= 10) throw new Error('Provider local start queue full');
    return new Promise<void>((resolve, reject) => {
      const item = { signal, resolve, reject, onAbort: () => {
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        signal.removeEventListener('abort', item.onAbort); reject(signal.reason);
        if (index === 0) { clearTimeout(this.timer); this.timer = undefined; this.pump(); }
      } };
      signal.addEventListener('abort', item.onAbort, { once: true }); this.queue.push(item); this.pump();
    });
  }
  private pump() {
    if (this.timer || !this.queue.length) return;
    const remaining = Math.ceil(this.nextStart - performance.now());
    if (remaining > 0) {
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, remaining); return;
    }
    const item = this.queue.shift()!; item.signal.removeEventListener('abort', item.onAbort);
    this.nextStart = performance.now() + PROVIDER_START_INTERVAL_MS; item.resolve(); this.pump();
  }
}
