function devBackendHttpOrigin(): string {
  const isWin = typeof navigator !== "undefined"
    ? /win/i.test(navigator.platform || navigator.userAgent)
    : typeof process !== "undefined" && process.platform === "win32";
  return `http://127.0.0.1:${isWin ? 3700 : 3456}`;
}

function devBrowserSameOrigin(): string {
  if (typeof window === "undefined")
    return "";
  return window.location.origin;
}

function hkRelayOriginFromEnv(): string {
  if (typeof import.meta === "undefined")
    return "";
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return String(env.VITE_HK_RELAY_ORIGIN || env.VITE_PM_HK_RELAY_ORIGIN || "").trim().replace(/\/+$/, "");
}

/**
 * 场馆 HK 出海 relay 根地址（https://host，无尾斜杠）：http-relay / ws-forward。
 * 生产浏览器 → window.location.origin（与 localStorage PROXY 无关；PROXY 仅给操盘账号 proxyId）。
 * 本地 dev → window.location.origin（Vite 代理到 VITE_HK_RELAY_ORIGIN）。
 */
export function resolveHkRelayHttpOrigin(): string {
  if (typeof window !== "undefined" && typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    const same = devBrowserSameOrigin();
    if (same)
      return same;
  }

  if (typeof window !== "undefined")
    return window.location.origin;

  const fromEnv = hkRelayOriginFromEnv();
  if (fromEnv)
    return fromEnv;

  return devBackendHttpOrigin();
}

/** 生产主站打开时，Market hub 单独走此 origin（无尾斜杠）。 */
export const CHANGMEN_MARKET_HUB_ORIGIN = "https://ws.changmen.fun";

/** 本次会话由 Client_GetUserInfo 写入；不进 sessionStorage，避免刷新后抢先用旧值。 */
let assignedMarketHubOrigin = "";

function normalizeAllowedMarketHubOrigin(origin: string | null | undefined): string {
  const normalized = String(origin || "").trim().replace(/\/+$/, "");
  return normalized === CHANGMEN_MARKET_HUB_ORIGIN ? normalized : "";
}

export function setAssignedMarketHubOrigin(origin: string | null | undefined): void {
  assignedMarketHubOrigin = normalizeAllowedMarketHubOrigin(origin);
}

export function getAssignedMarketHubOrigin(): string {
  return assignedMarketHubOrigin;
}

function marketHubOriginFromEnv(): string {
  if (typeof import.meta === "undefined")
    return "";
  if (!import.meta.env?.DEV)
    return "";
  const env = import.meta.env as Record<string, string | undefined>;
  return String(env.VITE_MARKET_HUB_ORIGIN || "").trim().replace(/\/+$/, "");
}

/**
 * PM / PF / PM-SPORT Market WS 的 HTTP origin。
 * 主站 changmen.fun：用 GetUserInfo 下发的 origin；未下发（未登录/旧后端）→ ws（202）。
 * dev / IP / 其它域名仍同源。PM-USER、http-relay 不要用这个。
 */
export function resolveMarketHubHttpOrigin(): string {
  const fromEnv = marketHubOriginFromEnv();
  if (fromEnv)
    return fromEnv;

  if (typeof window !== "undefined" && typeof import.meta !== "undefined" && import.meta.env?.DEV)
    return resolveHkRelayHttpOrigin();

  if (typeof window !== "undefined") {
    const host = String(window.location?.hostname || "");
    if (host === "changmen.fun" || host === "www.changmen.fun")
      return assignedMarketHubOrigin || CHANGMEN_MARKET_HUB_ORIGIN;
  }

  return resolveHkRelayHttpOrigin();
}

/** @deprecated 使用 resolveHkRelayHttpOrigin */
export function resolvePmHkRelayHttpOrigin(): string {
  return resolveHkRelayHttpOrigin();
}
