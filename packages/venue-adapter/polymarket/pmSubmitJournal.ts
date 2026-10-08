import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { hashTypedData, keccak256, toBytes } from "viem";
import { getContractConfig } from "@polymarket/clob-client-v2";
import { parseTokenConfig, resolveApiCreds, resolveFunder } from "./l2Auth";
import { useUserStore } from "../shared/webBridge";
import { resolvePmOrderSubmitHttpMode } from "./pmOrderSubmitMode";
import type { PolymarketOrderRow } from "./orderTypes";
import { isPmAmbiguousOrderError } from "@changmen/shared/pm_submit_response";

export interface PmRecoveredEvidence {
  row: PolymarketOrderRow | null;
  trade?: { size: string; price: string };
}

const PREFIX = "changmen:pm:submission:v1:";
export interface PmSubmitContext {
  version: 2 | 3; negRisk: boolean; parentBuyId?: string;
  validateBeforeDispatch?: () => void;
  /** [changmen 扩展] BUY 恢复普通失败/重试，仅保留发送期间互斥，不建立持久未知锁。SELL 不适用。 */
  buyFailurePolicy?: "retry";
  /** 仅业务恢复字段；不接受凭证或完整签名。 */
  recovery?: { matchId: string; venueBetId: string; itemId: string; target: string;
    betMoney: number; odds: number; linkId?: number; betRowId?: number; recoveryOnly?: boolean };
}
export interface PmSubmitAttempt {
  id: string; scope: string; accountId: number; orderHash: string; acceptedOrderId?: string;
  state: "dispatching" | "submit_unknown" | "accepted" | "terminal";
  submittedAt: number; side: "BUY" | "SELL"; tokenId: string;
  makerAmount: string; takerAmount: string; parentBuyId?: string;
  recovery?: PmSubmitContext["recovery"];
  evidence?: PmRecoveredEvidence;
}
const memory = new Map<string, PmSubmitAttempt>();
const flights = new Set<string>();

function hasReadyUserId(userId: unknown): boolean {
  if (typeof userId === "number") return Number.isFinite(userId) && userId > 0;
  if (typeof userId !== "string") return false;
  const id = userId.trim();
  // [changmen 扩展] RDS 用户 ID 为 UUID；兼容旧数值 ID，但不改变恢复记录的 scope 输入。
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || id !== "" && Number.isFinite(Number(id)) && Number(id) > 0;
}

function scopeFor(account: PlatformAccount): string {
  const config = parseTokenConfig(account.token);
  const creds = resolveApiCreds(config);
  let userId: unknown = 0;
  try { userId = useUserStore().userId; }
  catch { if (typeof window !== "undefined") throw new Error("PM 用户会话尚未准备好"); }
  if (typeof window !== "undefined" && !hasReadyUserId(userId)) throw new Error("PM 用户会话尚未准备好");
  return keccak256(toBytes(JSON.stringify([userId, account.accountId,
    String(account.gateway).replace(/\/+$/, ""), creds.address?.toLowerCase(),
    resolveFunder(config)?.toLowerCase()])));
}
export const pmSubmitScope = scopeFor;
export function pmSubmitMaker(account: PlatformAccount): string {
  const config = parseTokenConfig(account.token);
  return (resolveFunder(config) || resolveApiCreds(config).address || "").toLowerCase();
}
function save(row: PmSubmitAttempt): void {
  // 浏览器中持久化失败必须在发送前阻断；ACK 后失败保留原 dispatching 记录供恢复。
  if (typeof localStorage !== "undefined") {
    if (row.state === "terminal") localStorage.removeItem(PREFIX + row.id);
    else localStorage.setItem(PREFIX + row.id, JSON.stringify(row));
  }
  else if (typeof window !== "undefined") throw new Error("PM 无法保存提交恢复记录");
  if (row.state === "terminal") memory.delete(row.id);
  else memory.set(row.id, row);
}
function all(): PmSubmitAttempt[] {
  const rows = typeof localStorage !== "undefined" ? new Map<string, PmSubmitAttempt>() : new Map(memory);
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const row = JSON.parse(raw) as PmSubmitAttempt;
      if (!row.id || !row.scope || !/^0x[0-9a-f]{64}$/i.test(row.orderHash)
        || !["dispatching", "submit_unknown", "accepted", "terminal"].includes(row.state))
        throw new Error("PM 提交恢复记录损坏，请核对原单后处理");
      rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}
export function pmAccountSubmitAttempts(account: PlatformAccount): PmSubmitAttempt[] {
  const scope = scopeFor(account);
  return all().filter(row => row.scope === scope && row.state !== "terminal");
}
export function pmSubmitAttemptForOrder(account: PlatformAccount, id: string): PmSubmitAttempt | undefined {
  return pmAccountSubmitAttempts(account).find(row => row.orderHash === id || row.acceptedOrderId === id);
}
export function finishPmSubmitAttempt(account: PlatformAccount, id: string): void {
  const row = pmSubmitAttemptForOrder(account, id);
  if (row) save({ ...row, state: "terminal" });
}
export function acceptPmSubmitAttempt(account: PlatformAccount, id: string, acceptedOrderId: string, evidence?: PmRecoveredEvidence): void {
  const row = pmSubmitAttemptForOrder(account, id);
  if (row) save({ ...row, state: "accepted", acceptedOrderId, evidence: evidence ?? row.evidence });
}
export class PmSubmitUnknownError extends Error {
  constructor(public readonly attempt: PmSubmitAttempt) {
    super("PM 提交结果不确定（未确认是否送达），正在核对原单；请勿重复下单");
    this.name = "PmSubmitUnknownError";
  }
}

/** CLOB 的 Order 哈希，独立于 Deposit Wallet 的 ERC7739 签名包装。 */
export function pmSignedOrderHash(order: Record<string, any>, context: PmSubmitContext): string {
  const contracts = getContractConfig(137);
  const verifyingContract = context.version === 3 ? contracts.exchangeV3
    : context.negRisk ? contracts.negRiskExchangeV2 : contracts.exchangeV2;
  const fields = [
    ["salt", "uint256"], ["maker", "address"], ["signer", "address"], ["tokenId", "uint256"],
    ["makerAmount", "uint256"], ["takerAmount", "uint256"], ["side", "uint8"],
    ["signatureType", "uint8"], ["timestamp", "uint256"], ["metadata", "bytes32"], ["builder", "bytes32"],
  ].map(([name, type]) => ({ name: name!, type: type! }));
  return hashTypedData({ domain: { name: "Polymarket CTF Exchange", version: String(context.version),
    chainId: 137, verifyingContract: verifyingContract as `0x${string}` },
    types: { Order: fields }, primaryType: "Order",
    message: { ...order, side: order.side === "BUY" ? 0 : order.side === "SELL" ? 1 : order.side } });
}

/** [changmen 扩展] 持久化先于 POST；未知 BUY 和尚未完成归账的 SELL 按资产互斥。 */
export async function guardedPmSubmit<T>(account: PlatformAccount, body: unknown,
  context: PmSubmitContext, submit: () => Promise<T>): Promise<T> {
  const mode = resolvePmOrderSubmitHttpMode();
  const order = (body as { order: Record<string, any> }).order;
  const scope = scopeFor(account);
  const side = String(order.side).toUpperCase() as "BUY" | "SELL";
  if (side !== "BUY" && side !== "SELL") throw new Error("PM 下单方向无效");
  const tokenId = String(order.tokenId);
  const lockKey = `${scope}:${side}:${tokenId}`;
  const perform = async (): Promise<T> => {
    if (scopeFor(account) !== scope) throw new Error("PM 用户或钱包已改变，请重新预检");
    if (side === "BUY" && context.buyFailurePolicy === "retry") {
      if (resolvePmOrderSubmitHttpMode() !== mode) throw new Error("PM 下单方式已改变，请重新预检");
      context.validateBeforeDispatch?.();
      return submit();
    }
    const unresolved = all().find(row => row.scope === scope && row.side === side && row.tokenId === tokenId
      && (row.state === "dispatching" || row.state === "submit_unknown" || side === "SELL" && row.state === "accepted"));
    if (unresolved) {
      if (side === "BUY" && context.recovery) {
        const previous = unresolved.recovery;
        const current = context.recovery;
        if (!previous || (previous.linkId ?? 0) !== (current.linkId ?? 0)
          || previous.matchId !== current.matchId || previous.venueBetId !== current.venueBetId
          || previous.itemId !== current.itemId || previous.target !== current.target
          || previous.betMoney !== current.betMoney)
          throw new Error("PM 同资产的另一笔提交仍待确认，本次未发送");
      }
      throw new PmSubmitUnknownError(unresolved);
    }
    if (resolvePmOrderSubmitHttpMode() !== mode) throw new Error("PM 下单方式已改变，请重新预检");
    context.validateBeforeDispatch?.();
    const row: PmSubmitAttempt = { id: crypto.randomUUID(), scope, accountId: Number(account.accountId),
      orderHash: pmSignedOrderHash(order, context), state: "dispatching", submittedAt: Date.now(), side, tokenId,
      makerAmount: String(order.makerAmount), takerAmount: String(order.takerAmount),
      parentBuyId: context.parentBuyId, recovery: context.recovery };
    save(row);
    let result: T;
    try { result = await submit(); }
    catch { try { save({ ...row, state: "submit_unknown" }); } catch { /* dispatching 仍阻断重发 */ }
      throw new PmSubmitUnknownError(row); }
    const response = result as { success?: boolean; orderID?: string; errorMsg?: string; error?: string;
      status?: string; makingAmount?: string | number; takingAmount?: string | number } | null;
    if (response?.success === true && typeof response.orderID === "string" && response.orderID.trim()) {
      const shares = Number(side === "BUY" ? response.takingAmount : response.makingAmount);
      const notional = Number(side === "BUY" ? response.makingAmount : response.takingAmount);
      const evidence: PmRecoveredEvidence | undefined = String(response.status).toLowerCase() === "matched" && Number.isFinite(shares) && shares > 0
        ? { row: { id: response.orderID, status: "matched", size_matched: String(shares) },
          ...(Number.isFinite(notional) && notional > 0 ? { trade: { size: String(shares), price: String(notional / shares) } } : {}) } : undefined;
      try { save({ ...row, state: "accepted", acceptedOrderId: response.orderID, evidence }); }
      catch { /* 返回真实 ACK，持久化故障不得变成拒单 */ }
      return result;
    }
    if (response?.success === false && typeof response.errorMsg === "string" && response.errorMsg.trim() && !isPmAmbiguousOrderError(response.errorMsg)
      || typeof response?.error === "string" && response.error.trim().toLowerCase() === "trading is disabled") {
      try { save({ ...row, state: "terminal" }); } catch { /* fail closed */ }
      return result;
    }
    try { save({ ...row, state: "submit_unknown" }); } catch { /* fail closed */ }
    throw new PmSubmitUnknownError(row);
  };
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("pm-submit:" + lockKey, perform);
  // 真实浏览器必须提供跨标签页互斥；Node 单元测试只需进程内互斥。
  if (typeof window !== "undefined") throw new Error("浏览器不支持 PM 下单互斥，请使用支持 Web Locks 的浏览器");
  if (flights.has(lockKey)) throw new Error("PM 同资产提交正在进行，请等待原单结果");
  flights.add(lockKey);
  try { return await perform(); } finally { flights.delete(lockKey); }
}

export function clearPmSubmitJournalForTests(): void { memory.clear(); flights.clear(); }
