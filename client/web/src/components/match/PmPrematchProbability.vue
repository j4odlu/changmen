<script setup lang="ts">
import type { ViewBet, ViewMatch } from "@/models/match";
import { formatOrderTime } from "@changmen/client-core/shared/format";
import { lookupPmMapIdentityByToken, lookupPmMapOutcomeByToken, pmMapOutcomeTick } from "@changmen/venue-adapter/polymarket";
import { computed } from "vue";
import { readPrematchProbability } from "@/shared/pmPrematchProbability";
import { isPmMapFinished, readPmMapRoundScore } from "@/shared/pmSportDisplay";
import { readPmScoreMapOutcome, type PmScoreMapOutcome } from "@/shared/pmScoreMapOutcome";

const props = defineProps<{ bet: ViewBet; match: ViewMatch }>();
const pm = computed(() => props.bet.items.find(item => item.type === "Polymarket"));
const result = computed(() => readPrematchProbability(pm.value?.homeId ?? "", pm.value?.awayId ?? "", props.match.pmPrematch));
const value = computed(() => result.value.status === "ready" ? result.value.value : null);
const roundScore = computed(() => readPmMapRoundScore(
  props.match.pmSport, props.bet.round, props.match.reverse?.includes("Polymarket") ?? false,
));
function cellLabel(side: "home" | "away"): string {
  const name = side === "home" ? props.bet.homeName : props.bet.awayName;
  const probability = value.value ? `${value.value[side].toFixed(1)}%` : status.value;
  const score = roundScore.value ? `局内比分${roundScore.value[side]}，赛前` : "";
  const won = side === "home" ? homeWon.value : awayWon.value;
  return `${name}：${score}${probability}${won ? `，${officialWinner.value ? 'WIN' : '比分确认胜出，PM 待结算'}` : ''}`;
}
/** [changmen 扩展] 胜者按 token 对齐比赛卡，避免 PM 原始主客方向与合场方向相反。 */
const outcome = computed(() => {
  void pmMapOutcomeTick.value;
  return lookupPmMapOutcomeByToken(pm.value?.homeId) ?? lookupPmMapOutcomeByToken(pm.value?.awayId);
});
const officialWinner = computed(() => !outcome.value?.winningTokenId ? null
  : outcome.value.winningTokenId === pm.value?.homeId ? "home"
  : outcome.value.winningTokenId === pm.value?.awayId ? "away" : null);
const scoreOutcome = computed<PmScoreMapOutcome | null>(previous => {
  void pmMapOutcomeTick.value;
  return readPmScoreMapOutcome({
    snapshot: props.match.pmSport,
    eventKey: String(props.match.providers?.Polymarket ?? props.match.id ?? ""),
    map: props.bet.round, homeName: props.bet.homeName, awayName: props.bet.awayName,
    homeTokenId: pm.value?.homeId ?? "", awayTokenId: pm.value?.awayId ?? "",
    market: lookupPmMapIdentityByToken(pm.value?.homeId),
  }, previous);
});
const winner = computed(() => officialWinner.value ?? scoreOutcome.value?.side);
const homeWon = computed(() => winner.value === "home");
const awayWon = computed(() => winner.value === "away");
const winLabel = computed(() => officialWinner.value ? "WIN" : "胜 · 待结算");
const awaitingSettlement = computed(() => !winner.value && isPmMapFinished(props.match.pmSport, props.bet.round));
const outcomeDetail = computed(() => winner.value
  ? `${homeWon.value ? props.bet.homeName : props.bet.awayName} · ${officialWinner.value ? 'PM 官方胜负' : '比分确认胜出，等待 PM 官方结算'}`
  : undefined);
const status = computed(() => {
  switch (result.value.status) {
    case "waiting": return "等待 VPS 历史价";
    case "pending": return "等待登记开赛时间";
    case "missing": return "暂无历史数据";
    case "error": return "VPS 查询失败，稍后重试";
    default: return "";
  }
});

/** [changmen 扩展] 临时采用登记时间口径，不标作实际清单前最后价。 */
const detail = computed(() => value.value
  ? `C · ${props.bet.getBetName()} · PM 登记开赛时间前价格，非实际清单确认价。取价截止：${formatOrderTime(value.value.cutoff)}；${props.bet.homeName}记录：${formatOrderTime(value.value.homeTime)}；${props.bet.awayName}记录：${formatOrderTime(value.value.awayTime)}；采样窗口 ${value.value.resolution} 秒。`
  : `C · ${props.bet.getBetName()} · ${status.value}；VPS 按 PM 登记开赛时间前 1 秒查询并保存该盘口历史价格。`);
</script>

<template>
  <div v-if="pm" class="item flex pm-prematch" :title="detail" @dblclick.stop>
    <div class="item-type pm-prematch-badge" :aria-label="roundScore ? 'C：PM 局内比分及登记开赛时间前胜率' : 'C：PM 登记开赛时间前胜率'">
      C
      <span v-if="awaitingSettlement" class="pm-settlement-pending" title="该地图或全场已打完，等待 PM 官方胜方确认">待结算</span>
    </div>
    <div class="item-odds home" :class="{ 'pm-map-won': homeWon, 'pm-map-lost': awayWon, 'pm-prematch-live-score': roundScore }" :title="roundScore ? 'PM 实时主队局内比分' : homeWon ? outcomeDetail : undefined" :aria-label="cellLabel('home')">
      <span v-if="homeWon" class="pm-map-win-badge">{{ winLabel }}</span>
      <span v-if="roundScore" class="pm-round-score">{{ roundScore.home }}</span>
      <span :class="{ 'pm-round-probability': roundScore }">{{ value ? `${value.home.toFixed(1)}%` : "—" }}</span>
    </div>
    <div class="item-odds away" :class="{ 'pm-map-won': awayWon, 'pm-map-lost': homeWon, 'pm-prematch-live-score': roundScore }" :title="roundScore ? 'PM 实时客队局内比分' : awayWon ? outcomeDetail : undefined" :aria-label="cellLabel('away')">
      <span v-if="awayWon" class="pm-map-win-badge">{{ winLabel }}</span>
      <span v-if="roundScore" class="pm-round-score">{{ roundScore.away }}</span>
      <span :class="{ 'pm-round-probability': roundScore }">{{ value ? `${value.away.toFixed(1)}%` : "—" }}</span>
    </div>
  </div>
</template>

<style scoped>
.matchs .bet .bet-items .pm-prematch.item .pm-prematch-badge {
  position: relative;
}
.matchs .bet .bet-items .pm-prematch.item .pm-settlement-pending {
  position: absolute;
  left: 50%;
  top: -3px;
  transform: translate(-50%, -100%);
  padding: 0 3px;
  border-radius: 3px;
  font-size: 9px;
  line-height: 13px;
  white-space: nowrap;
  color: var(--cm-color-warning, #e6a23c);
  background: var(--cm-bg, #202329);
}
.matchs .bet .bet-items .pm-prematch.item .item-odds {
  /* 沿用赔率格和当前主题背景，仅用主题强调色区分赛前参考值。 */
  color: var(--cm-color-warning, #e6a23c);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.matchs .bet .bet-items .pm-prematch.item .item-type.pm-prematch-badge {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  /* 与场馆徽标共用 24px 圆形、底色和间距。 */
  border-color: var(--cm-color-warning, #e6a23c);
  color: var(--cm-color-warning, #e6a23c);
  font-size: 12px;
  font-weight: 600;
}
/* [changmen 扩展] C 行左右格分别显示本队比分，概率作为同格的小字参考。 */
.matchs .bet .bet-items .pm-prematch.item .item-odds.pm-prematch-live-score {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.matchs .bet .bet-items .pm-prematch.item .pm-round-score {
  font-size: 15px;
  font-weight: 700;
}
.matchs .bet .bet-items .pm-prematch.item .pm-round-probability {
  font-size: 10px;
  font-weight: 400;
  opacity: .75;
}
</style>
