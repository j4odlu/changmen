<script setup lang="ts">
import type { ViewMatch } from "@/models/match";
import BetRow from "@/components/match/BetRow.vue";
import RayBasketballSpreads from "@/components/match/RayBasketballSpreads.vue";
import { formatDate } from "@changmen/client-core/shared/format";
import {
  getGameDisplayName,
  getGameSport,
  resolveGameCode,
} from "@changmen/shared/catalog/game_catalog.browser";
import {
  formatPmMatchStatus,
  formatResolutionSourceLabel,
  normalizeResolutionSourceHref,
} from "@/shared/pmSportDisplay";
import {
  lookupResolutionSourceBySourceMatchId,
  pmMapOutcomeTick,
} from "@changmen/venue-browser/adapter/polymarket";
import { computed } from "vue";

/** 原电竞使用 Polymarket 侧栏 SVG；篮球使用自有球形徽标，未知/联赛仍走文字标签。 */
const ESPORT_GAME_ICONS: Record<string, string> = {
  cs2: "/assets/games/cs2.svg",
  lol: "/assets/games/lol.svg",
  dota2: "/assets/games/dota2.svg",
  valorant: "/assets/games/valorant.svg",
  kog: "/assets/games/kog.svg",
  basketball: "/assets/games/basketball.svg",
};

/** 默认 true：电竞 HomeView 不传时必须允许下注。
 * Vue 对 `boolean` 缺省会铸成 false；若无 default，中转 `:allow-betting` 会把电竞一并锁死。 */
const props = withDefaults(
  defineProps<{
    match: ViewMatch;
    /** 仅体育板传入；电竞不传（见 SportMatchBoard） */
    oddsDisplayTick?: number;
    /** 体育只读：false；电竞默认 true */
    allowBetting?: boolean;
  }>(),
  { allowBetting: true },
);

/** catalog code → 中文名；电竞 DTO 已是中文名时原样 */
const gameTag = computed(() => getGameDisplayName(props.match.game || ""));

const gameCode = computed(() => resolveGameCode(props.match.game || ""));

/** 电竞且有图标资源 → 图标；足球/棒球联赛等仍用 [中文名] */
const gameIconSrc = computed(() => {
  const code = gameCode.value;
  if (!code || getGameSport(code) !== "esport")
    return null;
  return ESPORT_GAME_ICONS[code] || null;
});

/** Gamma resolutionSource（经 MarketIndex）；Index 未命中时回退 pm_sport 上的同字段（Gamma 合并写入，非 Sports 比分） */
const resolutionSource = computed(() => {
  void pmMapOutcomeTick.value;
  const fromIndex = lookupResolutionSourceBySourceMatchId(props.match.providers?.Polymarket);
  if (fromIndex)
    return fromIndex;
  const fromPmSport = String(props.match.pmSport?.resolutionSource ?? "").trim();
  return fromPmSport || null;
});

const resolutionLabel = computed(() => formatResolutionSourceLabel(resolutionSource.value || undefined));
const resolutionHref = computed(() => normalizeResolutionSourceHref(resolutionSource.value || undefined));

const pmMatchStatus = computed(() => props.match.pmSport || props.match.providers?.Polymarket
  ? formatPmMatchStatus(props.match.pmSport)
  : null);
</script>

<template>
  <div class="match">
    <div class="match-title">
      <img
        v-if="gameIconSrc"
        class="game-icon"
        :src="gameIconSrc"
        :alt="gameTag"
        :title="gameTag"
        width="18"
        height="18"
      >
      <label v-else-if="gameTag" class="game-tag">[{{ gameTag }}]</label>
      <label v-html="match.title" />
      <label class="startTime">{{ formatDate(match.startAt) }}</label>
      <span
        v-if="pmMatchStatus"
        class="pm-match-status"
        :class="`pm-match-status--${pmMatchStatus.kind}`"
        title="PM 实时赛况；比分按标题左右队伍排列，地图阶段沿用 PM 编号"
      >PM · {{ pmMatchStatus.label }}</span>
      <span v-if="resolutionLabel && resolutionHref" class="pm-sport">
        <a
          class="pm-sport-link"
          :href="resolutionHref"
          target="_blank"
          rel="noopener noreferrer"
        >{{ resolutionLabel }}</a>
      </span>
    </div>
    <div class="bets flex flex-wrap">
      <template v-for="bet in match.bets" :key="bet.id">
        <BetRow
          :match="match"
          :bet="bet"
          :odds-display-tick="oddsDisplayTick"
          :allow-betting="allowBetting"
        />
        <RayBasketballSpreads
          v-if="gameCode === 'basketball' && match.providers.RAY && bet.round === 0 && !bet.marketCode"
          :match="match" :home-name="bet.homeName" :away-name="bet.awayName"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.pm-match-status {
  margin-left: 10px;
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  color: var(--cm-color-warning, #e6a23c);
  font-size: 12px;
  line-height: 18px;
  white-space: normal;
}
.pm-match-status--live {
  color: var(--cm-color-success, #67c23a);
}
.pm-match-status--canceled {
  color: var(--cm-color-danger, #f56c6c);
}
.pm-match-status--finished,
.pm-match-status--unknown {
  color: inherit;
}
</style>
