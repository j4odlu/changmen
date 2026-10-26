import type { GtcOrderRecord, GtcOrderCommand, GtcOrderContext } from "./core/orderRecord";
import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import { applyGtcOrderCommand, createGtcOrderRecord } from "./core/orderRecord";
import { confirmedOrderResult, orderResultKey } from "./core/orderResult";
import { changed, clone, request, transaction } from "./storage";

/** [changmen 扩展] 同库同哈希索引；没有顶层 owner，旧客户端 owner 索引不会误读新格式。 */
interface StoredOrder { key: string; hashKey: string; order: GtcOrderRecord; sender?: string; resultKey?: string }
const senderId = crypto.randomUUID();
const prefix = (owner: string) => `${JSON.stringify(["order-v2", owner])}:`;
const key = (owner: string, id: string) => `${prefix(owner)}${id}`;
function stored(order: GtcOrderRecord, resultKey?: string, sender?: string): StoredOrder {
  return { key: key(order.owner, order.id), hashKey: JSON.stringify([order.owner, order.accountId, order.plan.orderHash.toLowerCase()]),
    order: clone(order), resultKey, sender };
}
export async function createStoredGtcOrder(id: string, owner: string, accountId: number, maker: string, plan: GtcOrderPlan, context: GtcOrderContext): Promise<GtcOrderRecord> {
  const created = createGtcOrderRecord(id, owner, accountId, maker, plan, context, Date.now());
  const value = stored(created);
  const row = await transaction(["records"], "readwrite", async tx => {
    const store = tx.objectStore("records");
    if (await request(store.get(value.key)) || await request(store.get(JSON.stringify([owner, id]))))
      throw new Error("GTC 原单身份已存在，禁止重新创建");
    if (await request(store.index("hash").get(value.hashKey))) throw new Error("GTC 原签单已有订单，禁止重复发送");
    await request(store.add(value)); return created;
  });
  changed(); return clone(row);
}
export async function listStoredGtcOrders(owner: string): Promise<GtcOrderRecord[]> {
  return transaction(["records"], "readonly", async tx => {
    const range = IDBKeyRange.bound(prefix(owner), `${prefix(owner)}\uffff`);
    const values = await request(tx.objectStore("records").getAll(range)) as StoredOrder[];
    return values.filter(value => value.order?.formatVersion === 2 && value.order.owner === owner).map(value => value.order);
  });
}
export async function mutateStoredGtcOrder(owner: string, id: string, revision: number, command: GtcOrderCommand): Promise<GtcOrderRecord> {
  const row = await transaction(["records", "results"], "readwrite", async tx => {
    const store = tx.objectStore("records");
    const prior = await request(store.get(key(owner, id))) as StoredOrder | undefined;
    if (!prior?.order || prior.order.owner !== owner) throw new Error("GTC 原单不存在或归属无效，禁止重发");
    if (prior.order.revision !== revision) throw new Error("GTC 原单版本已更新，请重新读取；禁止重放许可");
    if (command.kind === "receipt" && command.receipt.pmSubmitNotSent && prior.sender !== senderId)
      throw new Error("当前页面没有原单发送许可，不能改写发送结果");
    const next = applyGtcOrderCommand(prior.order, command);
    const result = confirmedOrderResult(next);
    const fingerprint = result ? orderResultKey(result) : prior.resultKey;
    if (result && fingerprint !== prior.resultKey) {
      const resultKey = JSON.stringify([owner, id]);
      await request(tx.objectStore("results").put({ key: resultKey, owner, result, at: 0, failures: 0 }));
    }
    await request(store.put(stored(next, fingerprint, command.kind === "authorize" ? senderId : prior.sender)));
    return next;
  });
  changed(); return clone(row);
}
