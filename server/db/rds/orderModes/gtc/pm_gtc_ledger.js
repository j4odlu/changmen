import { Currency, getExchange } from "@changmen/shared/currency";

const round4 = value => Math.round(value * 10000) / 10000;
const hasNumber = value => value != null && value !== "" && Number.isFinite(Number(value));

/** [changmen 扩展] 只使用原单含费成本与卖出现金，不把纸面盈亏再次累加。 */
export function gtcOrderLedger(order) {
  const raw = order.raw ?? {};
  if (!raw.pmGtcExecutionId || String(raw.pmSide).toLowerCase() === "sell") return;
  const shares = Number(raw.pmGtcBuyShares); const cost = Number(raw.pmGtcBuyCost);
  if (!hasNumber(raw.pmGtcBuyShares) || !hasNumber(raw.pmGtcBuyCost) || shares < 0 || cost < 0) return;
  const attr = Number(raw.pmAttributedSellShares) || 0;
  if (attr < 0 || attr > shares + 0.0101)
    throw new Error("GTC 卖出份数超过核实买入份数，请核对成交回滚");
  if (attr<=0.0001 && (Number(raw.pmSellProceeds)>0 || Math.abs(Number(raw.pmRealizedPnlUsdc)||0)>0.0001)) return;
  const sold = attr>0 && shares-attr<=0.01 ? shares : Math.min(shares, attr);
  const hasSale = sold > 0.0001 || ["partial", "closed"].includes(String(raw.pmSellState).toLowerCase());
  let proceeds = 0;
  if (hasSale) {
    if (!hasNumber(raw.pmSellProceeds) || Number(raw.pmSellProceeds) < 0) return;
    proceeds = Number(raw.pmSellProceeds);
    const events = mergeGtcSellEvents(raw)?.sells ?? [];
    const eventShares = events.reduce((sum, event) => sum + Number(event.shares), 0);
    if (events.length && Math.abs(eventShares - attr) <= 0.0101)
      proceeds = round4(events.reduce((sum, event) => sum + Number(event.proceeds), 0));
  }
  const allocated = shares > 0 ? round4(cost * (sold / shares)) : 0;
  const remainingCost = round4(Math.max(0, cost - allocated));
  const remaining = Math.max(0, shares - sold);
  const realized = round4(proceeds - allocated);
  const result = String(raw.pmMatchResult ?? order.status ?? "").toLowerCase();
  const settled = ["win", "lose", "lost"].includes(result);
  const payout = settled && result === "win" ? remaining : 0;
  const pnlUsdc = round4(realized + (settled ? payout - remainingCost : 0));
  const fx = getExchange(Currency.USDT);
  const money = round4(pnlUsdc * fx);
  // 结算/全部卖出直接核对总现金，避免逐次人民币取整或余仓重复结算。
  const finalMoney = settled || (hasSale && remaining <= 0.01)
    ? round4((proceeds + payout) * fx - Number(order.bet_money)) : money;
  const state = hasSale ? (remaining <= 0.01 ? "closed" : "partial") : raw.pmSellState;
  const events = mergeGtcSellEvents(raw);
  const positionEvents = events && shares > 0 ? { ...raw.positionEvents, sells: events.sells.map(event => ({ ...event,
    pnl: round4(Number(event.proceeds) - round4(cost * Number(event.shares) / shares)) })) } : undefined;
  return { money: shares === 0 && cost === 0 ? 0 : finalMoney,
    raw: { ...raw, money: shares === 0 && cost === 0 ? 0 : finalMoney,
      reward: round4((proceeds + payout) * fx), pmShares: shares, pmStakeUsdc: remainingCost,
      pmAttributedSellShares: sold, pmRealizedPnlUsdc: hasSale ? realized : 0,
      ...(hasSale ? { pmSellProceeds: proceeds } : {}),
      ...(settled ? { pmMatchResult: result === "win" ? "win" : "lose" } : {}),
      ...(positionEvents ? { positionEvents } : {}),
      ...(state ? { pmSellState: state } : {}),
    } };
}

/** 卖单 pmStakeUsdc 是摊销成本；回款取 bet_money，不能把成本误作现金。 */
export function gtcSellRowEvent(row) {
  const raw = row.raw ?? {};
  if (String(raw.pmSide).toLowerCase() !== "sell" || !row.order_id
    || !hasNumber(raw.pmShares) || Number(raw.pmShares) <= 0
    || !hasNumber(row.bet_money) || Number(row.bet_money) < 0) return;
  return { id: row.order_id, at: Number(row.create_at) || 0, shares: Number(raw.pmShares),
    proceeds: round4(Number(row.bet_money) / getExchange(Currency.USDT)), origin: "changmen" };
}

/** [changmen 扩展] 按卖单 ID 合并流水，迟到旧快照不能清掉新卖出或重复累计。 */
export function mergeGtcSellEvents(previous, incoming) {
  const events = new Map();
  for (const event of [...(previous?.positionEvents?.sells ?? []), ...(incoming?.positionEvents?.sells ?? [])]) {
    if (!event?.id || !hasNumber(event.shares) || !hasNumber(event.proceeds)
      || Number(event.shares) < 0 || Number(event.proceeds) < 0) continue;
    const key = String(event.id).toLowerCase(); const old = events.get(key);
    if (!old || Number(event.shares) >= Number(old.shares)) events.set(key, { ...old, ...event });
  }
  const sells = [...events.values()].sort((a,b) => Number(a.at) - Number(b.at));
  return sells.length ? { sells } : undefined;
}
