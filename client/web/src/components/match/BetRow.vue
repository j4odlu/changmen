<script setup lang="ts">
import type { BetSide, ViewBet, ViewMatch } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import { computed, onUnmounted, ref, watch } from "vue";
import LimitDiagDialog from "@/components/match/LimitDiagDialog.vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import PmPrematchProbability from "@/components/match/PmPrematchProbability.vue";
import { useBetRowExtensionUiEnabled } from "@/composables/useExtensionPrefs";
import { useUserStore } from "@/stores/userStore";
import { storeToRefs } from "pinia";
import { ArbLineOverlay, useBetRowArbUi } from "@/extensions/arbBet/ui";
import {
  canFoldMap,
  clearMapMute,
  isMapMuteActive,
  mapBetMuteFullMatchGlobal,
  mapBetMuteGlobal,
  mapBetMuteGlobalOpenKeys,
  mapBetMuteKeys,
  toggleMapMute,
} from "@/extensions/mapBetMute";
import { useEvMarker } from "@/extensions/valueBet";
import { arbPercent, formatSecond, percent, toFixed } from "@changmen/client-core/shared/format";
import { useCreateLoseDialogStore } from "@/stores/createLoseDialogStore";
import { useMatchStore } from "@/stores/matchStore";
import { useOddsStore } from "@/stores/oddsStore";
import {
  getPbWsShadowRevision,
  isPbWsShadowUiAllowed,
  resolvePbWsShadow,
  subscribePbWsShadow,
} from "@changmen/venue-adapter/pb";

/** allowBetting 须 withDefaults(true)：裸 `?: boolean` 缺省会被 Vue 铸成 false，电竞双击会静默失效 */
const props = withDefaults(
  defineProps<{
    match: ViewMatch;
    bet: ViewBet;
    /**
     * [changmen 扩展] 体育板传入：实时价只改 fallback / sportOddsStore，不写 fo。
     * 电竞路径不传；BetRow 不 import sportOddsStore，保持壳共用、store 隔离。
     */
    oddsDisplayTick?: number;
    /**
     * [changmen 扩展] 棒/足只读板：禁双击下单 / EV / 补单 / 点选 target，避免误走电竞 manualBet。
     * 电竞默认 true。
     */
    allowBetting?: boolean;
  }>(),
  { allowBetting: true },
);

const BET_SIDES: BetSide[] = ["Home", "Away"];

const muteKeysRef = mapBetMuteKeys();
const muteGlobalRef = mapBetMuteGlobal();
const muteFullMatchGlobalRef = mapBetMuteFullMatchGlobal();
const muteGlobalOpenRef = mapBetMuteGlobalOpenKeys();

const oddsStore = useOddsStore();
const matchStore = useMatchStore();

const createLoseDialog = useCreateLoseDialogStore();

const limitOpen = ref(false);
const limitProvider = ref<PlatformId>();
const limitItemIds = ref<string[]>([]);

const betRowUiEnabled = useBetRowExtensionUiEnabled();
const { pbWsShadowUi, pbChangmenExtensions, extensionPrefs } = storeToRefs(useUserStore());
/** 影子旁显：跟 ingest 同一道门（globalThis / localStorage），Pinia 只负责触发重算 */
const pbWsShadowUiEnabled = computed(() => {
  void pbChangmenExtensions.value;
  void pbWsShadowUi.value;
  return isPbWsShadowUiAllowed();
});

const showLiveTimer = computed(() => {
  const lr = props.match.liveRound;
  return lr !== 0 && lr === props.bet.round;
});

/** [changmen 扩展] 全场与各地图非 live 可折叠；live 与折叠按钮互斥 */
const canFold = computed(() => canFoldMap(props.bet.round) && !showLiveTimer.value);
const mapMuted = computed(() => {
  void muteKeysRef.value;
  void muteGlobalRef.value;
  void muteFullMatchGlobalRef.value;
  void muteGlobalOpenRef.value;
  return isMapMuteActive(props.match.id, props.bet.round, props.match.liveRound);
});
const bettingEnabled = computed(() => props.allowBetting && !mapMuted.value);

function onToggleMapMute(e: MouseEvent) {
  e.stopPropagation();
  if (!canFold.value || (props.bet.round === 0 && muteFullMatchGlobalRef.value))
    return;
  toggleMapMute(props.match.id, props.bet.round);
}

/** 体育只读板关掉扩展交互暗示（红线/EV），避免看起来能下单 */
const extensionsEnabled = computed(() => betRowUiEnabled.value && bettingEnabled.value);

const arbUi = useBetRowArbUi(() => props.match, () => props.bet, extensionsEnabled);
const {
  itemsContainerRef,
  line: arbLine,
  badge: arbBadge,
  overlayLabel,
  isArbLeg,
  bindOddsAnchor,
  oddsCellClasses,
  sourceLabel,
} = arbUi;

const evMarker = useEvMarker(() => props.bet, extensionsEnabled);

const oddsByItemKey = computed(() => {
  void props.oddsDisplayTick;
  void extensionPrefs.value.pmArbPriceBuffer.enabled;
  void extensionPrefs.value.pmArbPriceBuffer.multiplier;
  void extensionPrefs.value.pfArbPriceBuffer.enabled;
  void extensionPrefs.value.pfArbPriceBuffer.multiplier;
  // 电竞：MQTT/WS 只写 fo；靠 Pinia reactive Map 按 oddId 追踪 getOdds（勿用全局 foRevision 扇出）
  const out = new Map<string, { home: number; away: number }>();
  for (const item of props.bet.items) {
    out.set(`${item.type}:${item.betId}`, {
      home: oddsStore.getOdds(item.type, item.homeId, item.fallbackHomeOdds),
      away: oddsStore.getOdds(item.type, item.awayId, item.fallbackAwayOdds),
    });
  }
  return out;
});

const limitByItemKey = computed(() => {
  const out = new Map<string, boolean>();
  for (const item of props.bet.items) {
    out.set(
      `${item.type}:${item.betId}`,
      oddsStore.hasLimit(item.type, [item.homeId, item.awayId]),
    );
  }
  return out;
});

function itemHasLimit(item: ViewBet["items"][0]): boolean {
  return limitByItemKey.value.get(`${item.type}:${item.betId}`) ?? false;
}

function itemOdds(item: ViewBet["items"][0], side: BetSide) {
  const row = oddsByItemKey.value.get(`${item.type}:${item.betId}`);
  if (!row)
    return 0;
  return side === "Home" ? row.home : row.away;
}

/** [changmen 扩展] PB WS 影子价旁显；可点选 target / 双击按旁显价下限手动下单；不写 fo */
const pbWsShadowTick = ref(0);
let unsubPbWsShadow: (() => void) | undefined;
let pbWsShadowPollTimer: ReturnType<typeof setInterval> | null = null;

function stopPbWsShadowWatch() {
  unsubPbWsShadow?.();
  unsubPbWsShadow = undefined;
  if (pbWsShadowPollTimer) {
    clearInterval(pbWsShadowPollTimer);
    pbWsShadowPollTimer = null;
  }
}

function startPbWsShadowWatch() {
  stopPbWsShadowWatch();
  pbWsShadowTick.value = getPbWsShadowRevision();
  unsubPbWsShadow = subscribePbWsShadow(() => {
    pbWsShadowTick.value = getPbWsShadowRevision();
  });
  pbWsShadowPollTimer = setInterval(() => {
    const rev = getPbWsShadowRevision();
    if (rev !== pbWsShadowTick.value)
      pbWsShadowTick.value = rev;
  }, 200);
}

watch(
  pbWsShadowUiEnabled,
  (on) => {
    if (on)
      startPbWsShadowWatch();
    else
      stopPbWsShadowWatch();
  },
  { immediate: true },
);

onUnmounted(() => {
  stopPbWsShadowWatch();
});

/** 影子验准开且 PB：旁显只显示一个价，前缀 H=HTTP / M=WS 标来源（主价数字不变） */
function pbSourceSplitActive(item: ViewBet["items"][0]): boolean {
  return pbWsShadowUiEnabled.value && item.type === "PB";
}

/**
 * 影子旁显：只显示官网源（M）。主价数字零改动；不用 fo 打 H 底。
 */
function pbShadowLabel(item: ViewBet["items"][0], side: BetSide): string | undefined {
  if (!pbSourceSplitActive(item))
    return undefined;
  void pbWsShadowTick.value;
  const oddId = side === "Home" ? item.homeId : item.awayId;
  const shadow = resolvePbWsShadow({
    oddId,
    matchId: item.matchId,
    map: props.bet.round,
  });
  if (!shadow || shadow.source !== "M" || shadow.isLock || !(shadow.odds > 0))
    return undefined;
  const raw = (shadow.text && String(shadow.text).trim()) || toFixed(shadow.odds, 3, "round");
  return `M${raw}`;
}

/** 旁显 CSS：H/M 区分来源；蓝下划线表示可点 */
function pbShadowClass(item: ViewBet["items"][0], side: BetSide): Record<string, boolean> {
  if (!pbSourceSplitActive(item)) return {};
  void pbWsShadowTick.value;
  const oddId = side === "Home" ? item.homeId : item.awayId;
  const shadow = resolvePbWsShadow({ oddId, matchId: item.matchId, map: props.bet.round });
  const src = shadow?.source;
  return {
    "pb-ws-shadow--m": src === "M",
    "pb-ws-shadow--diff": pbWsShadowDiffers(item, side),
  };
}

function pbWsShadowEntry(item: ViewBet["items"][0], side: BetSide) {
  const oddId = side === "Home" ? item.homeId : item.awayId;
  return resolvePbWsShadow({ oddId, matchId: item.matchId, map: props.bet.round });
}

function pbShadowOddId(item: ViewBet["items"][0], side: BetSide): string {
  return side === "Home" ? item.homeId : item.awayId;
}

function pbShadowSrcAttr(item: ViewBet["items"][0], side: BetSide): string | undefined {
  if (!pbSourceSplitActive(item)) return undefined;
  void pbWsShadowTick.value;
  return pbWsShadowEntry(item, side)?.source;
}

/** 单击影子价：选 target（与主格同路径） */
function onPbShadowClick(item: ViewBet["items"][0], side: BetSide, e: MouseEvent) {
  e.stopPropagation();
  onTarget(item.type, side);
}

/** 双击影子价：打开手动下单（主价/fo 路径不变；旁显只负责同步官网展示） */
function onPbShadowDblClick(item: ViewBet["items"][0], side: BetSide, e: MouseEvent) {
  e.stopPropagation();
  if (!bettingEnabled.value)
    return;
  void matchStore.manualBet(props.match, props.bet, item, side);
}

function pbWsShadowDiffers(item: ViewBet["items"][0], side: BetSide): boolean {
  if (!pbSourceSplitActive(item))
    return false;
  void pbWsShadowTick.value;
  const oddId = side === "Home" ? item.homeId : item.awayId;
  const shadow = resolvePbWsShadow({
    oddId,
    matchId: item.matchId,
    map: props.bet.round,
  });
  if (!shadow || shadow.source !== "M" || shadow.isLock || !(shadow.odds > 0))
    return false;
  const main = itemOdds(item, side);
  if (!(main > 0))
    return true;
  return Math.abs(main - shadow.odds) >= 0.001;
}

/** [A8 可证实] HomeView 内联 `c(bet)`：各行最高主/客赔 implied，无红线/可下单标签 */
const arb = computed(() => {
  let bestHome = 0;
  let bestAway = 0;
  for (const item of props.bet.items) {
    const h = itemOdds(item, "Home");
    const a = itemOdds(item, "Away");
    if (h > bestHome)
      bestHome = h;
    if (a > bestAway)
      bestAway = a;
  }
  return arbPercent(bestHome, bestAway);
});

/**
 * [changmen 扩展] 直播秒数只在本行 tick，避免全表订阅全局计时代际。
 * A8 Home 无全局 Vue tick，计时靠主循环顺带重绘。
 */
const liveClockTick = ref(0);
let liveClockTimer: ReturnType<typeof setInterval> | null = null;

function stopLocalLiveClock() {
  if (liveClockTimer) {
    clearInterval(liveClockTimer);
    liveClockTimer = null;
  }
}

function startLocalLiveClock() {
  stopLocalLiveClock();
  liveClockTick.value += 1;
  liveClockTimer = setInterval(() => {
    liveClockTick.value += 1;
  }, 1000);
}

watch(showLiveTimer, (on) => {
  if (on) {
    startLocalLiveClock();
    // live 与折叠互斥：进入 live 时清掉该局 mute
    clearMapMute(props.match.id, props.bet.round);
  }
  else {
    stopLocalLiveClock();
  }
}, { immediate: true });

onUnmounted(stopLocalLiveClock);

const liveSeconds = computed(() => {
  void liveClockTick.value;
  if (!showLiveTimer.value)
    return 0;
  const rs = props.match.liveRoundStart;
  const start = rs > 0 ? rs : props.bet.startTime ?? Date.now();
  return (Date.now() - start) / 1000;
});

function defaultOddsValue(betId: number, side: BetSide): number {
  void matchStore.defaultOdds;
  const fromStore = matchStore.getDefaultOdds(betId, side);
  if (fromStore > 0)
    return fromStore;
  return side === "Home" ? props.bet.initialHomeOdds : props.bet.initialAwayOdds;
}

const showDefaultOdds = computed(() => {
  return (
    defaultOddsValue(props.bet.id, "Home") > 0 || defaultOddsValue(props.bet.id, "Away") > 0
  );
});

function defaultOddsPercent(betId: number, side: BetSide): string | undefined {
  const home = defaultOddsValue(betId, "Home");
  const away = defaultOddsValue(betId, "Away");
  if (!home || !away)
    return undefined;
  const implied = 1 / (1 / home + 1 / away);
  const line = defaultOddsValue(betId, side);
  if (!line)
    return undefined;
  return percent(implied / line, 0);
}

function defaultOddsHigh(betId: number, side: BetSide): boolean {
  const v = defaultOddsValue(betId, side);
  return v > 2;
}

function defaultOddsLabel(betId: number, side: BetSide): string {
  const odds = toFixed(defaultOddsValue(betId, side), 3, "round");
  const pct = defaultOddsPercent(betId, side);
  return pct ? `${odds} / ${pct}` : odds;
}

function onTarget(platform: ViewBet["items"][0]["type"], side: BetSide) {
  if (!bettingEnabled.value)
    return;
  void matchStore.setBetTarget(platform, props.bet.id, side);
}

function openLimit(item: ViewBet["items"][0]) {
  if (!bettingEnabled.value)
    return;
  limitProvider.value = item.type;
  limitItemIds.value = [item.homeId, item.awayId];
  limitOpen.value = true;
}

function onOddsDblClick(item: ViewBet["items"][0], side: BetSide) {
  if (!bettingEnabled.value)
    return;
  void matchStore.manualBet(props.match, props.bet, item, side);
}

function onEvBadgeClick(item: ViewBet["items"][0], side: BetSide, e: MouseEvent) {
  e.stopPropagation();
  if (!bettingEnabled.value)
    return;
  if (!evMarker.isPositiveEv(item, side))
    return;
  void matchStore.valueBetConfirm(props.match, props.bet, item, side);
}

/** [A8 可证实] HomeView `v(match,bet)`：双击 bet-title 打开单例 CreateLoseView */
function onBetTitleDblClick() {
  if (!bettingEnabled.value)
    return;
  createLoseDialog.show(props.match, props.bet);
}
</script>

<template>
  <div class="bet" :class="{ 'is-map-muted': mapMuted }">
    <el-tag
      v-if="showLiveTimer"
      class="live"
      type="warning"
      size="small"
      effect="dark"
      round
      :disable-transitions="true"
    >
      {{ formatSecond(liveSeconds) }}
    </el-tag>
    <button
      v-if="canFold"
      type="button"
      class="map-mute-toggle"
      :disabled="bet.round === 0 && muteFullMatchGlobalRef"
      :title="bet.round === 0 && muteFullMatchGlobalRef
        ? '已由全场胜负总开关关闭'
        : mapMuted ? '展开并允许下注' : '折叠并禁止下注'"
      :aria-pressed="mapMuted"
      @click="onToggleMapMute"
    >
      {{ bet.round === 0 && muteFullMatchGlobalRef ? "总关" : mapMuted ? "开" : "关" }}
    </button>
    <div class="bet-title" @dblclick="onBetTitleDblClick">
      {{ bet.getBetName() }} - {{ arb }}
    </div>
    <div v-show="!mapMuted" ref="itemsContainerRef" class="bet-items">
      <PmPrematchProbability v-if="!bet.marketCode && bet.round >= 0" :bet="bet" :match="match" />
      <div v-if="showDefaultOdds" class="item flex defaultOdds">
        <div class="item-type default" />
        <div
          v-for="side in BET_SIDES"
          :key="side"
          class="item-odds"
          :class="[side.toLowerCase(), { high: defaultOddsHigh(bet.id, side) }]"
        >
          {{ defaultOddsLabel(bet.id, side) }}
        </div>
      </div>

      <div v-for="item in bet.items" :key="item.type + item.betId" class="item flex">
        <PlatformIcon
          class="item-type"
          :platform="item.type"
          :limit="itemHasLimit(item)"
          @click="openLimit(item)"
        />
        <div
          :ref="bindOddsAnchor(item.type, 'Home')"
          class="item-odds home"
          :data-pb-home-id="item.type === 'PB' ? item.homeId : undefined"
          :class="{
            'lock': !itemOdds(item, 'Home'),
            'target': matchStore.getBetTarget(item.type, bet.id) === 'Home',
            'arb-leg': isArbLeg(item, 'Home'),
            ...oddsCellClasses(item, 'Home'),
            'ev-positive': evMarker.isPositiveEv(item, 'Home'),
            'ev-near': evMarker.isNearEv(item, 'Home'),
          }"
          @click="onTarget(item.type, 'Home')"
          @dblclick.stop="onOddsDblClick(item, 'Home')"
        >
          {{ itemOdds(item, "Home") || ""
          }}<span
            v-if="pbShadowLabel(item, 'Home')"
            class="pb-ws-shadow"
            :class="pbShadowClass(item, 'Home')"
            :data-odd-id="pbShadowOddId(item, 'Home')"
            :data-shadow-src="pbShadowSrcAttr(item, 'Home')"
            title="影子=官网 WS / 页内euro（不做DOM）。无源不显示。主价不动。单击选边；双击走主价下单"
            @click="onPbShadowClick(item, 'Home', $event)"
            @dblclick="onPbShadowDblClick(item, 'Home', $event)"
          >{{ pbShadowLabel(item, "Home") }}</span><span
            v-if="evMarker.evLabel(item, 'Home')"
            class="ev-badge"
            :class="{ 'ev-badge--action': evMarker.isPositiveEv(item, 'Home') }"
            :title="evMarker.isPositiveEv(item, 'Home') ? '点击确认正 EV 下单' : undefined"
            @click="onEvBadgeClick(item, 'Home', $event)"
            @dblclick.stop
          >{{
            evMarker.evLabel(item, "Home")
          }}</span><span v-if="sourceLabel(item, 'Home')" class="odds-src">{{
            sourceLabel(item, "Home")
          }}</span>
        </div>
        <div
          :ref="bindOddsAnchor(item.type, 'Away')"
          class="item-odds away"
          :data-pb-home-id="item.type === 'PB' ? item.awayId : undefined"
          :class="{
            'lock': !itemOdds(item, 'Away'),
            'target': matchStore.getBetTarget(item.type, bet.id) === 'Away',
            'arb-leg': isArbLeg(item, 'Away'),
            ...oddsCellClasses(item, 'Away'),
            'ev-positive': evMarker.isPositiveEv(item, 'Away'),
            'ev-near': evMarker.isNearEv(item, 'Away'),
          }"
          @click="onTarget(item.type, 'Away')"
          @dblclick.stop="onOddsDblClick(item, 'Away')"
        >
          {{ itemOdds(item, "Away") || ""
          }}<span
            v-if="pbShadowLabel(item, 'Away')"
            class="pb-ws-shadow"
            :class="pbShadowClass(item, 'Away')"
            :data-odd-id="pbShadowOddId(item, 'Away')"
            :data-shadow-src="pbShadowSrcAttr(item, 'Away')"
            title="影子=官网 WS / 页内euro（不做DOM）。无源不显示。主价不动。单击选边；双击走主价下单"
            @click="onPbShadowClick(item, 'Away', $event)"
            @dblclick="onPbShadowDblClick(item, 'Away', $event)"
          >{{ pbShadowLabel(item, "Away") }}</span><span
            v-if="evMarker.evLabel(item, 'Away')"
            class="ev-badge"
            :class="{ 'ev-badge--action': evMarker.isPositiveEv(item, 'Away') }"
            :title="evMarker.isPositiveEv(item, 'Away') ? '点击确认正 EV 下单' : undefined"
            @click="onEvBadgeClick(item, 'Away', $event)"
            @dblclick.stop
          >{{
            evMarker.evLabel(item, "Away")
          }}</span><span v-if="sourceLabel(item, 'Away')" class="odds-src">{{
            sourceLabel(item, "Away")
          }}</span>
        </div>
      </div>
      <ArbLineOverlay
        v-if="extensionsEnabled"
        :line="arbLine"
        :badge="arbBadge"
        :label="overlayLabel"
      />
    </div>

    <LimitDiagDialog
      :open="limitOpen"
      :provider="limitProvider"
      :item-ids="limitItemIds"
      @close="limitOpen = false"
    />
  </div>
</template>
