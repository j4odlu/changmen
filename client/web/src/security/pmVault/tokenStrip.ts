/**
 * Polymarket / PredictFun token JSON：落库 DTO + 内存 merge/extract（方案 C）
 *
 * Polymarket 发往服务端：walletAddress / funder / signatureType / apiCreds。
 * PredictFun 发往服务端：仅 predictAccount。
 * 服务端 Save 若仍见到私钥材料会直接拒绝。
 */

const MAX_TOKEN_UNWRAP = 8;

function decodeBase64Utf8(text: string): string | undefined {
  try {
    const binary = atob(text);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  catch {
    return undefined;
  }
}

function isPrivateKeyPropName(key: string): boolean {
  return /^private_?key$/i.test(key) || /^privy_?private_?key$/i.test(key);
}

function looksLikeRawPrivateKey(text: string): boolean {
  return /^0x?[0-9a-fA-F]{64}$/.test(text.trim());
}

/** 仅接受标准 ETH 地址，避免把裸私钥塞进 wallet/funder */
function pickEthAddress(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || looksLikeRawPrivateKey(s))
    return "";
  return /^0x[0-9a-fA-F]{40}$/.test(s) ? s : "";
}

function rejectIfPrivateKeyShaped(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || looksLikeRawPrivateKey(s))
    return "";
  return s;
}

/** signatureType 仅允许 0–3 */
function pickSignatureType(
  raw: unknown,
  walletAddress: string,
  funder: string,
): number | string | undefined {
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 3)
      return raw;
    const s = String(raw).trim();
    if (/^[0-3]$/.test(s))
      return s;
  }
  if (walletAddress && funder && walletAddress.toLowerCase() !== funder.toLowerCase())
    return "3";
  return undefined;
}

export function parseTokenObject(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string")
    return null;
  const text = raw.trim();
  if (!text)
    return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  }
  catch {
    /* try base64 */
  }
  const decoded = decodeBase64Utf8(text);
  if (!decoded)
    return null;
  try {
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  }
  catch {
    return null;
  }
}

/** Wallet identity used consistently by key recovery, merging and readiness checks. */
export function tokenWalletAddress(raw: string | undefined | null): string {
  const obj = parseTokenObject(raw);
  const value = String(obj?.walletAddress ?? obj?.address ?? obj?.predictAccount
    ?? obj?.predict_account ?? obj?.funder ?? obj?.funderAddress ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(value) ? value : "";
}

function resolveConfigObject(
  raw: string,
  unwrap = 0,
): Record<string, unknown> | null {
  const obj = parseTokenObject(raw);
  if (!obj)
    return null;
  if (unwrap >= MAX_TOKEN_UNWRAP)
    return obj;
  if (typeof obj.token === "string" && obj.token.trim()) {
    const nested = resolveConfigObject(obj.token, unwrap + 1);
    if (nested)
      return nested;
  }
  return obj;
}

function pickApiCreds(obj: Record<string, unknown>): {
  apiKey: string;
  secret: string;
  passphrase: string;
} | undefined {
  const rawApi = obj.apiCreds;
  const api = rawApi && typeof rawApi === "object" && !Array.isArray(rawApi)
    ? rawApi as Record<string, unknown>
    : obj;
  const apiKey = rejectIfPrivateKeyShaped(api.apiKey ?? api.key ?? api.api_key ?? "");
  const secret = rejectIfPrivateKeyShaped(api.secret ?? api.apiSecret ?? api.api_secret ?? "");
  const passphrase = rejectIfPrivateKeyShaped(api.passphrase ?? "");
  if (!apiKey || !secret || !passphrase)
    return undefined;
  return { apiKey, secret, passphrase };
}

/** 深搜：粘贴/迁移/下注前从任意形态取出私钥（仅内存用） */
function extractFromObject(
  obj: Record<string, unknown>,
  tokenUnwrap: number,
  seen: WeakSet<object>,
): string | undefined {
  if (seen.has(obj))
    return undefined;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (isPrivateKeyPropName(k) && typeof v === "string" && v.trim())
      return v.trim();
  }
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.trim() && tokenUnwrap < MAX_TOKEN_UNWRAP) {
      if (looksLikeRawPrivateKey(val))
        return val.trim().startsWith("0x") || val.trim().startsWith("0X")
          ? val.trim()
          : `0x${val.trim()}`;
      const nestedObj = parseTokenObject(val);
      if (nestedObj) {
        const nested = extractFromObject(nestedObj, tokenUnwrap + 1, seen);
        if (nested)
          return nested;
      }
      continue;
    }
    const found = extractFromValue(val, tokenUnwrap, seen);
    if (found)
      return found;
  }
  return undefined;
}

function extractFromValue(
  val: unknown,
  tokenUnwrap: number,
  seen: WeakSet<object>,
): string | undefined {
  if (typeof val === "string") {
    if (looksLikeRawPrivateKey(val))
      return val.trim().startsWith("0x") || val.trim().startsWith("0X")
        ? val.trim()
        : `0x${val.trim()}`;
    return undefined;
  }
  if (!val || typeof val !== "object")
    return undefined;
  if (Array.isArray(val)) {
    for (const item of val) {
      const found = extractFromValue(item, tokenUnwrap, seen);
      if (found)
        return found;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const fromObj = extractFromObject(item as Record<string, unknown>, tokenUnwrap, seen);
        if (fromObj)
          return fromObj;
      }
      if (typeof item === "string" && item.trim() && tokenUnwrap < MAX_TOKEN_UNWRAP) {
        const nestedObj = parseTokenObject(item);
        if (nestedObj) {
          const nested = extractFromObject(nestedObj, tokenUnwrap + 1, seen);
          if (nested)
            return nested;
        }
      }
    }
    return undefined;
  }
  return extractFromObject(val as Record<string, unknown>, tokenUnwrap, seen);
}

export function extractPrivateKeyFromToken(raw: string | undefined | null): string | undefined {
  if (raw == null)
    return undefined;
  const text = String(raw).trim();
  if (!text)
    return undefined;
  if (looksLikeRawPrivateKey(text))
    return text.startsWith("0x") || text.startsWith("0X") ? text : `0x${text}`;
  const obj = parseTokenObject(text);
  if (!obj)
    return undefined;
  return extractFromObject(obj, 0, new WeakSet());
}

/**
 * 落库白名单 DTO 投影（可安全写 RDS / 发往服务端）。
 * 无法解析 / 裸私钥 → ""。
 */
export function toPolymarketPersistToken(raw: string | undefined | null): string {
  if (raw == null)
    return "";
  const text = String(raw).trim();
  if (!text)
    return "";
  if (looksLikeRawPrivateKey(text))
    return "";
  const obj = resolveConfigObject(text);
  if (!obj)
    return "";

  const out: Record<string, unknown> = {};
  const walletAddress = pickEthAddress(obj.walletAddress ?? obj.address ?? "");
  const funder = pickEthAddress(obj.funder ?? obj.funderAddress ?? "");
  if (walletAddress)
    out.walletAddress = walletAddress;
  if (funder)
    out.funder = funder;

  const sig = pickSignatureType(obj.signatureType, walletAddress, funder);
  if (sig !== undefined)
    out.signatureType = sig;

  const apiCreds = pickApiCreds(obj);
  if (apiCreds)
    out.apiCreds = apiCreds;

  return JSON.stringify(out);
}

/** PredictFun 落库：仅 predictAccount */
export function toPredictFunPersistToken(raw: string | undefined | null): string {
  if (raw == null)
    return "";
  const text = String(raw).trim();
  if (!text)
    return "";
  if (looksLikeRawPrivateKey(text))
    return "";
  const obj = resolveConfigObject(text);
  if (!obj)
    return "";
  const predictAccount = pickEthAddress(
    obj.predictAccount ?? obj.predict_account ?? obj.walletAddress ?? obj.address ?? "",
  );
  if (!predictAccount)
    return "";
  return JSON.stringify({ predictAccount });
}

/** @deprecated 使用 toPolymarketPersistToken */
export const stripPrivateKeyFromToken = toPolymarketPersistToken;

/** 内存合并：在白名单投影上写回私钥（仅会话内） */
export function mergePrivateKeyIntoToken(
  raw: string | undefined | null,
  privateKey: string,
  provider?: unknown,
): string {
  const pk = privateKey.trim();
  if (isPredictFunProvider(provider)) {
    const base = toPredictFunPersistToken(raw);
    const obj = parseTokenObject(base) ?? {};
    obj.privyPrivateKey = pk;
    for (const k of Object.keys(obj)) {
      if (k !== "privyPrivateKey" && isPrivateKeyPropName(k))
        delete obj[k];
    }
    delete obj.mode;
    delete obj.house;
    return JSON.stringify(obj);
  }
  const base = toPolymarketPersistToken(raw);
  const obj = parseTokenObject(base) ?? {};
  obj.privateKey = pk;
  for (const k of Object.keys(obj)) {
    if (k !== "privateKey" && isPrivateKeyPropName(k))
      delete obj[k];
  }
  return JSON.stringify(obj);
}

export function accountTokenHasPrivateKey(raw: string | undefined | null): boolean {
  return Boolean(extractPrivateKeyFromToken(raw));
}

export function isPolymarketProvider(provider: unknown): boolean {
  const p = String(provider ?? "").trim().toLowerCase();
  return p === "polymarket" || p === "pm";
}

export function isPredictFunProvider(provider: unknown): boolean {
  const p = String(provider ?? "").trim().toLowerCase();
  return p === "predictfun" || p === "predict.fun" || p === "pf";
}

/** 本机加密仓覆盖的场馆（私钥不上报） */
export function isVaultKeyProvider(provider: unknown): boolean {
  return isPolymarketProvider(provider) || isPredictFunProvider(provider);
}

export function toPersistTokenForProvider(
  provider: unknown,
  raw: string | undefined | null,
): string {
  if (isPredictFunProvider(provider))
    return toPredictFunPersistToken(raw);
  return toPolymarketPersistToken(raw);
}
