export type PfWsSourceMode = "changmen" | "official";

const SOURCE_MODE_ORDER: PfWsSourceMode[] = ["changmen", "official"];

export function pfWsSourceModeLabel(mode: PfWsSourceMode): string {
  return mode === "changmen" ? "CHANGMEN 转发" : "官方源";
}

export interface PfWsSourceModeStore {
  get: () => PfWsSourceMode;
  set: (mode: PfWsSourceMode) => PfWsSourceMode;
  cycle: () => PfWsSourceMode;
  resetForTests: (mode?: PfWsSourceMode) => void;
}

export function createPfWsSourceModeStore(storageKey: string): PfWsSourceModeStore {
  function readStoredSourceMode(): PfWsSourceMode {
    try {
      const value = globalThis.localStorage?.getItem(storageKey);
      if (value === "official")
        return "official";
      return "changmen";
    }
    catch {
      return "changmen";
    }
  }

  let mode: PfWsSourceMode = readStoredSourceMode();

  return {
    get() {
      return mode;
    },
    set(next) {
      mode = next;
      try {
        globalThis.localStorage?.setItem(storageKey, next);
      }
      catch {
        /* ignore */
      }
      return mode;
    },
    cycle() {
      const idx = SOURCE_MODE_ORDER.indexOf(mode);
      const next = SOURCE_MODE_ORDER[(idx + 1) % SOURCE_MODE_ORDER.length]!;
      mode = next;
      try {
        globalThis.localStorage?.setItem(storageKey, next);
      }
      catch {
        /* ignore */
      }
      return mode;
    },
    resetForTests(next = "changmen") {
      mode = next;
      try {
        globalThis.localStorage?.removeItem(storageKey);
      }
      catch {
        /* ignore */
      }
    },
  };
}
