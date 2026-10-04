import type { Hex } from "viem";
import type { PolymarketTokenConfig, resolveApiCreds } from "./l2Auth";
import { resolveFunder } from "./l2Auth";
import { resolvePolymarketBuilderCode } from "./builder";

interface PolymarketOrderClientRuntime {
  client: any;
  clob: typeof import("@polymarket/clob-client-v2");
  builderCode: string;
}

export interface PolymarketOrderClientInput {
  gateway: string;
  privateKey: Hex;
  creds: ReturnType<typeof resolveApiCreds>;
  config: PolymarketTokenConfig;
  signatureType: number;
}

export interface PolymarketOrderClientRuntimeResult {
  runtime: PolymarketOrderClientRuntime;
  cacheHit: boolean;
}

const MAX_CLIENTS = 8;
const runtimes = new Map<string, PolymarketOrderClientRuntime>();

function shortFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function runtimeKey(input: PolymarketOrderClientInput, builderCode: string): string {
  return [
    String(input.gateway || "").replace(/\/+$/, ""),
    String(input.creds.address || "").toLowerCase(),
    shortFingerprint(String(input.creds.apiKey || "")),
    shortFingerprint(String(input.creds.secret || "")),
    shortFingerprint(String(input.creds.passphrase || "")),
    String(input.signatureType),
    String(resolveFunder(input.config) || "").toLowerCase(),
    builderCode,
    shortFingerprint(input.privateKey),
  ].join("|");
}

function rememberRuntime(key: string, runtime: PolymarketOrderClientRuntime): void {
  runtimes.set(key, runtime);
  if (runtimes.size <= MAX_CLIENTS)
    return;
  const oldest = runtimes.keys().next().value;
  if (oldest)
    runtimes.delete(oldest);
}

export async function getPolymarketOrderClientRuntime(
  input: PolymarketOrderClientInput,
): Promise<PolymarketOrderClientRuntimeResult> {
  const builderCode = resolvePolymarketBuilderCode();
  const key = runtimeKey(input, builderCode);
  const cached = runtimes.get(key);
  if (cached) {
    runtimes.delete(key);
    runtimes.set(key, cached);
    return { runtime: cached, cacheHit: true };
  }

  const [
    clob,
    viem,
    accounts,
  ] = await Promise.all([
    import("@polymarket/clob-client-v2"),
    import("viem"),
    import("viem/accounts"),
  ]);
  const { createPolygonHttpTransport, polygonChainForRpc } = await import("./polygonRpc");
  const account = accounts.privateKeyToAccount(input.privateKey);
  const signer = viem.createWalletClient({
    account,
    chain: polygonChainForRpc(),
    transport: createPolygonHttpTransport(),
  });
  const client = new clob.ClobClient({
    host: input.gateway,
    chain: clob.Chain.POLYGON,
    signer,
    creds: {
      key: input.creds.apiKey!,
      secret: input.creds.secret!,
      passphrase: input.creds.passphrase!,
    },
    signatureType: input.signatureType as any,
    funderAddress: resolveFunder(input.config) || undefined,
    builderConfig: { builderCode },
  });
  Reflect.set(client, "cachedVersion", 2);
  const runtime = { client, clob, builderCode };
  rememberRuntime(key, runtime);
  return { runtime, cacheHit: false };
}

export function hasPolymarketOrderClientRuntime(input: PolymarketOrderClientInput): boolean {
  try {
    const builderCode = resolvePolymarketBuilderCode();
    return runtimes.has(runtimeKey(input, builderCode));
  }
  catch {
    return false;
  }
}

export function clearPolymarketOrderClientCacheForTests(): void {
  runtimes.clear();
}

/** [changmen 扩展] 主动锁定/会话到期同时销毁持钥 signer 缓存。 */
export const clearPolymarketOrderClientCache = clearPolymarketOrderClientCacheForTests;
