import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { CollectHttpSession } from "../shared/collectSession";
import { IMT_DEFAULT_X_SC } from "./parse";

export interface ImtTokenPayload {
  tk?: string;
  v?: string;
}

/** 对齐 A8 zQe / backend imt_session.decodeToken */
export function decodeImtToken(raw: string): ImtTokenPayload | null {
  if (!raw) return null;
  try {
    const json = atob(raw);
    return JSON.parse(json) as ImtTokenPayload;
  } catch {
    return null;
  }
}

/** 对齐 A8 Cee / backend imt_session.buildHeaders */
function defaultImtUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

function buildImtHeaderFields(
  token: string,
  referer: string,
  userAgent?: string,
  xSc?: string,
): Record<string, string> {
  const decoded = decodeImtToken(token);
  return {
    "content-type": "application/json; charset=utf-8",
    referer,
    "user-agent": userAgent || defaultImtUserAgent(),
    "x-isfacelift": "true",
    "x-lang": "hans",
    "x-platform": "1",
    "x-sc": xSc || IMT_DEFAULT_X_SC,
    "x-token": decoded?.tk || "",
    "x-v": decoded?.v || "",
    "x-viewtype": "1",
  };
}

export function buildImtHeaders(session: CollectHttpSession): Record<string, string> {
  return buildImtHeaderFields(
    session.token,
    session.referer || session.gateway,
    session.userAgent,
    session.xSc,
  );
}

/** 对齐 A8 Ow() — 账号下注 relay */
export function buildImtAccountHeaders(account: PlatformAccount): Record<string, string> {
  return buildImtHeaderFields(
    account.token || "",
    account.referer || account.gateway || "",
    account.userAgent,
  );
}

export function imtAccountUrl(account: PlatformAccount, path: string): string {
  const base = (account.gateway || "").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
