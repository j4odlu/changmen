import { POLYMARKET_CLOB_API } from "../api";
import { normalizePolymarketPrivateKey, POLYGON_CHAIN_ID } from "../wallet/depositWallet";
import { polymarketPluginGet, polymarketPluginPost } from "../transport/transport";

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
  /** @deprecated 仅保留调用兼容；凭证始终在浏览器签名，不上传私钥。 */
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

async function fetchClobServerTime(gateway: string): Promise<number> {
  const raw = await polymarketPluginGet<unknown>(`${gateway}/time`);
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp) || timestamp <= 0)
    throw new Error("Polymarket CLOB 未返回有效服务器时间");
  return Math.floor(timestamp);
}

function normalizeApiCreds(raw: unknown): PolymarketApiCreds | undefined {
  if (!raw || typeof raw !== "object")
    return undefined;
  const item = raw as { apiKey?: unknown; key?: unknown; secret?: unknown; passphrase?: unknown };
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
    unified,
    viem,
    accounts,
  ] = await Promise.all([
    import("@polymarket/client/viem"),
    import("viem"),
    import("viem/accounts"),
  ]);

  const account = accounts.privateKeyToAccount(privateKey);
  const signerAddress = account.address;
  const expectedWallet = normalizeAddress(input.walletAddress);
  if (expectedWallet && expectedWallet !== signerAddress.toLowerCase()) {
    throw new Error(`私钥地址 ${signerAddress} 与填写的钱包地址不一致`);
  }

  const { createPolygonHttpTransport, polygonChainForRpc } = await import("../wallet/polygonRpc");
  const signer = unified.signerFrom(viem.createWalletClient({
    account,
    chain: polygonChainForRpc(),
    transport: createPolygonHttpTransport(),
  }));
  const createL1Headers = async (): Promise<Record<string, string>> => {
    // L1 timestamp is validated by CLOB. Use its clock and generate a fresh
    // signature for each create/derive request, matching the official client.
    const timestamp = await fetchClobServerTime(gateway);
    // [changmen 扩展] Use the public unified Signer with the existing CLOB L1
    // payload. Its SDK payload helper is internal; do not create a SecureClient
    // here, which would take over credential fallback and wallet preparation.
    const signature = await signer.signTypedData({
      domain: { name: "ClobAuthDomain", version: "1", chainId: POLYGON_CHAIN_ID },
      types: { ClobAuth: [
        { name: "address", type: "address" },
        { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "message", type: "string" },
      ] },
      primaryType: "ClobAuth",
      message: {
        address: signerAddress,
        timestamp: String(timestamp),
        nonce: 0,
        message: "This message attests that I control the given wallet",
      },
    });
    return {
      POLY_ADDRESS: signerAddress,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: String(timestamp),
      POLY_NONCE: "0",
    };
  };

  let created: PolymarketApiCreds | undefined;
  try {
    created = normalizeApiCreds(
      await polymarketPluginPost<unknown>(`${gateway}/auth/api-key`, undefined, {
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
    await polymarketPluginGet<unknown>(`${gateway}/auth/derive-api-key`, {
      headers: await createL1Headers(),
    }),
  );
  if (!derived)
    throw new Error("Polymarket 未返回有效 API 凭证");
  return { signerAddress, apiCreds: derived };
}
