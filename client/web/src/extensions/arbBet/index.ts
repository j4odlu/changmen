/**
 * changmen 相对 A8 的「套利检测 + 自动下单」扩展（集中入口）。
 *
 * A8 对齐路径（核心逻辑，勿在 extensions 外加增强行为）：
 * - 主循环 `matchStore.runMainLoopTick` → `GetOrderOptions`（内部 `getProviders()`）→ `executeArbBet`
 * - BetRow 标题：各行最高主/客赔 implied（bundle HomeView `c(bet)`）
 *
 * 本模块职责：
 * | 能力 | A8 | changmen |
 * |------|-----|----------|
 * | 比例 9999 单边下注 | 缺任一侧账号则 `continue` | 本侧可选预检（扩展页开关）、不自动下单；对侧真下单 + 负 `linkId` |
 * | 9999 用正EV金额 | 无 | `singleLeg9999UseValueBetMoney`：真下单腿改用 `valueBetMoney`（预检腿不动） |
 * | 9999 C 行方向 | 无 | `singleLeg9999HigherCProbabilityOnly`：真下单腿仅允许当前盘口 C 行赛前概率较高的一方 |
 * | 高利润加仓 | 无 | `stakeScaleByProfit`：implied 达阈值时两腿注码同乘；可选忽略账号比例 |
 * | 失败敞口减仓 | 无 | `arbFailAutoSell`：对侧拒单且未补单时自动卖 PM/PF 成交腿 |
 * | 提前锁利 | 无 | `arbEarlyLockSell`：仅双边 PM/PF，同卖净利优于锁定时两边一起卖 |
 * | 补单上下沿 | `makeProfit` 单边地板 | `makeupOddsBand`：默认关；开则按赔率系数或总体利润率替代消费/anyOdds 门槛 |
 * | Telegram | 仅成功推单等（见 messageStore） | 同左 + 可选套利进度报告（`extensions/notify`） |
 * | BetRow 红线 / flash | 无 / bundle 内联 | `extensions/arbBet/ui` |
 *
 * 集成点：
 * - `mainBetLoop` → `runArbBetRound` → `executeArbBet`
 * - `executeArbBet` → `resolveSingleLegByRate` / `allowArbBetExecution` / `createArbLinkId`
 * - `BetRow.vue` → `useBetRowArbUi` + `ArbLineOverlay`
 */

export {
  allowArbBetExecution,
  arbAccountPickerFilter,
  createArbLinkId,
  explainAllowArbRejection,
  explainArbAccountRejection,
  findSingleLegRateAccount,
  isSingleLegRateAtOdds,
  legHasSingleLegRateAccount,
  resolveSingleLegByRate,
  SINGLE_LEG_RATE,
} from "@/domain/betting/singleLegRate";

export {
  ArbLineOverlay,
  useArbLineOverlay,
  useBetRowArbUi,
  useOddsAnchorMap,
  useOddsFlashCell,
} from "@/extensions/arbBet/ui";

export {
  applyStakeScaleByProfit,
  shouldScaleStakeByProfit,
  shouldSkipAccountRateOnStakeScale,
} from "@/extensions/arbBet/stakeScaleByProfit";

export {
  applyValueBetMoneyTo9999LiveLeg,
  resolve9999LiveSide,
} from "@/extensions/arbBet/singleLeg9999Stake";

export {
  decideArbFailAutoSell,
  isArbFailAutoSellEnabled,
  maybeArbFailAutoSellAfterFinalize,
  maybeArbFailAutoSellByLink,
} from "@/extensions/arbBet/arbFailAutoSell";

export {
  decideArbEarlyLockSell,
  isArbEarlyLockSellEnabled,
  runArbEarlyLockSellTick,
} from "@/extensions/arbBet/arbEarlyLockSell";

export {
  filterMakeupOddsBandCandidates,
  isMakeupOddsBandEnabled,
  makeupDisplayOdds,
  previewMakeupOddsBand,
  resolveMakeupOddsBandBounds,
} from "@/extensions/arbBet/makeupOddsBand";
