import type { OrderRow } from "@/types/order";
import { getExchange } from "@/shared/currency";
import { isPmPendingOrder } from "@changmen/shared/pm_submission";

export type RiskLevel = "info" | "success" | "warning" | "danger";

export interface RiskTag {
  Name: string;
  level: RiskLevel;
}

export interface MoneyRiskLog {
  ID?: number;
  Type?: string;
  Money?: number;
  Currency?: string;
  Description?: string;
  IsAuto?: number;
  CreateAt?: number;
}

export interface MoneyRiskInput {
  MoneyLog: MoneyRiskLog[];
  Orders: OrderRow[];
  Balance: number;
}

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

function percent(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

/** 对齐 bundle `rDe.execute`（简化版，保留 6 条策略） */
export function executeMoneyRisk(data: MoneyRiskInput): RiskTag[] {
  const logs = [...data.MoneyLog].sort((a, b) => (b.CreateAt ?? 0) - (a.CreateAt ?? 0));
  const orders = data.Orders.filter(order => !isPmPendingOrder(order));
  const balance = data.Balance;

  const tags: RiskTag[] = [];

  // 充值流水倍数
  {
    const lastRecharge = logs.find(l => l.Type === "Recharge");
    let betMoney = 0;
    let times = 0;
    if (lastRecharge) {
      const since = lastRecharge.CreateAt ?? 0;
      for (const o of orders.filter(x => (x.CreateAt ?? 0) > since)) {
        betMoney += Math.min(Number(o.BetMoney) || 0, Math.abs(Number(o.Money) || 0));
      }
      const recharge
        = (Number(lastRecharge.Money) || 0) * getExchange(lastRecharge.Currency);
      times = recharge > 0 ? betMoney / recharge : 0;
    }
    let level: RiskLevel = "success";
    if (times < 1)
      level = "danger";
    else if (times < 2)
      level = "info";
    tags.push({
      Name: `充值（流水：${betMoney.toFixed(0)}，倍数：${times.toFixed(2)}倍）`,
      level,
    });
  }

  // 24H 提现
  {
    const since = Date.now() - 24 * 3600 * 1000;
    const withdraws = logs.filter(l => l.Type === "Withdraw" && (l.CreateAt ?? 0) > since);
    const money = sum(
      withdraws.map(l => (Number(l.Money) || 0) * getExchange(l.Currency)),
    );
    const times = withdraws.length;
    let level: RiskLevel = "success";
    if (money > 3000 || times >= 4)
      level = "danger";
    else if (money > 1000 || times >= 3)
      level = "warning";
    tags.push({
      Name: `24H提现（金额：${money.toFixed(0)}，次数：${times}次）`,
      level,
    });
  }

  // 充提比
  {
    const lastRecharge = logs.find(l => l.Type === "Recharge");
    const recharge = lastRecharge
      ? (Number(lastRecharge.Money) || 0) * getExchange(lastRecharge.Currency)
      : 0;
    const withdrawn
      = sum(
        logs
          .filter(
            l =>
              l.Type === "Withdraw" && (l.CreateAt ?? 0) > (lastRecharge?.CreateAt ?? 0),
          )
          .map(l => (Number(l.Money) || 0) * getExchange(l.Currency)),
      ) ?? 0;
    const ratio = recharge > 0 ? (withdrawn + balance) / recharge : 0;
    let level: RiskLevel = "info";
    if (ratio <= 1)
      level = "info";
    else if (ratio < 2)
      level = "success";
    else if (ratio < 3)
      level = "warning";
    else level = "danger";
    tags.push({
      Name: `充提比（充值：${recharge.toFixed(0)}，已提现：${withdrawn.toFixed(0)}，${ratio.toFixed(1)}倍）`,
      level,
    });
  }

  // 高盈利
  {
    const lastRecharge = logs.find(l => l.Type === "Recharge");
    const since = lastRecharge?.CreateAt ?? 0;
    const scoped = orders.filter(o => (o.CreateAt ?? 0) > since);
    const profit = sum(scoped.map(o => Number(o.Money) || 0));
    const betAmount = sum(
      scoped.map(o => Math.min(Math.abs(Number(o.Money) || 0), Number(o.BetMoney) || 0)),
    );
    const profitRate = betAmount > 0 ? profit / betAmount : 0;
    let level: RiskLevel = "info";
    if (profit > 2000 && profitRate > 0.8)
      level = "danger";
    else if (profit > 2000 || profitRate > 0.8)
      level = "warning";
    tags.push({
      Name: `高盈利（盈利：${profit.toFixed(0)}，盈利率：${percent(profitRate)}）`,
      level,
    });
  }

  // 拒单率
  {
    const total = orders.length;
    const windowMs = 24 * 3600 * 1000;
    const now = Date.now();
    const rejects = orders.filter(o => o.Status === "Reject");
    const r24 = rejects.filter(o => (o.CreateAt ?? 0) > now - windowMs).length / (total || 1);
    const r48
      = rejects.filter(o => (o.CreateAt ?? 0) > now - windowMs * 2).length / (total || 1);
    const r72
      = rejects.filter(o => (o.CreateAt ?? 0) > now - windowMs * 3).length / (total || 1);
    const max = Math.max(r24, r48, r72);
    let level: RiskLevel = "info";
    if (max === 0)
      level = "info";
    else if (max < 0.05)
      level = "success";
    else if (max < 0.1)
      level = "warning";
    else level = "danger";
    tags.push({
      Name: `拒单率（24H：${percent(r24)}，48H：${percent(r48)}，72H：${percent(r72)}）`,
      level,
    });
  }

  // 连续自动出款
  {
    let autoTimes = 0;
    for (const row of logs.filter(l => l.Type === "Withdraw")) {
      const isAuto
        = row.IsAuto === 1
          || (row.Description && /\d{1,2}sec|\d+s$/i.test(row.Description));
      if (!isAuto)
        break;
      autoTimes += 1;
    }
    tags.push({
      Name: `连续自动出款（${autoTimes}次）`,
      level: autoTimes === 0 ? "info" : "success",
    });
  }

  return tags;
}
