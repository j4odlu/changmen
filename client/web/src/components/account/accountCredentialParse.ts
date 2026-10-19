import type { PlatformId } from "@/types/esport";
import type { PolymarketApiCreds } from "@changmen/venue-browser/adapter/polymarket";

export interface PastedAccountCredential {
  provider?: PlatformId;
  token?: string;
  referer?: string;
  gateway?: string | string[];
}

export function isSportObCollectCredential(parsed: Record<string, unknown> | undefined): boolean {
  if (!parsed)
    return false;
  if (String(parsed.kind || "").toLowerCase() === "sport")
    return true;
  const token = String(parsed.token || "").trim();
  const sessionId = String(parsed.sessionId || "").trim();
  return Boolean(sessionId && token && /^[0-9a-f]{16,}$/i.test(token) && !/^\d+$/.test(token));
}

export function parsePastedObject(raw: string): Record<string, unknown> | undefined {
  return tryParseJson(raw) ?? tryParseJson(decodeBase64Utf8(raw));
}

export function parsePastedAccountCredential(raw: string): PastedAccountCredential | undefined {
  const parsed = parsePastedObject(raw);
  if (!parsed)
    return undefined;
  if (isSportObCollectCredential(parsed))
    return undefined;
  if (parsed.provider) {
    const credential = parsed as PastedAccountCredential;
    if (!credential.token && typeof parsed.accessToken === "string")
      credential.token = String(parsed.accessToken);
    if (
      credential?.provider === "Polymarket"
      && !credential.token
    ) {
      credential.token = JSON.stringify({
        walletAddress: parsed.walletAddress,
        address: parsed.address,
        funder: parsed.funder,
        signatureType: parsed.signatureType,
        privateKey: parsed.privateKey,
        private_key: parsed.private_key,
        apiKey: parsed.apiKey,
        key: parsed.key,
        secret: parsed.secret,
        passphrase: parsed.passphrase,
        apiCreds: parsed.apiCreds,
        polyHeaders: parsed.polyHeaders,
      });
    }
    return credential;
  }
  if (
    parsed.walletAddress
    || parsed.address
    || parsed.apiCreds
    || parsed.apiKey
    || parsed.key
    || parsed.secret
    || parsed.passphrase
    || parsed.privateKey
    || parsed.private_key
  ) {
    return {
      provider: "Polymarket",
      gateway: "https://clob.polymarket.com",
      token: JSON.stringify(parsed),
      referer: "",
    };
  }
  return undefined;
}

export function parsePolymarketTokenObject(raw: string | undefined): Record<string, unknown> | undefined {
  const text = raw?.trim();
  if (!text)
    return {};
  const parsed = tryParseJson(text) ?? tryParseJson(decodeBase64Utf8(text));
  if (!parsed)
    return undefined;

  const nestedToken = typeof parsed.token === "string" ? parsed.token.trim() : "";
  if (nestedToken) {
    const nested = tryParseJson(nestedToken) ?? tryParseJson(decodeBase64Utf8(nestedToken));
    if (nested)
      return nested;
  }

  return parsed;
}

export function normalizePolymarketTokenObject(token: Record<string, unknown>): Record<string, unknown> {
  const walletAddress = String(token.walletAddress ?? token.address ?? "");
  const funder = String(token.funder ?? token.funderAddress ?? "");
  if (walletAddress && funder && walletAddress.toLowerCase() !== funder.toLowerCase())
    token.signatureType = "3";
  else if (token.signatureType === undefined || token.signatureType === "")
    token.signatureType = "3";
  return token;
}

export function normalizePolymarketApiCreds(token: Record<string, unknown>): PolymarketApiCreds | undefined {
  const rawApi = token.apiCreds;
  const api = rawApi && typeof rawApi === "object"
    ? rawApi as Record<string, unknown>
    : token;
  const apiKey = String(api.apiKey ?? api.key ?? api.api_key ?? "");
  const secret = String(api.secret ?? api.apiSecret ?? api.api_secret ?? "");
  const passphrase = String(api.passphrase ?? "");
  if (!apiKey || !secret || !passphrase)
    return undefined;
  return { apiKey, secret, passphrase };
}

export function tokenFromPolymarketForm(
  values: {
    walletAddress: string;
    funder: string;
    privateKey: string;
    apiCreds?: PolymarketApiCreds;
  },
): string {
  const token: Record<string, unknown> = {
    walletAddress: values.walletAddress.trim(),
    funder: values.funder.trim(),
    signatureType: "3",
    privateKey: values.privateKey.trim(),
  };
  if (values.apiCreds) {
    token.apiCreds = {
      apiKey: values.apiCreds.apiKey,
      secret: values.apiCreds.secret,
      passphrase: values.apiCreds.passphrase,
    };
  }
  return JSON.stringify(normalizePolymarketTokenObject(token));
}

export function tryParseJson(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw)
    return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  }
  catch {
    return undefined;
  }
}

export function decodeBase64Utf8(raw: string): string | undefined {
  try {
    const atobFn = typeof globalThis.atob === "function" ? globalThis.atob.bind(globalThis) : undefined;
    if (!atobFn)
      return undefined;
    const binary = atobFn(raw);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  catch {
    return undefined;
  }
}

