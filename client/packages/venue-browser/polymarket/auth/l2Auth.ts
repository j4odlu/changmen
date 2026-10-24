import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

type Hex = `0x${string}`;

export interface PolymarketTokenConfig {
  token?: string;
  walletAddress?: string;
  address?: string;
  funder?: string;
  funderAddress?: string;
  signatureType?: number | string;
  privateKey?: string;
  private_key?: string;
  apiKey?: string;
  key?: string;
  api_key?: string;
  secret?: string;
  apiSecret?: string;
  api_secret?: string;
  passphrase?: string;
  apiCreds?: {
    apiKey?: string;
    key?: string;
    api_key?: string;
    secret?: string;
    apiSecret?: string;
    api_secret?: string;
    passphrase?: string;
  };
  polyHeaders?: Record<string, unknown>;
}

function parseJsonObject(text: string | undefined): PolymarketTokenConfig | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as PolymarketTokenConfig : undefined;
  }
  catch {
    return undefined;
  }
}

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

function unwrapNestedTokenConfig(config: PolymarketTokenConfig | undefined): PolymarketTokenConfig | undefined {
  const nestedToken = typeof config?.token === "string" ? config.token.trim() : "";
  if (!nestedToken) return config;
  const nested = parseJsonObject(nestedToken) ?? parseJsonObject(decodeBase64Utf8(nestedToken));
  return nested ?? config;
}

export function parseTokenConfig(raw: string | undefined): PolymarketTokenConfig {
  const text = raw?.trim();
  if (!text) return {};
  const direct = parseJsonObject(text);
  if (direct) return unwrapNestedTokenConfig(direct) ?? {};
  const decoded = decodeBase64Utf8(text);
  return unwrapNestedTokenConfig(parseJsonObject(decoded)) ?? {};
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value != null) return String(value);
  }
  return "";
}

export function resolveApiCreds(config: PolymarketTokenConfig) {
  const headers = config.polyHeaders;
  const api = config.apiCreds ?? {};
  const pick = (value: unknown) => String(value ?? "").trim();
  return {
    address: pick(config.walletAddress || config.address || headerValue(headers, "POLY_ADDRESS")),
    apiKey: pick(api.apiKey || api.key || api.api_key
      || config.apiKey || config.key || config.api_key
      || headerValue(headers, "POLY_API_KEY")),
    secret: pick(api.secret || api.apiSecret || api.api_secret
      || config.secret || config.apiSecret || config.api_secret),
    passphrase: pick(api.passphrase || config.passphrase || headerValue(headers, "POLY_PASSPHRASE")),
    signatureType: resolveSignatureType(config),
  };
}

export function resolveFunder(config: PolymarketTokenConfig): string {
  return config.funder || config.funderAddress || "";
}

/** 0x 地址小写规范化（非法则空串） */
export function normalizeEthAddress(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(s) ? s : "";
}

/** token 内所有可能出现在 CLOB maker_address 的本账户地址 */
export function collectPolymarketUserAddresses(config: PolymarketTokenConfig): Set<string> {
  const out = new Set<string>();
  for (const raw of [
    config.walletAddress,
    config.address,
    config.funder,
    config.funderAddress,
    headerValue(config.polyHeaders, "POLY_ADDRESS"),
  ]) {
    const n = normalizeEthAddress(raw);
    if (n)
      out.add(n);
  }
  return out;
}

export function collectPolymarketUserAddressesFromAccount(account: PlatformAccount): Set<string> {
  return collectPolymarketUserAddresses(parseTokenConfig(account.token));
}

function resolveAddress(config: PolymarketTokenConfig): string {
  return config.walletAddress || config.address || headerValue(config.polyHeaders, "POLY_ADDRESS");
}

export function resolveSignatureType(config: PolymarketTokenConfig): string | number | undefined {
  const address = resolveAddress(config).toLowerCase();
  const funder = resolveFunder(config).toLowerCase();
  if (address && funder && address !== funder) return 3;
  if (config.signatureType !== undefined && config.signatureType !== "") return config.signatureType;
  return undefined;
}

export function resolvePrivateKey(config: PolymarketTokenConfig): Hex | undefined {
  const raw = config.privateKey ?? config.private_key;
  if (!raw) return undefined;
  const key = String(raw).trim();
  const hex = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? hex as Hex : undefined;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

function hmacSha256Base64Url(secret: string, message: string): string {
  const secretBytes = base64UrlToBytes(secret);
  const messageBytes = new TextEncoder().encode(message);
  return bytesToBase64Url(hmac(sha256, secretBytes, messageBytes));
}

export async function buildL2Headers(
  address: string,
  apiKey: string,
  secret: string,
  passphrase: string,
  method: "GET" | "POST" | "DELETE",
  requestPath: string,
  body?: string,
  timestampOverride?: number,
): Promise<Record<string, string>> {
  const timestamp = String(timestampOverride ?? Math.floor(Date.now() / 1000));
  const signature = hmacSha256Base64Url(secret, timestamp + method + requestPath + (body ?? ""));
  const headers: Record<string, string> = {
    "POLY_ADDRESS": address,
    "POLY_SIGNATURE": signature,
    "POLY_TIMESTAMP": timestamp,
    "POLY_API_KEY": apiKey,
    "POLY_PASSPHRASE": passphrase,
  };
  if (method === "POST" || method === "DELETE")
    headers["Content-Type"] = "application/json";
  return headers;
}

export async function buildL2HeadersFromAccount(
  account: PlatformAccount,
  method: "GET" | "POST" | "DELETE",
  requestPath: string,
  body?: string,
  timestampOverride?: number,
): Promise<Record<string, string> | undefined> {
  const creds = resolveApiCreds(parseTokenConfig(account.token));
  if (!creds.address || !creds.apiKey || !creds.secret || !creds.passphrase) return undefined;
  return buildL2Headers(
    creds.address,
    creds.apiKey,
    creds.secret,
    creds.passphrase,
    method,
    requestPath,
    body,
    timestampOverride,
  );
}
