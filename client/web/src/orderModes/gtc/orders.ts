import type { BetOption } from "@changmen/client-core/models/betOption";
import type { GtcOrderRecord } from "./core/orderRecord";
import { clone } from "./storage";
import { useAccountStore } from "@/stores/accountStore";
import type { PlatformAccount } from "@/models/platformAccount";
import type { GtcOrderReceipt, PreparedGtcOrder } from "./core/orderService";
import { watch } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { submitPreparedGtcOrder } from "./core/orderService";
import { createGtcOrder, changeGtcOrder, closeGtcOrderSubmission, currentGtcOrder, pollGtcOrder, cancelNativeGtcOrder, startNativeGtcOrders } from "./orderRuntime";
import { gtcOrders } from "./orderState";
import type { GtcOrderContext } from "./core/orderRecord";
export type { GtcOrderContext } from "./core/orderRecord";

export type { PreparedGtcOrder, GtcOrderReceipt } from "./core/orderService";
export type GtcOrderSnapshot = GtcOrderRecord;
const preparations = new WeakMap<PreparedGtcOrder, {
  account: PlatformAccount;
  owner: string;
  session: ReturnType<typeof getAuthSessionVersion>;
  started: boolean;
}>();

/** 接收已完成账号预检的订单选项；业务筛选仍由入口决定。 */
export async function prepareGtcOrder(account: PlatformAccount, option: BetOption): Promise<PreparedGtcOrder> {
  const user = useUserStore(); const owner = String(user.userId); const session = getAuthSessionVersion();
  if (!user.isLoggedIn || !user.userId || account.provider !== "Polymarket" || option.type !== "Polymarket")
    throw new Error("请登录后使用 PM GTC");
  const { prepareManualGtcBuy } = await import("@changmen/venue-browser/adapter/polymarket/gtc");
  const prepared = Object.freeze({ ...await prepareManualGtcBuy(account, option), tokenId: option.itemId, conditionId: option.betId });
  if (!isAuthSessionCurrent(session) || String(user.userId) !== owner)
    throw new Error("用户会话已变更，禁止继续发送 GTC");
  preparations.set(prepared, { account, owner, session, started: false });
  return prepared;
}

export async function submitGtcOrder(account: PlatformAccount, prepared: PreparedGtcOrder, context: GtcOrderContext = {},
  onReceipt?: (receipt: GtcOrderReceipt, submittedAt: number) => void): Promise<GtcOrderSnapshot> {
  const user = useUserStore(); const owner = String(user.userId); const session = getAuthSessionVersion();
  if (!user.isLoggedIn || !user.userId || account.provider !== "Polymarket")
    throw new Error("请登录后使用 PM GTC");
  const assertSession = () => {
    if (!isAuthSessionCurrent(session) || String(user.userId) !== owner)
      throw new Error("用户会话已变更，禁止继续发送 GTC");
  };
  const binding = preparations.get(prepared);
  if (!binding || binding.account !== account || binding.owner !== owner || !isAuthSessionCurrent(binding.session))
    throw new Error("GTC 签单不属于当前账号或会话，请重新准备订单");
  if (binding.started)
    throw new Error("GTC 签单已进入发送流程，禁止重复提交");
  binding.started = true;
  const { pmSubmitMaker } = await import("@changmen/venue-browser/adapter/polymarket/gtc");
  assertSession(); startNativeGtcOrders(owner); assertSession();
  const accounts = useAccountStore();
  const registered = accounts.findAccount(Number(account.accountId));
  if (!registered || registered.provider !== "Polymarket" || accounts.adminWorkspacePreview
    || pmSubmitMaker(registered).toLowerCase() !== pmSubmitMaker(account).toLowerCase())
    throw new Error("GTC 原 PM 账号归属或钱包身份无效");
  const maker = pmSubmitMaker(account);
  if (!/^0x[0-9a-f]{40}$/i.test(maker)) throw new Error("GTC 原 PM 钱包身份无效");
  const id = await submitPreparedGtcOrder(prepared, {
    assertSession,
    async create(plan) {
      const row = await createGtcOrder(crypto.randomUUID(), Number(account.accountId), maker, plan, context);
      return row.id;
    },
    async authorize(id) { await changeGtcOrder(id, { kind: "authorize" }); },
    async acknowledge(id, receipt) { await changeGtcOrder(id, { kind: "receipt", receipt }); },
    async recordUnknown(id, message) { await changeGtcOrder(id, { kind: "unknown", message }); },
    close: closeGtcOrderSubmission,
    async refresh(id) { await pollGtcOrder(id); },
    onReceipt,
  });
  assertSession();
  return clone(currentGtcOrder(id));
}

export function getGtcOrder(id: string): GtcOrderSnapshot | undefined {
  const user = useUserStore();
  if (!user.isLoggedIn || !user.userId) return undefined;
  const row = gtcOrders.records.find(row => row.id === id && row.owner === String(user.userId));
  return row ? clone(row) : undefined;
}
/** 读取同一张原单；不会重新创建或提交订单。 */
export async function refreshGtcOrder(id: string): Promise<GtcOrderSnapshot> {
  const session = getAuthSessionVersion();
  if (!getGtcOrder(id)) throw new Error("GTC 订单不属于当前会话或尚未恢复");
  await pollGtcOrder(id);
  const order = getGtcOrder(id);
  if (!isAuthSessionCurrent(session) || !order) throw new Error("用户会话已变更，订单查询结果不再展示");
  return order;
}
export async function cancelGtcOrder(id: string): Promise<GtcOrderSnapshot> {
  const session = getAuthSessionVersion();
  if (!getGtcOrder(id)) throw new Error("GTC 订单不属于当前会话或尚未恢复");
  await cancelNativeGtcOrder(id);
  const order = getGtcOrder(id);
  if (!isAuthSessionCurrent(session) || !order) throw new Error("用户会话已变更，撤单结果需在原会话核对");
  return order;
}
export function subscribeGtcOrder(id: string, listener: (order: GtcOrderSnapshot | undefined) => void): () => void {
  return watch(() => getGtcOrder(id), listener, { deep: true, immediate: true });
}
