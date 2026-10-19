import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

/** 旧平博：`BrowserSessionId_515`；ps3838：无后缀 `BrowserSessionId` */
type PbSessionMode =
  | { kind: "suffixed"; suffix: string }
  | { kind: "plain" };

function detectPbSessionMode(
  appData: Record<string, string>,
  outer: Record<string, string>,
): PbSessionMode {
  for (const key of Object.keys(appData)) {
    const m = key.match(/^BrowserSessionId_(\d+)$/);
    if (m) return { kind: "suffixed", suffix: m[1]! };
  }
  for (const key of Object.keys(appData)) {
    const m = key.match(/^custid_(\d+)$/);
    if (m) return { kind: "suffixed", suffix: m[1]! };
  }
  for (const key of Object.keys(outer)) {
    const m = key.match(/^custid_(\d+)$/);
    if (m) return { kind: "suffixed", suffix: m[1]! };
  }
  if (
    appData.BrowserSessionId
    || appData.custid
    || outer.custid
    || hasPlainTokenHeaders(outer.token)
  ) {
    return { kind: "plain" };
  }
  return { kind: "suffixed", suffix: "515" };
}

function hasPlainTokenHeaders(tokenRaw: string | undefined): boolean {
  if (!tokenRaw) return false;
  try {
    const inner = JSON.parse(tokenRaw) as Record<string, string>;
    return Boolean(inner["X-Browser-Session-Id"] || inner["X-Custid"]);
  }
  catch {
    return false;
  }
}

function resolveCustidRaw(
  mode: PbSessionMode,
  appData: Record<string, string>,
  outer: Record<string, string>,
): string {
  if (mode.kind === "plain") {
    return appData.custid || outer.custid || "";
  }
  const suffix = mode.suffix;
  return (
    appData[`custid_${suffix}`]
    || outer[`custid_${suffix}`]
    || outer.custid_515
    || ""
  );
}

function resolveBrowserSessionId(
  mode: PbSessionMode,
  appData: Record<string, string>,
): string {
  if (mode.kind === "plain") return appData.BrowserSessionId || "";
  return appData[`BrowserSessionId_${mode.suffix}`] || "";
}

function decodePbCustidRaw(raw: string): string {
  try {
    return decodeURIComponent(String(raw).replace(/\+/g, "%20"));
  }
  catch {
    return String(raw || "");
  }
}

function custidMemberId(custidDecoded: string): string {
  const id = new URLSearchParams(custidDecoded).get("id");
  return id != null ? String(id).trim() : "";
}

function tryParseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? v as Record<string, unknown>
      : undefined;
  }
  catch {
    return undefined;
  }
}

function decodeBase64Utf8(raw: string): string {
  const cleaned = String(raw).replace(/\s+/g, "");
  if (typeof Buffer !== "undefined")
    return Buffer.from(cleaned, "base64").toString("utf8");
  const bin = atob(cleaned);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseBase64Json(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw)
    return undefined;
  try {
    return tryParseJsonObject(decodeBase64Utf8(raw));
  }
  catch {
    return undefined;
  }
}

/** 粘贴可能是 base64 外层 / {provider,token} / 内层 cookie JSON */
function normalizePbTokenCookie(token: string): Record<string, string> | undefined {
  const text = String(token).trim();
  if (!text)
    return undefined;
  let parsed = tryParseJsonObject(text);
  if (!parsed) {
    try {
      parsed = tryParseJsonObject(decodeBase64Utf8(text));
    }
    catch {
      return undefined;
    }
  }
  if (!parsed)
    return undefined;
  // 剪贴板外层：{ provider, gateway, token, referer }
  if (typeof parsed.token === "string" && (parsed.provider || parsed.gateway || parsed.referer)) {
    const inner = tryParseJsonObject(parsed.token);
    if (inner)
      return inner as Record<string, string>;
  }
  return parsed as Record<string, string>;
}

export interface PbVenueIdentity {
  venueMemberId: string;
  venueAccountName: string;
}

/**
 * [changmen 扩展] 从 PB 粘贴 token 解析场馆会员身份。
 * - venueMemberId：`__udata.userCode` 或 `custid` / `custid_{suffix}` 的 `id=`
 * - venueAccountName：`__udata.loginId` / `a.loginId`
 */
export function parsePbVenueIdentity(
  token: string | undefined | null,
): PbVenueIdentity | undefined {
  if (token == null || !String(token).trim())
    return undefined;
  try {
    const outer = normalizePbTokenCookie(String(token));
    if (!outer)
      return undefined;
    const appDataRaw = outer["x-app-data"] || "{}";
    const appData = (tryParseJsonObject(appDataRaw) || {}) as Record<string, string>;
    const mode = detectPbSessionMode(appData, outer);
    const custidDecoded = decodePbCustidRaw(resolveCustidRaw(mode, appData, outer));
    const fromCustid = custidMemberId(custidDecoded);

    let fromInnerCustid = "";
    try {
      const inner = tryParseJsonObject(outer.token || "{}") as Record<string, string> | undefined;
      const innerCustid =
        mode.kind === "plain"
          ? (inner?.["X-Custid"] || inner?.["x-custid"] || "")
          : (inner?.[`X-Custid-${mode.suffix}`] || inner?.[`x-custid-${mode.suffix}`] || "");
      fromInnerCustid = custidMemberId(decodePbCustidRaw(innerCustid));
    }
    catch {
      /* optional */
    }

    const udata = parseBase64Json(outer.__udata);
    const a = parseBase64Json(outer.a);
    const userCode = String(udata?.userCode ?? "").trim();
    const loginId = String(udata?.loginId ?? a?.loginId ?? "").trim();

    const venueMemberId = userCode || fromCustid || fromInnerCustid;
    const venueAccountName = loginId || venueMemberId;
    if (!venueMemberId && !venueAccountName)
      return undefined;
    return {
      venueMemberId: venueMemberId || venueAccountName,
      venueAccountName: venueAccountName || venueMemberId,
    };
  }
  catch {
    return undefined;
  }
}

export function pbVenueMemberIdsEqual(
  left?: string | null,
  right?: string | null,
): boolean {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b)
    return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * 已绑定的 `venueMemberId` 优先；否则从 token 解析。
 * 活标签代发 / 写回 token 都用这个，避免官网换号后打到别人账上。
 */
export function resolvePbAccountVenueMemberId(
  account: Pick<PlatformAccount, "token" | "venueMemberId">,
): string {
  const bound = String(account.venueMemberId || "").trim();
  if (bound)
    return bound;
  return parsePbVenueIdentity(account.token)?.venueMemberId || "";
}

/**
 * 合并 localStorage.token 内层鉴权头（part888/ps3838 的 X-U / X-SLID / X-Lcu 等）。
 * 只收 x-*，避免误把 Odds:Selections 等业务键写成非法 HTTP 头。
 * 仅路径 B（plain / 非 515 后缀）调用；515 走 A8 k0，禁止合并。
 */
function mergeInnerTokenHeaders(
  headers: Record<string, string>,
  outer: Record<string, string>,
): void {
  const innerRaw = outer.token;
  if (!innerRaw) return;
  try {
    const inner = JSON.parse(innerRaw) as Record<string, string>;
    for (const [key, value] of Object.entries(inner)) {
      if (value == null || value === "") continue;
      const lower = key.toLowerCase();
      if (!lower.startsWith("x-")) continue;
      headers[lower] = String(value);
    }
  } catch {
    /* optional nested auth headers */
  }
}

/** [A8 可证实] 认不出或经典 515 → k0，不带内层 X-U */
function isA8K0Session(mode: PbSessionMode): boolean {
  return mode.kind === "suffixed" && mode.suffix === "515";
}

function readSessionModeFromToken(token: string): PbSessionMode | undefined {
  const outer = normalizePbTokenCookie(token);
  if (!outer) return undefined;
  const appData = (tryParseJsonObject(outer["x-app-data"] || "{}") || {}) as Record<string, string>;
  return detectPbSessionMode(appData, outer);
}

/**
 * [changmen 扩展] part888 / 非 515：有官网标签时走活头代发。
 * 515 必须 false，避免把 A8 k0 打进官网页。
 */
export function pbAccountUsesLiveTab(account: Pick<PlatformAccount, "token">): boolean {
  if (account.token == null || !String(account.token).trim())
    return false;
  try {
    const mode = readSessionModeFromToken(String(account.token));
    return Boolean(mode && !isA8K0Session(mode));
  }
  catch {
    return false;
  }
}

/**
 * [A8 可证实] bundle `k0(t,e)` 固定 515 五字段，不合并内层 x-*。
 * [changmen 扩展] 仅 plain / 非 515 后缀改头名并合并 X-U（否则 part888 预检 403）。
 */
export function buildPbAuthHeaders(
  account: PlatformAccount,
  extra: Record<string, string> = {},
): Record<string, string> | undefined {
  if (account.token == null) return undefined;
  try {
    const outer = normalizePbTokenCookie(String(account.token));
    if (!outer) return undefined;
    const appData = (tryParseJsonObject(outer["x-app-data"] || "{}") || {}) as Record<string, string>;
    const mode = detectPbSessionMode(appData, outer);
    const sessionId = resolveBrowserSessionId(mode, appData);
    const custidRaw = resolveCustidRaw(mode, appData, outer);
    const headers: Record<string, string> = {
      "x-app-data": `${Object.keys(appData)
        .map((k) => `${k}=${appData[k]}`)
        .join(";")};`,
    };
    if (mode.kind === "plain") {
      headers["x-browser-session-id"] = sessionId;
      headers["x-custid"] = decodePbCustidRaw(String(custidRaw)) || "";
    }
    else {
      const suffix = mode.suffix;
      headers[`x-browser-session-id-${suffix}`] = sessionId;
      headers[`x-custid-${suffix}`] = decodePbCustidRaw(String(custidRaw)) || "";
    }
    headers["v-hucode"] = outer["v-hucode"] || "";
    headers["x-requested-with"] = "XMLHttpRequest";
    if (!isA8K0Session(mode))
      mergeInnerTokenHeaders(headers, outer);
    for (const key of Object.keys(extra)) {
      headers[key] = extra[key]!;
    }
    return headers;
  } catch {
    return undefined;
  }
}
