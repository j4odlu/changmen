/**
 * [changmen 扩展] value-bet EV 标记：在赔率格上标记正EV机会（金色）。
 *
 * 集成：BetRow.vue → useEvMarker + evMarker.css
 * 基准（PB / RAY / OB / PM）与阈值在用户中心「界面」Tab；软盘场馆在「扩展」Tab。
 * 点击金色 +x%（正 EV）→ 确认单边下单；双击赔率仍为手动下单。
 * 界面「EV 自动下注」开启后主循环扫描，条件满足则自动单边下单。
 * 成功后绑方案 B 负 Link（💎），侧栏按时间排序，与 9999 🏆 区分。
 */

import "@/extensions/valueBet/evMarker.css";

export { useEvMarker } from "@/extensions/valueBet/useEvMarker";
export {
  computeValueBetEdge,
  isValueBetPositiveEdge,
} from "@/extensions/valueBet/computeValueBetEdge";
export {
  VALUE_BET_SHARP_OPTIONS,
  valueBetCalcOptsFromPrefs,
} from "@/extensions/valueBet/evConfig";
export type { ValueBetSharpPlatform } from "@/extensions/valueBet/evConfig";
export {
  formatValueBetLabel,
  readValueBetMoney,
  resolveValueBetStake,
  valueBetSuggestedStake,
} from "@/extensions/valueBet/valueBetStake";
