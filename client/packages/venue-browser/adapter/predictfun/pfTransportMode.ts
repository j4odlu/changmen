/** Predict.fun HTTP 出海：direct（浏览器直连官方）| vps（changmen http-relay） */

export type PfHttpMode = "direct" | "vps";

const LS_KEY = "PF_HTTP_MODE";

let testOverride: PfHttpMode | null = null;

function normalizeMode(raw: string | undefined | null): PfHttpMode | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "direct" || v === "official")
    return "direct";
  if (v === "vps" || v === "server" || v === "relay")
    return "vps";
  return null;
}

/** 当前 PF HTTP 模式；默认 vps */
export function resolvePfHttpMode(): PfHttpMode {
  if (testOverride)
    return testOverride;
  if (typeof globalThis.localStorage !== "undefined") {
    const fromLs = normalizeMode(globalThis.localStorage.getItem(LS_KEY));
    if (fromLs)
      return fromLs;
  }
  const env = typeof import.meta !== "undefined"
    ? normalizeMode((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PF_HTTP_MODE)
    : null;
  if (env)
    return env;
  return "vps";
}

export function isPfVpsHttpMode(): boolean {
  return resolvePfHttpMode() === "vps";
}

/** @internal vitest */
export function setPfHttpModeForTests(mode: PfHttpMode | null): void {
  testOverride = mode;
}

export function setPfHttpMode(mode: PfHttpMode): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, mode);
  }
  catch {
    /* ignore */
  }
}
