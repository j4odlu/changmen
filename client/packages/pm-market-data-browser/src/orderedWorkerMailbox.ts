/** [changmen 扩展] Generic bounded FIFO. No book/preflight/transport knowledge or network ownership. */
export const MAILBOX_LIMITS = Object.freeze({ batches: 8, entries: 2048, chars: 2_000_000,
  batchEntries: 64, batchChars: 256_000, ageMs: 1_000 });
export class OrderedWorkerMailbox<T> {
  private queue: Array<{ value: T; chars: number; at: number }> = [];
  private inflight = new Map<number, { entries: number; chars: number; at: number; sentAt: number }>();
  private chars = 0;
  private entries = 0;
  private serial = 0;
  private wake?: MessageChannel;
  private scheduled = false;
  private stopped = false;
  private sent = 0;
  private highEntries = 0;
  private highChars = 0;
  private maxQueueMs = 0;
  private maxAckMs = 0;
  private failureEvidence?: { reason: string; queuedEntries: number; pendingBatches: number; oldestQueuedMs: number; oldestInflightMs: number; oldestAckMs: number };
  constructor(private post: (id: number, values: T[]) => void, private fail: (reason: string) => void,
    private now = () => performance.now()) {}
  enqueue(value: T, chars: number): boolean {
    if (this.stopped) return false;
    if (!Number.isSafeInteger(chars) || chars < 0 || this.entries >= MAILBOX_LIMITS.entries || this.chars + chars > MAILBOX_LIMITS.chars) {
      this.reject('stream_overflow'); return false;
    }
    this.queue.push({ value, chars, at: this.now() }); this.chars += chars; this.entries++;
    this.highEntries = Math.max(this.highEntries, this.entries); this.highChars = Math.max(this.highChars, this.chars);
    this.arm(); return true;
  }
  private arm(): void {
    if (this.stopped || this.scheduled || !this.queue.length || this.inflight.size >= MAILBOX_LIMITS.batches) return;
    // A runnable message task, not a timer: hidden-tab timer clamping must not strand
    // an unsent tail or idle ACK credit. At most one wake is pending; no idle polling.
    try {
      if (!this.wake) {
        this.wake = new MessageChannel();
        this.wake.port1.onmessage = () => { this.scheduled = false; if (!this.stopped) this.flush(); };
      }
      this.scheduled = true; this.wake.port2.postMessage(null);
    } catch { this.reject('mailbox_wake_failed'); }
  }
  private flush(): void {
    if (!this.checkAge()) return;
    const started = this.now();
    while (!this.stopped && this.queue.length && this.inflight.size < MAILBOX_LIMITS.batches) {
      let count = 0, chars = 0;
      for (const row of this.queue) {
        if (count && (count >= MAILBOX_LIMITS.batchEntries || chars + row.chars > MAILBOX_LIMITS.batchChars)) break;
        count++; chars += row.chars;
      }
      const rows = this.queue.splice(0, count), id = ++this.serial;
      const sentAt = this.now(); this.maxQueueMs = Math.max(this.maxQueueMs, sentAt - rows[0]!.at);
      this.inflight.set(id, { entries: count, chars, at: rows[0]!.at, sentAt }); this.sent++;
      try { this.post(id, rows.map(row => row.value)); } catch { this.reject('worker_post_failed'); }
      if (this.now() - started >= 2) break; // Yield the main thread between clone bursts.
    }
    this.arm();
  }
  ack(id: number): void {
    const row = this.inflight.get(id); if (!row || this.stopped) return;
    this.maxAckMs = Math.max(this.maxAckMs, this.now() - row.sentAt);
    this.entries -= row.entries; this.chars -= row.chars; this.inflight.delete(id); this.arm();
  }
  checkAge(): boolean {
    if (this.stopped) return false;
    const oldest = Math.min(this.queue[0]?.at ?? Infinity, ...[...this.inflight.values()].map(row => row.at));
    if (this.now() - oldest > MAILBOX_LIMITS.ageMs) { this.reject('stream_ack_timeout'); return false; }
    return true;
  }
  private ages() {
    const at = this.now(), rows = [...this.inflight.values()];
    const age = (first: number) => Number.isFinite(first) ? Math.max(0, at - first) : 0;
    return { oldestQueuedMs: age(this.queue[0]?.at ?? Infinity),
      oldestInflightMs: age(Math.min(...rows.map(row => row.at))), oldestAckMs: age(Math.min(...rows.map(row => row.sentAt))) };
  }
  private reject(reason: string): void {
    this.failureEvidence = { reason, queuedEntries: this.queue.length, pendingBatches: this.inflight.size, ...this.ages() };
    this.stop(); this.fail(reason);
  }
  report() { return { pendingBatches: this.inflight.size, queuedEntries: this.queue.length, pendingEntries: this.entries,
    pendingChars: this.chars, batchesSent: this.sent, highEntries: this.highEntries, highChars: this.highChars,
    scheduler: 'message-task', maxQueueMs: this.maxQueueMs, maxAckMs: this.maxAckMs, ...this.ages(), failureEvidence: this.failureEvidence }; }
  stop(): void {
    this.stopped = true; this.scheduled = false;
    if (this.wake) { this.wake.port1.onmessage = null; this.wake.port1.close(); this.wake.port2.close(); this.wake = undefined; }
    this.queue = []; this.inflight.clear(); this.entries = 0; this.chars = 0;
  }
}
