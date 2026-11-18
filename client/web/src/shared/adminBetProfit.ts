import type { BetProfitAccountRow, BetProfitProviderRow } from "@/api/admin";

/** 按稳定 user_id 汇总；同名用户、同名子账号互不合并。 */
export function userBetProfit(rows: BetProfitAccountRow[]) {
  const groups = new Map<string, BetProfitAccountRow[]>();
  for (const row of rows) {
    const group = groups.get(row.user_id) ?? [];
    group.push(row);
    groups.set(row.user_id, group);
  }
  return [...groups].map(([user_id, accounts]) => ({
    ...sumBetProfitRows(accounts),
    user_id,
    user_name: accounts[0].user_name || user_id,
    account_count: accounts.filter(row => row.player_id != null).length,
  })).sort((a, b) => b.total_profit - a.total_profit || a.user_id.localeCompare(b.user_id));
}

/** 同一币种的服务端聚合可相加；收益率须从汇总本金重新计算。 */
export function sumBetProfitRows(rows: BetProfitProviderRow[]): BetProfitProviderRow {
  const total: BetProfitProviderRow = {
    provider: "", total_orders: 0, wins: 0, losses: 0, rejects: 0, returns: 0,
    pending: 0, total_bet: 0, total_profit: 0, settled_orders: 0,
    settled_bet: 0, settled_profit: 0, pending_bet: 0, avg_odds: 0,
  };
  let oddsSum = 0;
  for (const row of rows) {
    total.total_orders += row.total_orders;
    total.wins += row.wins;
    total.losses += row.losses;
    total.rejects += row.rejects;
    total.returns += row.returns;
    total.pending += row.pending;
    total.total_bet += row.total_bet;
    total.total_profit += row.total_profit;
    total.settled_orders += row.settled_orders;
    total.settled_bet += row.settled_bet;
    total.settled_profit += row.settled_profit;
    total.pending_bet += row.pending_bet;
    oddsSum += (row.avg_odds || 0) * row.total_orders;
  }
  total.avg_odds = total.total_orders ? oddsSum / total.total_orders : 0;
  return total;
}

export function settledRoi(row: Pick<BetProfitProviderRow, "settled_bet" | "settled_profit">): number | null {
  return row.settled_bet > 0 ? row.settled_profit / row.settled_bet * 100 : null;
}

export function dailyBetProfit(rows: (BetProfitProviderRow & { day: string })[], provider = "") {
  const groups = new Map<string, BetProfitProviderRow[]>();
  for (const row of rows) {
    if (provider && row.provider !== provider)
      continue;
    const group = groups.get(row.day) ?? [];
    group.push(row);
    groups.set(row.day, group);
  }
  let cumulativeProfit = 0;
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([day, group]) => {
    const total = sumBetProfitRows(group);
    cumulativeProfit += total.total_profit;
    return { ...total, day, cumulative_profit: cumulativeProfit };
  });
}
