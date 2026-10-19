import { afterEach, beforeEach, vi } from 'vitest';

/** Fake only the browser task scheduler for existing deterministic timer-based fixtures. */
export function useFakeMailboxTasks() {
  beforeEach(() => {
    vi.stubGlobal('MessageChannel', class {
      private tasks = new Set<ReturnType<typeof setTimeout>>();
      private close = () => { this.tasks.forEach(clearTimeout); this.tasks.clear(); };
      port1 = { onmessage: null as (() => void) | null, close: this.close };
      port2 = { close: this.close, postMessage: () => {
        const task = setTimeout(() => { this.tasks.delete(task); this.port1.onmessage?.(); }, 0);
        this.tasks.add(task);
      } };
    });
  });
  afterEach(() => vi.unstubAllGlobals());
}
