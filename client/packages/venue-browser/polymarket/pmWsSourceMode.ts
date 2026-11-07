export type PmWsSourceMode = "changmen" | "official";

const SOURCE_MODE_ORDER: PmWsSourceMode[] = ["changmen", "official"];

export function pmWsSourceModeLabel(mode: PmWsSourceMode): string {
  return mode === "changmen" ? "CHANGMEN 转发" : "官方源";
}

export interface PmWsSourceModeStore {
  get: () => PmWsSourceMode;
  set: (mode: PmWsSourceMode) => PmWsSourceMode;
  cycle: () => PmWsSourceMode;
  resetForTests: (mode?: PmWsSourceMode) => void;
  subscribe: (listener: (mode: PmWsSourceMode) => void) => () => void;
}

export function createPmWsSourceModeStore(storageKey: string): PmWsSourceModeStore {
  function readStoredSourceMode(): PmWsSourceMode {
    try {
      const value = globalThis.localStorage?.getItem(storageKey);
      if (value === "official") return "official";
      return "changmen";
    } catch {
      return "changmen";
    }
  }

  let mode: PmWsSourceMode = readStoredSourceMode();
  const listeners = new Set<(mode: PmWsSourceMode) => void>();
  function updateMode(next: PmWsSourceMode): void {
    if (mode === next) return;
    mode = next;
    for (const listener of listeners) {
      try { listener(mode); }
      catch (err) { console.warn("[Polymarket] source mode listener", err); }
    }
  }

  return {
    get() {
      return mode;
    },
    set(next) {
      updateMode(next);
      try {
        globalThis.localStorage?.setItem(storageKey, next);
      } catch {
        /* ignore storage errors */
      }
      return mode;
    },
    cycle() {
      const idx = SOURCE_MODE_ORDER.indexOf(mode);
      const next = SOURCE_MODE_ORDER[(idx + 1) % SOURCE_MODE_ORDER.length]!;
      updateMode(next);
      try {
        globalThis.localStorage?.setItem(storageKey, next);
      } catch {
        /* ignore storage errors */
      }
      return mode;
    },
    resetForTests(next = "changmen") {
      updateMode(next);
      try {
        globalThis.localStorage?.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
