/** Polymarket HTTP 出海方式：业务层只调 transport / pmClientApi，由 mode 决定实际路径 */

export type PmHttpMode = "direct" | "vps" | "extension";

const LS_KEY = "PM_HTTP_MODE";

let testOverride: PmHttpMode | null = null;

function normalizeMode(raw: string | undefined | null): PmHttpMode | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "direct" || v === "official")
    return "direct";
  if (v === "vps" || v === "server")
    return "vps";
  if (v === "extension" || v === "plugin")
    return "extension";
  return null;
}

/** 当前 PM HTTP 模式；默认 vps */
export function resolvePmHttpMode(): PmHttpMode {
  if (testOverride)
    return testOverride;
  if (typeof globalThis.localStorage !== "undefined") {
    const fromLs = normalizeMode(globalThis.localStorage.getItem(LS_KEY));
    if (fromLs)
      return fromLs;
  }
  const env = typeof import.meta !== "undefined"
    ? normalizeMode((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PM_HTTP_MODE)
    : null;
  if (env)
    return env;
  return "vps";
}

/** HTTP 是否经 changmen VPS（余额已固定走 Pm_RefreshBalance，不依赖此开关） */
export function isPmVpsHttpMode(): boolean {
  return resolvePmHttpMode() === "vps";
}

/**
 * 本机 REST（extension/direct）Network Error：整条 HTTP 降回 VPS。
 * 登录自动路径本就钉 VPS；此函数给角标手动升插件后的纠偏。
 */
export function demotePmHttpToVpsFromLocalNetworkError(): boolean {
  const mode = resolvePmHttpMode();
  if (mode === "vps")
    return false;
  if (testOverride && testOverride !== "vps")
    testOverride = "vps";
  setPmHttpMode("vps");
  return true;
}

/** 测试 / 调试注入 */
export function setPmHttpModeForTests(mode: PmHttpMode | null): void {
  testOverride = mode;
}

export function setPmHttpMode(mode: PmHttpMode): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, mode);
  }
  catch {
    /* ignore */
  }
}
