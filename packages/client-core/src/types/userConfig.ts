import type { PlatformId } from "@changmen/api-contract";

export type BetSorting = "Low" | "High" | "Parallel" | "WinRate" | "Custom";

/** 对齐 A8 bundle `D8` 用户参数（阶段 2 常用字段） */
export interface UserConfig {
  betting: boolean;
  bettingAutoOpen: boolean;
  bettingAutoOpenTime: number;
  betMoney: number;
  /** [changmen 扩展] 初始注码使用低赔腿金额或双腿合计金额；缺省为低赔腿。 */
  betMoneyMode?: "buy" | "total";
  minMoney: number;
  maxMoney: number;
  tenNumber: boolean;
  makeUp: boolean;
  makeUp_odds: number;
  makeUp_defaultOdds: number;
  makeProfit: number;
  noSameProvider: boolean;
  noSameBet: boolean;
  allowSameBet: PlatformId[];
  anyOdds: boolean;
  anyOddsProfit: number;
  betSorting: BetSorting;
  winRateValue: number;
  providerSortValue: PlatformId[];
  providerFixed: PlatformId[];
  profit: number;
  maxProfit: number;
  minOdds: number;
  maxOdds: number;
  betCount: number;
  betInterval: number;
  checkTimeout: number;
  betChecked: boolean;
  singleBet: boolean;
  waitTime: Record<string, number>;
  /**
   * [changmen 扩展] 正 EV（相对所选 sharp 基准）固定下注金额。
   * 点击金色角标确认下单时默认使用；不影响套利 betMoney。
   */
  valueBetMoney: number;
  /**
   * [changmen 扩展] 是否允许点击金色角标做正 EV 确认下单。
   * 默认 true；关闭后角标仅展示 edge%。
   */
  valueBetConfirm: boolean;
}
