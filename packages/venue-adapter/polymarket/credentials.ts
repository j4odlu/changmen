import type { ApiKeyRaw, L1PolyHeader } from "@polymarket/clob-client-v2";
import { POLYMARKET_CLOB_API } from "./api";
import { normalizePolymarketPrivateKey } from "./depositWallet";
import { polymarketPluginGet, polymarketPluginPost } from "./transport";

type Hex = `0x${string}`;

export interface PolymarketApiCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface PolymarketCredentialInput {
  gateway?: string;
  walletAddress?: string;
  funder?: string;
  privateKey: string;
}

export interface PolymarketCredentialRequestOptions {
  /** changmen API 根（空 = 浏览器同源） */
  apiBase?: string;
  /** 登录 JWT；有则走服务端直连 CLOB L1（推荐生产） */
  authToken?: string;
}

export interface PolymarketDerivedCredentials {
  signerAddress: string;
  apiCreds: PolymarketApiCreds;
}

function normalizeGateway(gateway: string | undefined): string {
  const value = gateway?.trim() || POLYMARKET_CLOB_API;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizePrivateKey(raw: string): Hex {
  return normalizePolymarketPrivateKey(raw);
}

function normalizeAddress(raw: string | undefined): string {
  return raw?.trim().toLowerCase() ?? "";
}

function stringifyHeaders(headers: L1PolyHeader): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)]),
  );
}

async function fetchClobServerTime(gateway: string): Promise<number> {
  const raw = await polymarketPluginGet<unknown>(`${gateway}/time`);
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp) || timestamp <= 0)
    throw new Error("Polymarket CLOB 未返回有效服务器时间");
  return Math.floor(timestamp);
}

function normalizeApiCreds(raw: ApiKeyRaw | unknown): PolymarketApiCreds | undefined {
  if (!raw || typeof raw !== "object")
    return undefined;
  const item = raw as Partial<ApiKeyRaw> & { key?: unknown };
  const apiKey = String(item.apiKey ?? item.key ?? "");
  const secret = String(item.secret ?? "");
  const passphrase = String(item.passphrase ?? "");
  if (!apiKey || !secret || !passphrase)
    return undefined;
  return { apiKey, secret, passphrase };
}

export async function createOrDerivePolymarketApiCreds(
  input: PolymarketCredentialInput,
  _options?: PolymarketCredentialRequestOptions,
): Promise<PolymarketDerivedCredentials> {
  // 方案 C：仅浏览器内 L1 派生，禁止把 privateKey POST 到 VPS
  const gateway = normalizeGateway(input.gateway);
  const privateKey = normalizePrivateKey(input.privateKey);
  const [
    clob,
    viem,
    accounts,
  ] = await Promise.all([
    import("@polymarket/clob-client-v2"),
    import("viem"),
    import("viem/accounts"),
  ]);

  const account = accounts.privateKeyToAccount(privateKey);
  const signerAddress = account.address;
  const expectedWallet = normalizeAddress(input.walletAddress);
  if (expectedWallet && expectedWallet !== signerAddress.toLowerCase()) {
    throw new Error(`私钥地址 ${signerAddress} 与填写的钱包地址不一致`);
  }

  const { createPolygonHttpTransport, polygonChainForRpc } = await import("./polygonRpc");
  const signer = viem.createWalletClient({
    account,
    chain: polygonChainForRpc(),
    transport: createPolygonHttpTransport(),
  });
  const createL1Headers = async (): Promise<Record<string, string>> => {
    // L1 timestamp is validated by CLOB. Use its clock and generate a fresh
    // signature for each create/derive request, matching the official client.
    const timestamp = await fetchClobServerTime(gateway);
    return stringifyHeaders(
      await clob.createL1Headers(signer, clob.Chain.POLYGON, undefined, timestamp),
    );
  };

  let created: PolymarketApiCreds | undefined;
  try {
    created = normalizeApiCreds(
      await polymarketPluginPost<ApiKeyRaw>(`${gateway}/auth/api-key`, undefined, {
        headers: await createL1Headers(),
      }),
    );
  }
  catch {
    created = undefined;
  }
  if (created)
    return { signerAddress, apiCreds: created };

  const derived = normalizeApiCreds(
    await polymarketPluginGet<ApiKeyRaw>(`${gateway}/auth/derive-api-key`, {
      headers: await createL1Headers(),
    }),
  );
  if (!derived)
    throw new Error("Polymarket 未返回有效 API 凭证");
  return { signerAddress, apiCreds: derived };
}
