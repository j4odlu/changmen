import type { Hex } from "viem";
import type { PolymarketTokenConfig } from "../../auth/l2Auth";
import { parseTokenConfig, resolveApiCreds, resolvePrivateKey, resolveFunder } from "../../auth/l2Auth";
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

const runtimes = new Map<string, PolymarketOrderClientRuntime>();
const flights = new Map<string, { task: Promise<PolymarketOrderClientRuntimeResult>; token: object }>();
let generation = 0;
let clearedGeneration = 0;
const runtimeGenerations = new Map<string, number>();
const accountSessions = new Map<string, { key: string | null; generation: number }>();

/** [changmen 扩展] 只记录撤销/账号变更；正常创建 signer 不得掩盖预检期间的会话失效。 */
export function polymarketSigningSessionGeneration(account: SigningAccount): number {
  return Math.max(clearedGeneration, account.accountId == null ? 0 : accountSessions.get(String(account.accountId))?.generation ?? 0);
}

/** [changmen 扩展] 账号撤销独立计龄；整页锁定仍使全部账号的旧预检失效。 */
export function polymarketSigningGeneration(account: SigningAccount): number {
  let runtimeGeneration = 0;
  try {
    runtimeGeneration = runtimeGenerations.get(runtimeKey(accountInput(account), resolvePolymarketBuilderCode())) ?? 0;
  } catch { /* 仅预检腿允许没有签名凭据。 */ }
  const accountGeneration = account.accountId == null ? 0 : accountSessions.get(String(account.accountId))?.generation ?? 0;
  return Math.max(clearedGeneration, accountGeneration, runtimeGeneration);
}

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
  runtimeGenerations.set(key, ++generation);
}

/** [changmen 扩展] 仅账号加载/钱包解锁生命周期可创建 signer。 */
export async function preparePolymarketOrderClientRuntime(
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
  if (pending) return pending.task;
  const token = {};
  const task: Promise<PolymarketOrderClientRuntimeResult> = (async () => {
    const [
      clob,
      viem,
      accounts,
    ] = await Promise.all([
      import("@polymarket/clob-client-v2"),
      import("viem"),
      import("viem/accounts"),
    ]);
    const { createPolygonHttpTransport, polygonChainForRpc } = await import("../../wallet/polygonRpc");
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
    if (flights.get(key)?.token !== token) throw new Error("钱包会话已失效");
    const runtime = { builder, clob, builderCode };
    rememberRuntime(key, runtime);
    return { runtime, cacheHit: false };
  })();
  flights.set(key, { task, token });
  try { return await task; }
  finally { if (flights.get(key)?.token === token) flights.delete(key); }
}

/** [changmen 扩展] 交易路径只读；不等待在途初始化，也不兜底创建。 */
export function getPolymarketOrderClientRuntime(input: PolymarketOrderClientInput): PolymarketOrderClientRuntimeResult {
  const runtime = runtimes.get(runtimeKey(input, resolvePolymarketBuilderCode()));
  if (!runtime) throw new Error("PM 钱包签名器未就绪，请在账号页重新加载账号或解锁钱包");
  return { runtime, cacheHit: true };
}

interface SigningAccount { accountId?: number | string; provider?: string; token?: string; gateway?: string }

function accountInput(account: SigningAccount): PolymarketOrderClientInput {
  const config = parseTokenConfig(account.token);
  const creds = resolveApiCreds(config);
  const privateKey = resolvePrivateKey(config);
  if (!privateKey || !creds.address || !creds.apiKey || !creds.secret || !creds.passphrase)
    throw new Error("PM 钱包或 API 凭据未就绪");
  const signatureType = Number(creds.signatureType ?? 0);
  return { gateway: account.gateway || "https://clob.polymarket.com", config, creds, privateKey,
    signatureType: [1, 2, 3].includes(signatureType) ? signatureType : 0 };
}

/** [changmen 扩展] 同步撤销不再属于当前账号列表的 signer；不创建或等待初始化。 */
export function retainPolymarketAccountRuntimes(accounts: readonly SigningAccount[]): void {
  const allowed = new Set<string>();
  const current = new Map<string, string | null>();
  for (const account of accounts) {
    if (account.provider !== "Polymarket") continue;
    let key: string | null = null;
    try {
      key = runtimeKey(accountInput(account), resolvePolymarketBuilderCode());
      allowed.add(key);
    }
    catch { /* 未解锁或无效凭据不能保留旧 signer。 */ }
    if (account.accountId != null) current.set(String(account.accountId), key);
  }
  for (const id of new Set([...accountSessions.keys(), ...current.keys()])) {
    const key = current.get(id) ?? null;
    if (accountSessions.get(id)?.key !== key)
      accountSessions.set(id, { key, generation: ++generation });
  }
  for (const key of new Set([...runtimes.keys(), ...flights.keys()])) {
    if (allowed.has(key)) continue;
    runtimes.delete(key);
    flights.delete(key);
    runtimeGenerations.delete(key);
  }
}

/** [changmen 扩展] 按签名凭据同步完整账号列表，保留未变化账号（包括在途初始化）。 */
export async function preparePolymarketAccountRuntimes(accounts: readonly SigningAccount[]) {
  retainPolymarketAccountRuntimes(accounts);
  return Promise.allSettled(accounts.filter(account => account.provider === "Polymarket")
    .map(async account => preparePolymarketOrderClientRuntime(accountInput(account))));
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
  clearedGeneration = ++generation;
  flights.clear();
  runtimes.clear();
  runtimeGenerations.clear();
  accountSessions.clear();
}

/** [changmen 扩展] 主动锁定/会话到期同时销毁持钥 signer 缓存。 */
export const clearPolymarketOrderClientCache = clearPolymarketOrderClientCacheForTests;
