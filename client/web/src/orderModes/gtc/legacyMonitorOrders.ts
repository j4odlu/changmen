/** [changmen 扩展] 旧后端兼容只读：按认证端持久化身份核对原单，不写普通订单或改变选号。 */
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";

type Read = (action: string, body: Record<string, unknown>) => Promise<unknown>;
const fail = () => new Error("旧后端 GTC 监控恢复证据不完整，请重试核对原单");
const key = (player: unknown, provider: unknown, id: unknown) => JSON.stringify([Number(player), provider, String(id).toLowerCase()]);

export function validateMonitorIds(ids: string[]): void {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
    throw fail();
}

export async function readLegacyGtcMonitorOrders(ids: string[], read: Read): Promise<OrderRow[]> {
  validateMonitorIds(ids);
  if (!ids.length)
    return [];
  // 不接收前端计划作为归属证据；每次读取当前登录用户的持久化执行。
  const records = await read("Pm_GtcList", {});
  if (!Array.isArray(records))
    throw fail();
  const wanted = new Set(ids);
  const selected = records.filter((row: GtcExecution) => wanted.has(row?.id)) as GtcExecution[];
  if (new Set(selected.map(row => row.id)).size !== selected.length
    || new Set(selected.map(row => row.owner)).size > 1)
    throw fail();
  const anchors = new Map<string, Set<string>>();
  const dates = new Set<string>();
  for (const row of selected) {
    if (!row.owner || !row.plan || !row.other)
      throw fail();
    const link = Math.abs(Number(row.plan.linkId));
    const home = link >= 7_000_000_000_000_000 ? link - 7_000_000_000_000_000 : link;
    // 原单按开弓 Link 日归属；无时间戳 Link 时按成交时间。相邻 UTC 日覆盖服务端日历时区。
    for (const time of [home >= 1_000_000_000_000 ? home : row.createdAt, row.createdAt, row.other.submittedAt || row.createdAt]) {
      if (!Number.isFinite(time) || time < 1_000_000_000_000 || time > 8_640_000_000_000_000 - 86400000)
        throw fail();
      for (const delta of [-86400000, 0, 86400000])
        dates.add(new Date(time + delta).toISOString().slice(0, 10));
    }
    for (const [player, provider, id] of [
      [row.plan.playerId, "Polymarket", row.orderId || row.plan.orderHash],
      [row.plan.otherPlayerId, row.plan.otherProvider, row.other.orderId],
    ] as const) {
      if (!id)
        continue;
      if (!Number.isSafeInteger(Number(player)) || Number(player) <= 0 || !provider)
        throw fail();
      const anchor = key(player, provider, id);
      const identities = anchors.get(anchor) ?? new Set<string>();
      identities.add(row.id); anchors.set(anchor, identities);
    }
  }
  const result = new Map<string, OrderRow>();
  for (const date of [...dates].sort()) {
    // 旧接口 total 是当前页长度，不能用 total/短页宣布结束；一直读到空页。
    let ended = false;
    for (let pageIndex = 1; pageIndex <= 100; pageIndex++) {
      const page = await read("Pm_GtcOrders", { date, pageIndex, pageSize: 5000 }) as { list?: OrderRow[]; pageIndex?: number; pageSize?: number };
      if (!page || !Array.isArray(page.list) || page.pageIndex !== pageIndex || page.pageSize !== 5000)
        throw fail();
      if (!page.list.length) { ended = true; break; }
      // 同 Link / 买卖 sibling 的合组会让相邻原始页返回相同展示行，不能据此判定分页失败。
      // pageIndex/pageSize 和总请求上限仍严格检查；只有空页才结束，不接受无限重复页。
      for (const order of page.list) {
        if (!order || order.PmSide === "sell" || order.PfSide === "sell")
          continue;
        const anchor = key(order.PlayerID, order.Type, order.OrderID);
        const matching = anchors.get(anchor);
        if (!matching)
          continue;
        const identity = order.PmGtcExecutionId;
        if (identity ? !matching.has(identity) : matching.size !== 1)
          throw fail();
        const row = { ...order, PmGtcExecutionId: identity ?? [...matching][0] };
        const previous = result.get(anchor);
        if (previous && JSON.stringify(previous) !== JSON.stringify(row))
          throw fail();
        result.set(anchor, row);
      }
    }
    if (!ended)
      throw fail();
  }
  // 旧执行保存了完整成交财务时，同一事务已写入原买单；日期接口找不到不能当作“恢复成功”。
  // 人工跨日改绑会使真实 Link 与计划 Link 不同，旧后端没有 exact-id 读能力，保持同步失败。
  for (const row of selected) {
    if (Number(row.financialOrder?.pmShares) > 0
      && !result.has(key(row.plan.playerId, "Polymarket", row.orderId || row.plan.orderHash)))
      throw new Error("旧后端未能核实 GTC 原单财务记录，请核对跨日期改绑并使用支持原单身份查询的后端");
  }
  // 空结果只是没有财务证据，不能据此声明成交/结算/撤单或重发。
  return [...result.values()];
}
