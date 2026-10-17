import { OrderedWorkerMailbox, MAILBOX_LIMITS } from '../../packages/venue-adapter/polymarket/realtime/orderedWorkerMailbox';

// [changmen 扩展] Frozen pre-repair algorithm for local comparison only; never imported by production.
class TimerMailbox {
  private queue: Array<{ value: number; chars: number; at: number }> = [];
  private inflight = new Map<number, { entries: number; chars: number; at: number }>();
  private chars = 0; private entries = 0; private serial = 0; private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  failure?: unknown; sent = 0;
  constructor(private post: (id: number, rows: number[]) => void) {}
  enqueue(value: number, chars: number) {
    if (this.stopped) return;
    if (this.entries >= MAILBOX_LIMITS.entries || this.chars + chars > MAILBOX_LIMITS.chars) { this.reject('stream_overflow'); return; }
    this.queue.push({ value, chars, at: performance.now() }); this.entries++; this.chars += chars; this.arm();
  }
  private arm() {
    if (!this.stopped && !this.timer && this.queue.length && this.inflight.size < MAILBOX_LIMITS.batches)
      this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 16);
  }
  private flush() {
    if (!this.checkAge()) return;
    const started = performance.now();
    while (!this.stopped && this.queue.length && this.inflight.size < MAILBOX_LIMITS.batches) {
      let count = 0, chars = 0;
      for (const row of this.queue) { if (count && (count >= MAILBOX_LIMITS.batchEntries || chars + row.chars > MAILBOX_LIMITS.batchChars)) break; count++; chars += row.chars; }
      const rows = this.queue.splice(0, count), id = ++this.serial;
      this.inflight.set(id, { entries: count, chars, at: rows[0]!.at }); this.sent++;
      this.post(id, rows.map(row => row.value));
      if (performance.now() - started >= 2) break;
    }
    this.arm();
  }
  ack(id: number) { const row = this.inflight.get(id); if (!row || this.stopped) return; this.entries -= row.entries; this.chars -= row.chars; this.inflight.delete(id); this.arm(); }
  checkAge() {
    if (this.stopped) return false;
    const oldest = Math.min(this.queue[0]?.at ?? Infinity, ...[...this.inflight.values()].map(row => row.at));
    if (performance.now() - oldest > MAILBOX_LIMITS.ageMs) { this.reject('stream_ack_timeout'); return false; } return true;
  }
  private reject(reason: string) { this.failure = { reason, at: performance.now(), queued: this.queue.length, inflight: this.inflight.size, oldestQueuedMs: this.queue.length ? performance.now() - this.queue[0]!.at : 0 }; this.stop(); }
  report() { return { failure: this.failure, sent: this.sent, queued: this.queue.length, inflight: this.inflight.size,
    oldestQueuedMs: this.queue.length ? performance.now() - this.queue[0]!.at : 0 }; }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.queue = []; this.inflight.clear(); }
}
const button = document.querySelector<HTMLButtonElement>('#start')!, status = document.querySelector('#status')!;
if (new URLSearchParams(location.search).has('stall')) button.textContent = '开始 2 分钟对照（注入一次 250ms 测试长任务）';
button.onclick = () => {
  button.disabled = true;
  const started = performance.now(), timeline: unknown[] = [], visibilityEvents: unknown[] = [], stalls: unknown[] = [];
  const stress = new URLSearchParams(location.search).has('stall');
  const counts = { old: 0, current: 0 }, orderErrors = { old: 0, current: 0 };
  let currentFailure: unknown, produced = 0, finished = false;
  const workerUrl = URL.createObjectURL(new Blob([`let serial=0; const tick=setInterval(()=>postMessage({tick:++serial}),20); onmessage=({data})=>postMessage(data);`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl); URL.revokeObjectURL(workerUrl);
  const old = new TimerMailbox((id, rows) => worker.postMessage({ side: 'old', id, rows }));
  const current = new OrderedWorkerMailbox<number>((id, rows) => worker.postMessage({ side: 'current', id, rows }), reason => { currentFailure = { reason, at: performance.now() - started }; });
  worker.onmessage = ({ data }) => {
    if (data.tick) {
      produced = data.tick; old.enqueue(data.tick, 100); current.enqueue(data.tick, 100);
      // Explicit fault injection into this fixture's renderer only, not PM-M or either scheduler.
      // A 250ms long task is below the unchanged 1000ms guard; old timer dwell consumes the rest.
      if (stress && !stalls.length && document.hidden && performance.now() - started > 15000 && old.report().oldestQueuedMs > 800) {
        const before = { at: performance.now() - started, old: old.report(), current: current.report() };
        const until = performance.now() + 250; while (performance.now() < until) { /* controlled long task */ }
        stalls.push({ ...before, durationMs: performance.now() - started - before.at });
      }
    }
    else {
      const side = data.side as 'old' | 'current';
      for (const value of data.rows) { if (value !== counts[side] + 1) orderErrors[side]++; counts[side]++; }
      (side === 'old' ? old : current).ack(data.id);
    }
  };
  const visibility = (event: Event) => visibilityEvents.push({ at: performance.now() - started, state: document.visibilityState, trusted: event.isTrusted });
  document.addEventListener('visibilitychange', visibility);
  const timer = setInterval(async () => {
    old.checkAge(); current.checkAge();
    const row = { at: performance.now() - started, state: document.visibilityState, produced, counts: { ...counts }, orderErrors: { ...orderErrors }, old: old.report(), current: current.report(), currentFailure };
    timeline.push(row); status.textContent = JSON.stringify(row, null, 2);
    if (row.at >= (stress ? 120_000 : 360_000) && !finished) {
      finished = true; clearInterval(timer); old.stop(); current.stop(); worker.terminate(); document.removeEventListener('visibilitychange', visibility);
      await fetch('/verification-evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: stress ? 'scheduler-control-stall' : 'scheduler-control', value: { at: new Date().toISOString(), browser: navigator.userAgent, durationMs: row.at, counts, orderErrors, oldFailure: old.failure, currentFailure, timeline, visibilityEvents, stalls, scope: 'Synthetic echo Worker, frozen pre-repair timer algorithm versus production mailbox; no PM-M or HTTP; optional explicitly recorded 250ms renderer stall' } }) });
      status.textContent = '调度对照完成';
    }
  }, 1000);
  window.addEventListener('beforeunload', () => { clearInterval(timer); old.stop(); current.stop(); worker.terminate(); }, { once: true });
};
