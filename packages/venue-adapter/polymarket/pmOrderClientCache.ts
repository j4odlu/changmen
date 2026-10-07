import type { Hex } from "viem";
import type { PolymarketTokenConfig, resolveApiCreds } from "./l2Auth";
import { resolveFunder } from "./l2Auth";
import { resolvePolymarketBuilderCode } from "./builder";

export interface PolymarketOrderClientRuntime {
  builder: InstanceType<typeof import("@polymarket/clob-client-v2").OrderBuilder>;
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
const flights = new Map<string, Promise<PolymarketOrderClientRuntimeResult>>();
let generation = 0;
export function polymarketSigningGeneration(): number { return generation; }

function runtimeKey(input: PolymarketOrderClientInput, builderCode: string): string {
  return JSON.stringify([
    String(input.gateway || "").replace(/\/+$/, ""),
    String(input.creds.address || "").toLowerCase(),
    String(input.creds.apiKey || ""),
    String(input.creds.secret || ""),
    String(input.creds.passphrase || ""),
    String(input.signatureType),
    String(resolveFunder(input.config) || "").toLowerCase(),
    builderCode,
    input.privateKey,
  ]);
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
  const pending = flights.get(key);
  if (pending) return pending;
  const startedGeneration = generation;
  const task = (async (): Promise<PolymarketOrderClientRuntimeResult> => {
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
    if (account.address.toLowerCase() !== String(input.creds.address).toLowerCase())
      throw new Error("PM 私钥与 walletAddress 不匹配");
    const signer = viem.createWalletClient({
      account,
      chain: polygonChainForRpc(),
      transport: createPolygonHttpTransport(),
    });
    const builder = new clob.OrderBuilder(signer, clob.Chain.POLYGON,
      input.signatureType as any, resolveFunder(input.config) || undefined);
    if (startedGeneration !== generation) throw new Error("钱包会话已失效");
    const runtime = { builder, clob, builderCode };
    rememberRuntime(key, runtime);
    return { runtime, cacheHit: false };
  })();
  flights.set(key, task);
  try { return await task; }
  finally { if (flights.get(key) === task) flights.delete(key); }
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
  generation++;
  flights.clear();
  runtimes.clear();
}

/** [changmen 扩展] 主动锁定/会话到期同时销毁持钥 signer 缓存。 */
export const clearPolymarketOrderClientCache = clearPolymarketOrderClientCacheForTests;
