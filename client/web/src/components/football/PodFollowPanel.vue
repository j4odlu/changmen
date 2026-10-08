<script setup lang="ts">
import { pickPodRayAutoTicket, placePodRayFollowBet, podRayFollowPlaceBlock, readRayFootballBindTasks, rayGateEntry, syncRayFootballOrders, type PodRayFollowPlaceTicket } from "@/runtime/podRayFollowPlace";
import { getExchange } from "@changmen/shared/currency";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import PodFollowTable from "./PodFollowTable.vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import {
  formatPodAgo,
  formatPodDropPct,
  formatPodOutcome,
  formatPodPeriod,
  formatPodPrice,
  isFreshPodAlert,
} from "@/runtime/podAlerts";
import {
  POD_BET_SETTINGS_UPDATED,
  podAlertBetFailReason,
  podAlertWithinFollowAge,
  readPodBetSettings,
  type PodBetSettings,
} from "@/runtime/podBetSettings";
import {
  formatPodStake,
  listPodFollowTickets,
} from "@/runtime/podBetTicket";
import { recordFootballFollowAttempt } from "@/runtime/footballFollowAttempt";
import { compareFootballFollowShadow } from "@/runtime/footballFollowShadowCompare";
import { readFootballFollowV2Settings, type FootballFollowV2Settings } from "@/runtime/footballFollowV2Settings";
import { getFootballQuote } from "@/runtime/footballQuote";
import {
  pickPodYaboAutoTicket,
  resolvePodYaboStake,
} from "@/runtime/podYabo";
import type { PodOutcomeGateEntry } from "@/runtime/podYabo/gate";
import { openFootballSettings } from "@/runtime/footballSettingsUi";
import {
  fixtureFromViewMatch,
  mergePodObDiscoveryFixtures,
} from "@/runtime/podFixtureMatch";
import { resolveFootballFollowDecision } from "@/runtime/footballFollowDecision";
import { buildFootballFollowSelectionShadow } from "@/runtime/footballFollowSelectionKey";
import { getPodVenueMatchPlugin, matchPodAlertAcrossVenuePlugins } from "@/runtime/podVenueMatchPlugins";
import { describePodAlertMatch, shouldDiscoverPodObAlert } from "@/runtime/podAlertMatchStatus";
import {
  buildPodBoardFocus,
  requestPodBoardFocus,
} from "@/runtime/podBoardFocus";
import {
  placePodFollowBet,
  podFollowPlaceBlock,
  type PodFollowPlaceTicket,
} from "@/runtime/podFollowPlace";
import {
  pickPodPmAutoTicket,
  placePodPmFollowBet,
  podPmFollowPlaceBlock,
  type PodPmFollowPlaceTicket,
} from "@/runtime/podPmFollowPlace";
import {
  buildPodFollowLogRow,
  buildPodFollowVenueLog,
  markPodFollowVenueSubmitted,
  buildPodFollowPlaceSnap,
  clearPodFollowLog,
  markPodFollowLogPlaced,
  readPodFollowLog,
  ticketHasPodFollowMatch,
  upsertPodFollowEv,
  type PodFollowLogRow,
} from "@/runtime/podFollowLog";
import {
  formatPodFollowPending,
  resolvePodFollowPending,
  type PodFollowPendingState,
} from "@/runtime/podFollowPending";
import { obEnglishNamesRev, peekObEnglishNames } from "@/runtime/obSportEnglishNames";
import {
  listPodObMissFixtures,
  resetPodObMissSearch,
  searchPodObMissFixture,
  subscribePodObMissSearch,
} from "@/runtime/podObMissSearch";
import {
  listPrefetchedObMarkets,
  mergePodBoardMarkets,
  peekPrefetchedObOdds,
  hasPrefetchedObOdds,
  prefetchObSportMatchMarkets,
  prefetchObSportOidQuote,
  resetPodMarketPrefetch,
  subscribePodMarketPrefetch,
} from "@/runtime/podMarketPrefetch";
import { fetchObSportAmount } from "@/runtime/obSportAmount";
import { isUnifiedFootballOrderRow } from "@/shared/orderDomain";
import type { OrderRow } from "@/types/order";
import { useFootballOrderStore } from "@/stores/footballOrderStore";
import { useAccountStore } from "@/stores/accountStore";
import { useFootballStore } from "@/stores/footballStore";
import { useObSportLiveStore } from "@/stores/obSportLiveStore";
import { useOrderStore } from "@/stores/orderStore";
import { usePodAlertStore } from "@/stores/podAlertStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";

const POS_KEY = "changmen:podFollowPanel";
const DEFAULT_W = 1280;
const DEFAULT_H = 600;
const MIN_W = 620;
const MIN_H = 180;
const HEADER_H = 40;
const MARGIN = 8;

const store = usePodAlertStore();
const football = useFootballStore();
const sportOdds = useSportOddsStore();
const obLive = useObSportLiveStore();
const footballOrders = useFootballOrderStore();
const orderStore = useOrderStore();
const accountStore = useAccountStore();
const { snapshot, portReady, alerts } = storeToRefs(store);
const { matchs } = storeToRefs(football);
const { tick: sportOddsTick } = storeToRefs(sportOdds);
const { lineTick } = storeToRefs(obLive);
const betSettings = ref<PodBetSettings>(readPodBetSettings());
const followV2 = ref<FootballFollowV2Settings>(readFootballFollowV2Settings());
const nowTick = ref(Date.now());
const missTick = ref(0);
const prefetchTick = ref(0);
const sportAmount = ref(0);
/** 对齐 AutoYabo seenAlertKeys：自动试过的票不再每轮重打 */
const autoAttempted = ref<Record<string, true>>({});
const obExecutionEntries = ref<Record<string, PodOutcomeGateEntry>>({});
const autoReady = ref(false);
const alertFilter = ref<"all" | "matched">("all");
let nowTimer: ReturnType<typeof setInterval> | null = null;
let amountTimer: ReturnType<typeof setInterval> | null = null;
let stopMissSearch: (() => void) | null = null;
let stopPrefetch: (() => void) | null = null;
let autoRunnerActive = false;
let autoRunRequested = false;
let autoRunnerStopped = false;
const UI_TICK_MS = 1_000;
const obMatchPlugin = getPodVenueMatchPlugin("OB");
const rayMatchPlugin = getPodVenueMatchPlugin("RAY");
let rayOrderTimer: ReturnType<typeof setInterval> | null = null;
const rayOrderRevision = ref(0);
const rayOrdersRefreshing = ref(false);
const pmMatchPlugin = getPodVenueMatchPlugin("Polymarket");

const podLiveReader = {
  get: (platform: string, id: string) => platform !== "OB" || sportOdds.hasFresh("OB", id)
    ? sportOdds.get(platform, id) : peekPrefetchedObOdds(id),
  has: (platform: string, id: string) => platform !== "OB" ? sportOdds.has(platform, id)
    : sportOdds.hasFresh("OB", id) || hasPrefetchedObOdds(id),
  getLine: (oid: string) => obLive.getLine(oid),
};

const podFixtures = computed(() => {
  void missTick.value;
  void prefetchTick.value;
  void obEnglishNamesRev.value;
  const board = matchs.value.map((row) => {
    const fixture = fixtureFromViewMatch(row);
    const extra = listPrefetchedObMarkets(fixture.obMid);
    const withMarkets = extra.length
      ? { ...fixture, markets: mergePodBoardMarkets(fixture.markets, extra) }
      : fixture;
    const en = peekObEnglishNames(withMarkets.obMid);
    if (!en)
      return withMarkets;
    return { ...withMarkets, homeEn: en.home, awayEn: en.away, gameEn: en.league };
  });
  const discovered = listPodObMissFixtures().map(row => {
    const extra = listPrefetchedObMarkets(row.obMid);
    return extra.length ? { ...row, markets: mergePodBoardMarkets(row.markets, extra) } : row;
  });
  return mergePodObDiscoveryFixtures(board, discovered);
});

// [changmen 扩展] 左侧警报独立对场/对盘；跟单票仍严格受现有设置与下单门控控制。
const alertVenueMatches = computed(() => {
  void sportOddsTick.value;
  void lineTick.value;
  void prefetchTick.value;
  return new Map(alerts.value.map(alert => [alert.id,
    matchPodAlertAcrossVenuePlugins(alert, podFixtures.value, podLiveReader)]));
});
const tickets = computed(() => {
  void nowTick.value;
  void sportOddsTick.value;
  void lineTick.value;
  void prefetchTick.value;
  const fixtures = podFixtures.value;
  const live = podLiveReader;
  return listPodFollowTickets(alerts.value, { ...betSettings.value, maxAgeSec: 0 }).map(ticket => {
    const matchContext = {
      fixtures,
      live,
      books: snapshot.value.books,
      settings: betSettings.value,
    };
    const venueMatches = alertVenueMatches.value.get(ticket.alert.id)
      || matchPodAlertAcrossVenuePlugins(ticket.alert, fixtures, live);
    const fixtureMatch = venueMatches.get("OB")?.fixture
      ?? obMatchPlugin.matchFixture(ticket.alert, fixtures);
    const hit = fixtureMatch.status === "matched" ? fixtureMatch.hits[0] : null;
    const scored = obMatchPlugin.scoreTicket?.(ticket, fixtureMatch, matchContext);
    if (!scored)
      throw new Error("POD OB venue plugin missing scoreTicket");
    const pmFixtureMatch = venueMatches.get("Polymarket")?.fixture
      ?? pmMatchPlugin.matchFixture(ticket.alert, fixtures);
    const pmMarketMatch = venueMatches.get("Polymarket")?.market
      ?? pmMatchPlugin.matchMarket(ticket.alert, pmFixtureMatch, live);
    const pmQuote = pmMatchPlugin.compareQuote(pmMarketMatch, {
      minOdds: scored.minObOdds,
      maxOdds: scored.maxObOdds,
      nvp: scored.nvp,
    });
    const rayFixtureMatch = venueMatches.get("RAY")!.fixture;
    const rayMarketMatch = venueMatches.get("RAY")!.market;
    const rayQuote = rayMatchPlugin.compareQuote(rayMarketMatch, { minOdds: ticket.minObOdds, maxOdds: ticket.maxObOdds, nvp: ticket.nvp });
    const selectionShadow = buildFootballFollowSelectionShadow({
      fixtureMatch,
      fixture: hit?.fixture,
      market: scored.marketMatch,
    });
    const decisionShadow = resolveFootballFollowDecision({
      ticket: scored,
      fixtureMatch,
      marketMatch: scored.marketMatch,
      quote: scored.obQuote,
      selectionShadow,
    });
    const quoteShadow = getFootballQuote({
      key: selectionShadow.key,
      fallbackOdds: Number(scored.marketMatch.quote) || 0,
      reader: {
        hasLive: (platform, id) => sportOdds.has(platform, id),
        getLive: (platform, id) => sportOdds.get(platform, id),
        getPrefetch: id => peekPrefetchedObOdds(id),
        getLine: id => obLive.getLine(id),
      },
    });
    const legacyBlock = podFollowPlaceBlock({
      id: scored.id,
      stake: followStakeFor("OB"),
      fixtureStatus: fixtureMatch.status,
      fixtureBasis: fixtureMatch.basis,
      obMid: String(hit?.fixture.obMid || "").trim(),
      home: scored.alert.home,
      away: scored.alert.away,
      sideLabel: scored.sideLabel,
      marketLabel: scored.marketLabel,
      market: scored.marketMatch,
      quote: scored.obQuote,
    });
    const shadowCompare = compareFootballFollowShadow({
      marketMatch: scored.marketMatch,
      obQuote: scored.obQuote,
      selectionShadow,
      quoteShadow,
      decisionShadow,
      legacyBlock,
    });
    return {
      ...scored,
      selectionShadow,
      decisionShadow,
      quoteShadow,
      legacyBlock,
      shadowCompare,
      rayFixtureMatch, rayMarketMatch, rayQuote,
      pmMarketMatch,
      pmQuote,
      pmFixtureMatch,
      fixtureMatch,
    };
  });
});

const ticketByAlertId = computed(() => new Map(tickets.value.map(ticket => [ticket.id, ticket])));
const alertMatchStatuses = computed(() => new Map(alerts.value.map(alert => {
  const ticket = ticketByAlertId.value.get(alert.id);
  const results = [...(alertVenueMatches.value.get(alert.id)?.values() || [])]
    .map(row => row.plugin.id === "OB" && ticket ? { ...row, market: ticket.marketMatch } : row);
  return [alert.id, describePodAlertMatch(alert, results, betSettings.value, nowTick.value)];
})));
const matchedAlertCount = computed(() => alerts.value.reduce((count, alert) => {
  return count + (alertMatchStatuses.value.get(alert.id)?.matched ? 1 : 0);
}, 0));
const visiblePodAlerts = computed(() => alertFilter.value === "all"
  ? alerts.value
  : alerts.value.filter((alert) => {
      return alertMatchStatuses.value.get(alert.id)?.matched === true;
    }));

function ticketHasAnyVenueMatch(ticket: (typeof tickets.value)[number]): boolean {
  return ticketHasPodFollowMatch(ticket) || (ticket.rayFixtureMatch.status === "matched" && ticket.rayMarketMatch.status === "matched")
    || (ticket.pmFixtureMatch.status === "matched" && ticket.pmMarketMatch.status === "matched");
}

function displayLogTicket(ticket: (typeof tickets.value)[number]) {
  if (ticketHasPodFollowMatch(ticket)) return ticket;
  const ray = ticket.rayMarketMatch.status === "matched";
  return { ...ticket, fixtureMatch: ray ? ticket.rayFixtureMatch : ticket.pmFixtureMatch,
    marketMatch: ray ? ticket.rayMarketMatch : ticket.pmMarketMatch, obQuote: ray ? ticket.rayQuote : ticket.pmQuote };
}

function podAlertMatched(id: string): boolean {
  return alertMatchStatuses.value.get(id)?.matched === true;
}

watch(() => ({ matches: alertVenueMatches.value, now: nowTick.value }), ({ matches, now }) => {
  for (const alert of alerts.value) {
    if (!shouldDiscoverPodObAlert(alert, now))
      continue;
    const ob = matches.get(alert.id)?.get("OB");
    if (ob?.fixture.status === "none")
      void searchPodObMissFixture(alert);
    const mid = ob?.fixture.status === "matched" ? ob.fixture.hits[0]?.fixture.obMid : "";
    if (mid && ob?.market.status === "none")
      void prefetchObSportMatchMarkets(mid, alert.alertedAt + 60_000);
  }
}, { immediate: true });

function onPodAlertClick(id: string) {
  const ticket = ticketByAlertId.value.get(id);
  if (ticket?.fixtureMatch.status === "matched") {
    jumpToTicket(ticket);
    return;
  }
  const ob = alertVenueMatches.value.get(id)?.get("OB");
  if (ob?.fixture.status === "matched" && ob.fixture.hits[0])
    requestPodBoardFocus(buildPodBoardFocus(ob.fixture.hits[0].fixture, ob.market));
}
const logRows = ref<PodFollowLogRow[]>(readPodFollowLog());
const liveById = computed(() => new Map(
  tickets.value.filter(ticketHasAnyVenueMatch).map(ticket => [ticket.id, ticket]),
));

function decisionFixtureLabel(ticket: (typeof tickets.value)[number]): string {
  const f = ticket.decisionShadow.fixture;
  if (f.status !== "matched")
    return f.status === "pending" ? "场:待确认" : "场:未对";
  return f.confidence === "exact" ? "场:确" : "场:猜";
}

function decisionMarketLabel(ticket: (typeof tickets.value)[number]): string {
  const m = ticket.decisionShadow.market;
  if (m.status === "matched")
    return "盘:已对";
  if (m.status === "skipped")
    return "盘:跳过";
  return "盘:未对";
}

function decisionQuoteLabel(ticket: (typeof tickets.value)[number]): string {
  const q = ticket.decisionShadow.quote;
  if (q.status === "ok")
    return "价:够";
  if (q.status === "locked")
    return "价:锁";
  if (q.status === "below_min")
    return "价:不足";
  if (q.status === "spike")
    return "价:异常";
  return "价:缺";
}

function quoteShadowLabel(ticket: (typeof tickets.value)[number]): string {
  const q = ticket.quoteShadow;
  const src = q.source === "live"
    ? "live"
    : q.source === "prefetch"
      ? "pre"
      : q.source === "http"
        ? "http"
        : "miss";
  if (q.locked)
    return `${src}:锁`;
  return q.odds > 0 ? `${src}:${formatPodPrice(q.odds)}` : src;
}

function decisionAutoLabel(ticket: (typeof tickets.value)[number]): string {
  if (ticket.decisionShadow.action.canAutoPlace)
    return "自动:可";
  if (ticket.decisionShadow.action.canManualPlace)
    return "自动:否";
  return `阻断:${ticket.decisionShadow.action.blockReason || "未知"}`;
}

function decisionShadowText(ticket: (typeof tickets.value)[number]): string {
  return [
    decisionFixtureLabel(ticket),
    decisionMarketLabel(ticket),
    decisionQuoteLabel(ticket),
    quoteShadowLabel(ticket),
    decisionAutoLabel(ticket),
    gateCompareLabel(ticket),
    shadowCompareLabel(ticket),
  ].join(" · ");
}

function gateCompareLabel(ticket: (typeof tickets.value)[number]): string {
  const legacy = String(ticket.legacyBlock || "").trim();
  const shadow = String(ticket.decisionShadow.action.blockReason || "").trim();
  return legacy === shadow ? "门:同" : "门:差";
}

function shadowCompareLabel(ticket: (typeof tickets.value)[number]): string {
  return ticket.shadowCompare.ok ? "影:同" : `影:${ticket.shadowCompare.reasons.length}`;
}

function decisionShadowTone(ticket: (typeof tickets.value)[number]): string {
  if (ticket.decisionShadow.action.canAutoPlace)
    return "ok";
  if (ticket.decisionShadow.action.canManualPlace)
    return "wait";
  return "block";
}

function decisionShadowTitle(ticket: (typeof tickets.value)[number]): string {
  const key = ticket.selectionShadow.key;
  const base = [
    `fixture=${ticket.decisionShadow.fixture.reason}`,
    `market=${ticket.decisionShadow.market.reason}`,
    `quote=${ticket.decisionShadow.quote.reason}`,
    `selection=${ticket.selectionShadow.reason}`,
    `quoteShadow=${ticket.quoteShadow.source}:${ticket.quoteShadow.locked ? "locked" : ticket.quoteShadow.odds}:${ticket.quoteShadow.line ?? ""}`,
    `legacyBlock=${ticket.legacyBlock || "ok"}`,
    `shadowCompare=${ticket.shadowCompare.summary}`,
  ];
  if (key) {
    base.push(
      `key=${key.matchKey}|${key.period}|${key.marketCode}|${key.line ?? ""}|${key.side}|${key.oddId}|${key.confidence}`,
    );
  }
  return base.join(" ");
}

const followObEnabled = computed(() => betSettings.value.followAccountIds.length > 0);
const followRayEnabled = computed(() => betSettings.value.rayFollowAccountIds.length > 0);
const followPmEnabled = computed(() => betSettings.value.pmFollowAccountIds.length > 0);

function refreshLog() {
  logRows.value = readPodFollowLog();
}

function recordLiveTickets() {
  let wrote = false;
  for (const ticket of tickets.value) {
    if (!ticketHasAnyVenueMatch(ticket))
      continue;
    const row = buildPodFollowLogRow(displayLogTicket(ticket), nowTick.value);
    row.venues = {};
    for (const venueTicket of [ticket,
      { ...ticket, fixtureMatch: ticket.pmFixtureMatch, marketMatch: ticket.pmMarketMatch, obQuote: ticket.pmQuote },
      { ...ticket, fixtureMatch: ticket.rayFixtureMatch, marketMatch: ticket.rayMarketMatch, obQuote: ticket.rayQuote }]) {
      if (!ticketHasPodFollowMatch(venueTicket)) continue;
      const venueRow = buildPodFollowVenueLog(venueTicket);
      row.venues[venueRow.venue] = venueRow;
    }
    const next = upsertPodFollowEv(row);
    if (next.added || next.wrote)
      wrote = true;
  }
  if (wrote)
    refreshLog();
}

watch(tickets, recordLiveTickets, { immediate: true });

watch(() => ({ rows: tickets.value, ready: autoReady.value, enabled: betSettings.value.enabled,
  auto: betSettings.value.autoPlace, accounts: betSettings.value.followAccountIds.join(",") }), ({ rows }) => {
  if (!autoReady.value || !betSettings.value.enabled || !betSettings.value.autoPlace || !followObEnabled.value) {
    requestAutoPlace();
    return;
  }
  const now = Date.now();
  const skipped = new Set(pendingPlacedIds());
  for (const ticket of rows) {
    if (skipped.has(ticket.id) || podAlertBetFailReason(ticket.alert, betSettings.value, now) != null)
      continue;
    if (ticket.fixtureMatch.status === "none")
      void searchPodObMissFixture(ticket.alert);
    const hit = ticket.fixtureMatch.status === "matched" ? ticket.fixtureMatch.hits[0] : null;
    const mid = String(hit?.fixture.obMid || "").trim();
    if (mid && ticket.marketMatch.status !== "matched")
      void prefetchObSportMatchMarkets(mid, ticketPlacePayload(ticket, true).submitBefore);
    const oid = String(ticket.marketMatch.oid || "").trim();
    if (oid && mid && !sportOdds.hasFresh("OB", oid))
      void prefetchObSportOidQuote(oid, mid, {
        marketCode: ticket.marketMatch.marketCode,
        boardSide: ticket.marketMatch.boardSide || undefined,
        odds: Number(ticket.marketMatch.quote) || Number(ticket.obQuote.quote) || 0,
        submitBefore: ticketPlacePayload(ticket, true).submitBefore,
      });
  }
  // 新警报、比赛、盘口或目标赔率变化时推进串行队列；不靠轮询重算整板。
  requestAutoPlace();
}, { immediate: true });

function jumpToTicket(ticket: (typeof tickets.value)[number]) {
  const candidates = [ticket,
    { ...ticket, fixtureMatch: ticket.pmFixtureMatch, marketMatch: ticket.pmMarketMatch },
    { ...ticket, fixtureMatch: ticket.rayFixtureMatch, marketMatch: ticket.rayMarketMatch }];
  const target = candidates.find(row => row.fixtureMatch.status === "matched" && row.marketMatch.status === "matched")
    || candidates.find(row => row.fixtureMatch.status === "matched");
  if (!target) {
    // 手动点击仍可按需补场；关闭自动时不后台扫描所有警报。
    void searchPodObMissFixture(ticket.alert);
    return;
  }
  const hit = target.fixtureMatch.hits[0];
  if (!hit)
    return;
  if (target.marketMatch.status !== "matched" && hit.fixture.obMid)
    void prefetchObSportMatchMarkets(hit.fixture.obMid);
  requestPodBoardFocus(buildPodBoardFocus(hit.fixture, target.marketMatch));
}

function followStakeFor(venue: "OB" | "Polymarket" | "RAY"): number {
  return Number(venue === "OB" ? betSettings.value.obStake : venue === "RAY" ? betSettings.value.rayStake : betSettings.value.pmStake) || 0;
}

function strategyStakeFor(venue: "OB" | "Polymarket" | "RAY", auto: boolean): number {
  const base = followStakeFor(venue);
  return auto ? resolvePodYaboStake(base, betSettings.value) : base;
}

function formatEnabledVenueStakes(): string {
  const parts: string[] = [];
  if (followObEnabled.value)
    parts.push(`OB ${formatPodStake(followStakeFor("OB"))}${betSettings.value.obAccountRotation && betSettings.value.followAccountIds.length > 1 ? " 轮换" : ""}`);
  if (followRayEnabled.value)
    parts.push(`RAY ${formatPodStake(followStakeFor("RAY"))}`);
  if (followPmEnabled.value)
    parts.push(`PM ${formatPodStake(followStakeFor("Polymarket"))}`);
  return parts.join(" · ") || "未选账号";
}

const followSummary = computed(() => {
  const parts = [formatEnabledVenueStakes()];
  parts.push(`自动${betSettings.value.autoPlace ? "开" : "关"}`);
  if (sportAmount.value > 0 && venueSelectedAccountCount("OB") <= 1)
    parts.push(`余额 ${sportAmount.value}`);
  return parts.join(" · ");
});

function ticketPlacePayload(ticket: (typeof tickets.value)[number], auto = false): PodFollowPlaceTicket {
  const hit = ticket.fixtureMatch.status === "matched" ? ticket.fixtureMatch.hits[0] : null;
  return {
    id: ticket.id,
    stake: strategyStakeFor("OB", auto),
    fixtureStatus: ticket.fixtureMatch.status,
    fixtureBasis: ticket.fixtureMatch.basis,
    obMid: String(hit?.fixture.obMid || "").trim(),
    home: ticket.alert.home,
    away: ticket.alert.away,
    sideLabel: ticket.sideLabel,
    marketLabel: ticket.marketLabel,
    auto,
    submitBefore: auto ? Math.min(
      betSettings.value.maxAgeSec > 0 ? ticket.alert.alertedAt + betSettings.value.maxAgeSec * 1000 : Infinity,
      betSettings.value.prematchOnly ? ticket.alert.starts : Infinity,
    ) : undefined,
    accountIds: betSettings.value.followAccountIds,
    market: ticket.marketMatch,
    quote: ticket.obQuote,
  };
}

function pmTicketPlacePayload(ticket: (typeof tickets.value)[number], auto = false): PodPmFollowPlaceTicket {
  const hit = ticket.pmFixtureMatch.status === "matched" ? ticket.pmFixtureMatch.hits[0] : null;
  return {
    id: ticket.id,
    stake: strategyStakeFor("Polymarket", auto),
    fixtureStatus: ticket.pmFixtureMatch.status,
    fixtureBasis: ticket.pmFixtureMatch.basis,
    pmMatchId: String(hit?.fixture.pmMid || hit?.fixture.id || "").trim(),
    home: ticket.alert.home,
    away: ticket.alert.away,
    sideLabel: ticket.sideLabel,
    marketLabel: ticket.marketLabel,
    auto,
    accountIds: betSettings.value.pmFollowAccountIds,
    market: ticket.pmMarketMatch,
    quote: ticket.pmQuote,
  };
}

function rayTicketPlacePayload(ticket: (typeof tickets.value)[number], auto = false): PodRayFollowPlaceTicket {
  const hit = ticket.rayFixtureMatch.status === "matched" ? ticket.rayFixtureMatch.hits[0] : null;
  return { id: ticket.id, stake: strategyStakeFor("RAY", auto), fixtureStatus: ticket.rayFixtureMatch.status,
    fixtureBasis: ticket.rayFixtureMatch.basis, rayMatchId: String(hit?.fixture.providers?.RAY || ""),
    home: ticket.alert.home, away: ticket.alert.away, sideLabel: ticket.sideLabel, marketLabel: ticket.marketLabel,
    auto, submitBefore: auto ? Math.min(
      betSettings.value.maxAgeSec > 0 ? ticket.alert.alertedAt + betSettings.value.maxAgeSec * 1000 : Infinity,
      betSettings.value.prematchOnly ? ticket.alert.starts : Infinity,
    ) : undefined,
    accountIds: betSettings.value.rayFollowAccountIds, market: ticket.rayMarketMatch, quote: ticket.rayQuote };
}
const placingRayId = ref("");
const placingId = ref("");
const placingPmId = ref("");
const placed = ref<Record<string, true>>({});
const placeNote = ref<Record<string, string>>({});

function venuePlaceKey(venue: "OB" | "Polymarket" | "RAY", id: string): string {
  return `${venue}:${String(id || "").trim()}`;
}

function orderCreateMs(row: OrderRow): number {
  const n = Number(row.CreateAt) || 0;
  return n > 0 && n < 10_000_000_000 ? n * 1000 : n;
}

function isTodayOrderRow(row: OrderRow): boolean {
  const at = orderCreateMs(row);
  if (!(at > 0))
    return false;
  const d = new Date(at);
  const now = new Date(nowTick.value);
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function rayUnifiedFootballRows(todayOnly = false): OrderRow[] {
  return [...orderStore.orders.values()].flat().filter(r => r.Type === "RAY" && isUnifiedFootballOrderRow(r)
    && (!todayOnly || isTodayOrderRow(r)));
}
function rayPendingTasks() { void rayOrderRevision.value; return readRayFootballBindTasks(); }
function rayPendingPlacedIds(): string[] {
  return [...Object.keys(placed.value), ...Object.keys(autoAttempted.value)]
    .filter(k => k.startsWith("RAY:")).map(k => k.slice(4))
    .concat(rayUnifiedFootballRows().map(r => String(r.PodClientId || "")), rayPendingTasks().map(t => t.ticket.id));
}
function rayPendingPlacedEntries(): PodOutcomeGateEntry[] {
  const keys = new Set(rayPendingPlacedIds());
  return [...tickets.value.filter(t => keys.has(t.id)).map(t => rayGateEntry(rayTicketPlacePayload(t))),
    ...rayPendingTasks().map(t => rayGateEntry(t.ticket)),
    ...rayUnifiedFootballRows().map(r => ({ obMid: String(r.PodRayMatchId || ""), marketCode: String(r.PodMarketCode || ""),
      boardSide: r.PodBoardSide as PodOutcomeGateEntry["boardSide"] }))];
}
function rayPlaceBlock(ticket: (typeof tickets.value)[number]): string | null {
  if (isVenuePlaced(ticket.id, "RAY") || rayPendingTasks().some(t => t.ticket.id === ticket.id)) return "已提交，等待回查";
  return venueDailyOrderBlock("RAY") || podRayFollowPlaceBlock(rayTicketPlacePayload(ticket));
}
async function refreshRayOrders() {
  if (rayOrdersRefreshing.value) return;
  rayOrdersRefreshing.value = true;
  try {
    await syncRayFootballOrders();
    rayOrderRevision.value++;
    await orderStore.fetchOrders(undefined, { sideEffects: false });
  }
  catch (err) { console.warn("[football] RAY order refresh failed", err); }
  finally {
    rayOrdersRefreshing.value = false;
    requestAutoPlace();
  }
}

function pmUnifiedFootballRows(opts: { todayOnly?: boolean } = {}): OrderRow[] {
  const out: OrderRow[] = [];
  for (const group of orderStore.orders.values()) {
    for (const row of group) {
      if (opts.todayOnly && !isTodayOrderRow(row))
        continue;
      if (
        String(row.Type || "").trim() === "Polymarket"
        && row.PmSide !== "sell"
        && isUnifiedFootballOrderRow(row)
        && String(row.Source || "").trim().startsWith("football-pod")
      ) {
        out.push(row);
      }
    }
  }
  return out;
}

function pmPodClientId(row: OrderRow): string {
  return String(row.PodClientId || "").trim();
}

function isPmUnifiedPodPlaced(id: string): boolean {
  const want = String(id || "").trim();
  return !!want && pmUnifiedFootballRows().some(row => pmPodClientId(row) === want);
}

function pmUnifiedOrderKey(row: OrderRow): string {
  return String(row.OrderID || `${row.PlayerID || ""}:${row.CreateAt || ""}`).trim();
}

function pmUnifiedPendingCap() {
  let todayProfit = 0;
  let openStake = 0;
  for (const row of pmUnifiedFootballRows({ todayOnly: true })) {
    const status = String(row.Status || "None").trim().toLowerCase();
    if (!status || status === "none" || status === "pending")
      openStake += Number(row.BetMoney) || 0;
    else
      todayProfit += Number(row.Money) || 0;
  }
  return { todayProfit, openStake };
}

function hasVenueOrder(id: string, venue: "OB" | "Polymarket" | "RAY"): boolean {
  const want = String(id || "").trim();
  if (!want)
    return false;
  if (venue === "RAY")
    return rayUnifiedFootballRows().some(r => r.PodClientId === want) || rayPendingTasks().some(t => t.ticket.id === want);
  if (venue === "Polymarket")
    return isPmUnifiedPodPlaced(want);
  const rows = [...footballOrders.todayRows, ...footballOrders.rows];
  return rows.some((row) => {
    if (String(row.venue || "OB").trim() !== venue)
      return false;
    const rowId = String(row.id || "").trim();
    return rowId === want || rowId.startsWith(`${want}#`);
  });
}

function venueOrderCountToday(venue: "OB" | "Polymarket" | "RAY"): number {
  if (venue === "RAY") return rayUnifiedFootballRows(true).length + rayPendingTasks().filter(t => new Date(t.at).toDateString() === new Date().toDateString()).length;
  if (venue === "Polymarket") {
    const seen = new Set<string>();
    for (const row of pmUnifiedFootballRows({ todayOnly: true })) {
      const key = pmUnifiedOrderKey(row);
      if (key)
        seen.add(key);
    }
    return seen.size;
  }
  const seen = new Set<string>();
  for (const row of footballOrders.todayRows) {
    if (String(row.venue || "OB").trim() !== venue)
      continue;
    const key = String(row.orderId || row.id || `${row.playerId || ""}:${row.at || ""}`).trim();
    if (key)
      seen.add(key);
  }
  return seen.size;
}

function venueDailyOrderLimit(venue: "OB" | "Polymarket" | "RAY"): number {
  if (venue === "RAY") return betSettings.value.rayDailyOrderLimit;
  return venue === "OB"
    ? Math.round(Number(betSettings.value.obDailyOrderLimit) || 0)
    : Math.round(Number(betSettings.value.pmDailyOrderLimit) || 0);
}

function venueSelectedAccountCount(venue: "OB" | "Polymarket" | "RAY"): number {
  if (venue === "RAY") return betSettings.value.rayFollowAccountIds.length;
  return venue === "OB"
    ? betSettings.value.followAccountIds.length
    : betSettings.value.pmFollowAccountIds.length;
}

function venueNextOrderCount(venue: "OB" | "Polymarket" | "RAY"): number {
  const count = venueSelectedAccountCount(venue);
  return venue === "OB" && betSettings.value.obAccountRotation && count > 0 ? 1 : count;
}

function venueDailyOrderBlock(venue: "OB" | "Polymarket" | "RAY"): string | null {
  const limit = venueDailyOrderLimit(venue);
  if (!(limit > 0))
    return null;
  const current = venueOrderCountToday(venue);
  const next = venueNextOrderCount(venue);
  if (current >= limit)
    return `${venue === "Polymarket" ? "PM" : venue} 今日单数已满`;
  if (next > 0 && current + next > limit)
    return `${venue === "Polymarket" ? "PM" : venue} 今日剩余 ${Math.max(0, limit - current)} 单`;
  return null;
}

function isVenuePlaced(id: string, venue: "OB" | "Polymarket" | "RAY"): boolean {
  const key = venuePlaceKey(venue, id);
  if (placed.value[key] || hasVenueOrder(id, venue))
    return true;
  return venue === "OB" && logRows.value.some(row => row.id === id && row.placed);
}

function placeBlock(ticket: (typeof tickets.value)[number]): string | null {
  if (isVenuePlaced(ticket.id, "OB"))
    return "已下过";
  if (obExecutionEntries.value[ticket.id])
    return "提交结果待确认，禁止重复下单";
  const dailyBlock = venueDailyOrderBlock("OB");
  if (dailyBlock)
    return dailyBlock;
  return podFollowPlaceBlock(ticketPlacePayload(ticket));
}

function pmPlaceBlock(ticket: (typeof tickets.value)[number]): string | null {
  if (isVenuePlaced(ticket.id, "Polymarket"))
    return "已下过";
  const dailyBlock = venueDailyOrderBlock("Polymarket");
  if (dailyBlock)
    return dailyBlock;
  return podPmFollowPlaceBlock(pmTicketPlacePayload(ticket));
}

function placeLabel(ticket: (typeof tickets.value)[number]): string {
  if (isVenuePlaced(ticket.id, "OB"))
    return "已下";
  if (placingId.value === ticket.id)
    return "下单中";
  return "下单";
}

function pmPlaceLabel(ticket: (typeof tickets.value)[number]): string {
  if (isVenuePlaced(ticket.id, "Polymarket"))
    return "已下";
  if (placingPmId.value === ticket.id)
    return "PM中";
  return "下PM";
}

function pendingCap() {
  const pm = pmUnifiedPendingCap();
  return {
    todayProfit: footballOrders.todayProfit + pm.todayProfit + rayUnifiedFootballRows(true).filter(r => !["none", "pending"].includes(String(r.Status).toLowerCase())).reduce((n, r) => n + (Number(r.Money) || 0) * rayOrderExchange(r), 0),
    openStake: footballOrders.todayOpenStake + pm.openStake + rayUnifiedFootballRows(true).filter(r => ["none", "pending"].includes(String(r.Status).toLowerCase())).reduce((n, r) => n + (Number(r.BetMoney) || 0) * rayOrderExchange(r), 0) + rayPendingTasks().reduce((n, t) => n + t.venueStake * t.exchange, 0),
    maxDailyLoss: betSettings.value.maxDailyLoss,
  };
}

function rayOrderExchange(row: OrderRow): number {
  return getExchange(accountStore.findAccount(Number(row.PlayerID))?.currency || "CNY");
}

function pendingPlacedIds(): string[] {
  return [
    ...Object.keys(placed.value).filter(key => key.startsWith("OB:")).map(key => key.slice(3)),
    ...Object.keys(autoAttempted.value).filter(key => key.startsWith("OB:")).map(key => key.slice(3)),
    ...logRows.value.filter(row => row.placed).map(row => row.id),
  ];
}

function pendingPmPlacedIds(): string[] {
  return [
    ...Object.keys(placed.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
    ...Object.keys(autoAttempted.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
    ...pmUnifiedFootballRows()
      .map(row => pmPodClientId(row))
      .filter(Boolean),
  ];
}

function pendingPlacedEntries() {
  return [...Object.values(obExecutionEntries.value), ...logRows.value
    .filter(row => row.placed && row.obMid && row.boardSide)
    .map(row => ({
      obMid: row.obMid,
      marketCode: row.marketCode,
      boardSide: row.boardSide,
    }))];
}

function inferPmMarketCode(label: unknown): string {
  const s = String(label || "").toLowerCase();
  if (/大小|total|over|under|o\/u/.test(s))
    return "totals";
  if (/让球|spread|handicap|ah/.test(s))
    return "spreads";
  if (/独赢|胜负|moneyline|winner|1x2/.test(s))
    return "moneyline";
  return "";
}

function inferPmBoardSide(label: unknown): PodOutcomeGateEntry["boardSide"] {
  const s = String(label || "").toLowerCase();
  if (/大|over/.test(s))
    return "over";
  if (/小|under/.test(s))
    return "under";
  if (/主|home/.test(s))
    return "home";
  if (/客|away/.test(s))
    return "away";
  if (/平|draw/.test(s))
    return "draw";
  return null;
}

function pmGateEntryFromPayload(payload: PodPmFollowPlaceTicket): PodOutcomeGateEntry | null {
  const obMid = String(payload.pmMatchId || "").trim();
  const marketCode = String(payload.market.marketCode || "").trim();
  const boardSide = payload.market.boardSide ?? null;
  if (!obMid || !marketCode || !boardSide)
    return null;
  return { obMid, marketCode, boardSide };
}

function pendingPmPlacedEntries(): PodOutcomeGateEntry[] {
  const out: PodOutcomeGateEntry[] = [];
  const push = (row: PodOutcomeGateEntry | null | undefined) => {
    if (!row?.obMid || !row.marketCode || !row.boardSide)
      return;
    out.push(row);
  };
  const pmKeys = new Set([
    ...Object.keys(placed.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
    ...Object.keys(autoAttempted.value).filter(key => key.startsWith("Polymarket:")).map(key => key.slice("Polymarket:".length)),
  ]);
  for (const row of tickets.value) {
    if (!pmKeys.has(row.id))
      continue;
    push(pmGateEntryFromPayload(pmTicketPlacePayload(row, true)));
  }
  for (const row of footballOrders.todayRows) {
    if (String(row.venue || "").trim() !== "Polymarket")
      continue;
    const obMid = String(row.obMid || "").trim();
    const marketCode = inferPmMarketCode(row.marketLabel);
    const boardSide = inferPmBoardSide(row.sideLabel);
    push({ obMid, marketCode, boardSide });
  }
  for (const row of pmUnifiedFootballRows()) {
    const obMid = String(row.PodPmMatchId || row.PmConditionId || "").trim();
    const marketCode = inferPmMarketCode(row.Bet);
    const boardSide = inferPmBoardSide(row.Item);
    push({ obMid, marketCode, boardSide });
  }
  return out;
}

function pendingStateFor(
  live: (typeof tickets.value)[number] | undefined,
  log: PodFollowLogRow,
): PodFollowPendingState {
  return resolvePodFollowPending({
    ticket: live ? ticketPlacePayload(live) : null,
    placed: isVenuePlaced(log.id, "OB"),
    placing: placingId.value === log.id,
    autoPlace: betSettings.value.autoPlace,
    withinAge: live
      ? podAlertWithinFollowAge(live.alert, betSettings.value.maxAgeSec, nowTick.value)
      : false,
    maxAgeSec: betSettings.value.maxAgeSec,
    autoAttempted: !!autoAttempted.value[venuePlaceKey("OB", log.id)],
    placeNote: placeNote.value[venuePlaceKey("OB", log.id)] || log.placeNote,
    placedAt: log.placedAt || (isVenuePlaced(log.id, "OB") ? log.at : 0),
    home: live?.alert.home || log.home,
    away: live?.alert.away || log.away,
    sideLabel: live?.sideLabel || log.sideLabel,
    marketLabel: live?.marketLabel || log.marketLabel,
    now: nowTick.value,
    placedIds: pendingPlacedIds(),
    placedEntries: pendingPlacedEntries(),
    cap: pendingCap(),
  });
}

const displayRows = computed(() => {
  void nowTick.value;
  void placingId.value;
  void placingPmId.value;
  void placed.value;
  void autoAttempted.value;
  void placeNote.value;
  void betSettings.value.autoPlace;
  void betSettings.value.maxAgeSec;
  void betSettings.value.maxDailyLoss;
  void footballOrders.todayProfit;
  void footballOrders.todayOpenStake;
  return logRows.value
    .map(log => {
      const live = liveById.value.get(log.id);
      return {
        log,
        live,
        pending: pendingStateFor(live, log),
        venueStates: Object.fromEntries(["OB", "Polymarket", "RAY"].map(venue => {
          const saved = log.venues?.[venue];
          const submitted = !!saved?.submittedAt || isVenuePlaced(log.id, venue as "OB" | "Polymarket" | "RAY");
          const ids = venue === "OB" ? betSettings.value.followAccountIds : venue === "RAY" ? betSettings.value.rayFollowAccountIds : betSettings.value.pmFollowAccountIds;
          const placing = (venue === "RAY" ? placingRayId.value : placingPmId.value) === log.id;
          const reason = saved?.note || placeNote.value[venuePlaceKey(venue as "OB" | "Polymarket" | "RAY", log.id)]
            || (live ? venue === "RAY" ? rayPlaceBlock(live) : venue === "Polymarket" ? pmPlaceBlock(live) : null : "已离线");
          const state = venue === "OB" ? pendingStateFor(live, log) : {
            placed: submitted, label: submitted ? "已提交" : placing ? "提交中" : "未下",
            detail: placing ? "" : reason || "可手点",
            tone: submitted ? "ok" : placing ? "wait" : reason ? "block" : "ready",
          };
          return [venue, { ...state, placed: submitted || state.placed, accountIds: ids,
            plannedStake: formatPodStake(followStakeFor(venue as "OB" | "Polymarket" | "RAY")),
            submittedAt: saved?.submittedAt || (venue === "OB" ? log.placedAt : 0),
          }];
        })),
      };
    });
});

function onDisplayClick(row: { live?: (typeof tickets.value)[number]; log: PodFollowLogRow }) {
  if (row.live)
    jumpToTicket(row.live);
  else
    jumpToLog(row.log);
}

async function placeTicket(ticket: (typeof tickets.value)[number], auto: boolean) {
  if (placingId.value)
    return;
  const payload = ticketPlacePayload(ticket, auto);
  const displaySnapshot = buildPodFollowVenueLog(ticket);
  const displayReference = buildPodFollowLogRow(ticket);
  recordObAttempt(ticket, auto ? "auto_attempt" : "manual_click", { stake: payload.stake });
  const block = placeBlock(ticket) || podFollowPlaceBlock(payload);
  if (block) {
    recordObAttempt(ticket, "blocked", { reason: block });
    if (!auto)
      ElMessage.warning(block);
    return;
  }
  if (isVenuePlaced(ticket.id, "OB")) {
    recordObAttempt(ticket, "blocked", { reason: "已下过" });
    if (!auto)
      ElMessage.info("已下过");
    return;
  }
  placingId.value = ticket.id;
  obExecutionEntries.value = { ...obExecutionEntries.value, [ticket.id]: {
    obMid: payload.obMid, marketCode: payload.market.marketCode, boardSide: payload.market.boardSide,
  } };
  try {
    const result = await placePodFollowBet(payload);
    if (!result.ok && !result.outcomeUnknown) {
      const next = { ...obExecutionEntries.value };
      delete next[ticket.id];
      obExecutionEntries.value = next;
    }
    if (result.outcomeUnknown)
      autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("OB", ticket.id)]: true };
    const key = venuePlaceKey("OB", ticket.id);
    placeNote.value = { ...placeNote.value, [key]: result.message };
    if (result.ok) {
      recordObAttempt(ticket, "placed", { message: result.message });
      placed.value = { ...placed.value, [key]: true };
      logRows.value = markPodFollowLogPlaced(
        ticket.id,
        result.message,
        Date.now(),
        buildPodFollowPlaceSnap(ticket),
      );
      logRows.value = markPodFollowVenueSubmitted(ticket.id, displaySnapshot, result.message, Date.now(), displayReference);
      ElMessage.success(result.message);
      return;
    }
    recordObAttempt(ticket, "failed", { message: result.message });
    if (auto)
      ElMessage.warning(result.message);
    else
      ElMessage.error(result.message);
  }
  finally {
    placingId.value = "";
  }
}

async function placePmTicket(ticket: (typeof tickets.value)[number], auto = false) {
  if (placingPmId.value)
    return;
  const payload = pmTicketPlacePayload(ticket, auto);
  const displaySnapshot = buildPodFollowVenueLog({ ...ticket, fixtureMatch: ticket.pmFixtureMatch, marketMatch: ticket.pmMarketMatch, obQuote: ticket.pmQuote });
  const displayReference = buildPodFollowLogRow(ticket);
  const block = venueDailyOrderBlock("Polymarket") || podPmFollowPlaceBlock(payload);
  if (block) {
    if (!auto)
      ElMessage.warning(block);
    return;
  }
  if (isVenuePlaced(ticket.id, "Polymarket")) {
    if (!auto)
      ElMessage.info("已下过");
    return;
  }
  placingPmId.value = ticket.id;
  try {
    const result = await placePodPmFollowBet(payload);
    const key = venuePlaceKey("Polymarket", ticket.id);
    placeNote.value = { ...placeNote.value, [key]: result.message };
    if (result.ok) {
      placed.value = { ...placed.value, [key]: true };
      logRows.value = markPodFollowVenueSubmitted(ticket.id, displaySnapshot, result.message, Date.now(), displayReference);
      ElMessage.success(result.message);
      return;
    }
    if (auto)
      ElMessage.warning(result.message);
    else
      ElMessage.error(result.message);
  }
  finally {
    placingPmId.value = "";
  }
}

function onPlaceClick(ev: MouseEvent, ticket: (typeof tickets.value)[number]) {
  ev.stopPropagation();
  void placeTicket(ticket, false);
}

function onPmPlaceClick(ev: MouseEvent, ticket: (typeof tickets.value)[number]) {
  ev.stopPropagation();
  void placePmTicket(ticket, false);
}

async function placeRayTicket(ticket: (typeof tickets.value)[number], auto = false) {
  if (placingRayId.value) return;
  const block = rayPlaceBlock(ticket);
  if (block) { if (!auto) ElMessage.warning(block); return; }
  placingRayId.value = ticket.id;
  const displaySnapshot = buildPodFollowVenueLog({ ...ticket, fixtureMatch: ticket.rayFixtureMatch, marketMatch: ticket.rayMarketMatch, obQuote: ticket.rayQuote });
  const displayReference = buildPodFollowLogRow(ticket);
  try {
    const result = await placePodRayFollowBet(rayTicketPlacePayload(ticket, auto));
    const key = venuePlaceKey("RAY", ticket.id);
    placeNote.value = { ...placeNote.value, [key]: result.message };
    if (result.ok) { placed.value = { ...placed.value, [key]: true }; logRows.value = markPodFollowVenueSubmitted(ticket.id, displaySnapshot, result.message, Date.now(), displayReference); ElMessage.success(result.message); }
    else ElMessage.warning(result.message);
    await refreshRayOrders();
  }
  finally { placingRayId.value = ""; }
}
function onRayPlaceClick(ev: MouseEvent, ticket: (typeof tickets.value)[number]) {
  ev.stopPropagation(); void placeRayTicket(ticket);
}

async function maybeAutoPlace(): Promise<boolean> {
  if (!betSettings.value.enabled || !betSettings.value.autoPlace || placingId.value || placingPmId.value || placingRayId.value)
    return false;
  let attempted = false;
  const eligibleTickets = () => tickets.value.filter(ticket =>
    podAlertBetFailReason(ticket.alert, betSettings.value, Date.now()) == null
    && podAlertWithinFollowAge(ticket.alert, betSettings.value.maxAgeSec, Date.now()),
  );
  const ageOk = eligibleTickets();
  const skipped = pendingPlacedIds();
  const placedEntries = pendingPlacedEntries();
  const cap = pendingCap();
  // 暖一下预检价，给 EV/锁盘判断；真下单仍走 queryBetAmountPB
  if (followObEnabled.value) {
    for (const ticket of ageOk.slice(0, 6)) {
      if (skipped.includes(ticket.id))
        continue;
      const payload = ticketPlacePayload(ticket);
      if (payload.fixtureBasis !== "confirmed")
        continue;
      if (podFollowPlaceBlock(payload))
        continue;
      const oid = String(payload.market.oid || "").trim();
      const mid = String(payload.obMid || "").trim();
      if (oid && mid && !sportOdds.hasFresh("OB", oid))
        void prefetchObSportOidQuote(oid, mid, {
          marketCode: payload.market.marketCode,
          boardSide: payload.market.boardSide || undefined,
          odds: Number(payload.quote.quote) || Number(payload.market.quote) || 0,
          submitBefore: ticketPlacePayload(ticket, true).submitBefore,
        });
    }
  }
  if (followObEnabled.value) {
    const next = pickPodYaboAutoTicket(
      ageOk.map(row => ticketPlacePayload(row)),
      skipped,
      placedEntries,
      cap,
    );
    if (next) {
      const ui = tickets.value.find(row => row.id === next.id);
      if (ui) {
        // 先占坑再下：对齐 seenAlertKeys，避免管道慢时重复打同一票
        autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("OB", next.id)]: true };
        await placeTicket(ui, true);
        attempted = true;
      }
    }
  }
  if (betSettings.value.enabled && betSettings.value.autoPlace && followRayEnabled.value && !rayOrdersRefreshing.value) {
    const next = pickPodRayAutoTicket(eligibleTickets().filter(() => !venueDailyOrderBlock("RAY")).map(t => rayTicketPlacePayload(t, true)),
      rayPendingPlacedIds(), rayPendingPlacedEntries(), pendingCap());
    const ui = next && tickets.value.find(t => t.id === next.id);
    if (ui) { autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("RAY", ui.id)]: true }; await placeRayTicket(ui, true); attempted = true; }
  }
  if (!betSettings.value.enabled || !betSettings.value.autoPlace || !followPmEnabled.value)
    return attempted;
  const pmNext = pickPodPmAutoTicket(
    eligibleTickets().map(row => pmTicketPlacePayload(row, true)),
    pendingPmPlacedIds(),
    pendingPmPlacedEntries(),
    pendingCap(),
  );
  if (!pmNext)
    return attempted;
  const pmUi = tickets.value.find(row => row.id === pmNext.id);
  if (!pmUi)
    return attempted;
  autoAttempted.value = { ...autoAttempted.value, [venuePlaceKey("Polymarket", pmNext.id)]: true };
  await placePmTicket(pmUi, true);
  return true;
}

/**
 * AutoYabo 模型：数据事件只负责唤醒；单一 runner 串行 drain，seen/attempted 在请求前占位。
 * 新事件落在执行期间时只置 pending，当前请求完成后再处理，避免并发下注。
 */
function requestAutoPlace() {
  if (autoRunnerStopped || !autoReady.value || !betSettings.value.autoPlace)
    return;
  autoRunRequested = true;
  if (!autoRunnerActive)
    void drainAutoPlaceQueue();
}

async function drainAutoPlaceQueue() {
  if (autoRunnerActive || autoRunnerStopped || !autoReady.value)
    return;
  autoRunnerActive = true;
  try {
    while (autoRunRequested && !autoRunnerStopped && betSettings.value.autoPlace) {
      autoRunRequested = false;
      const attempted = await maybeAutoPlace();
      // 一次只挑每馆一个；成功占位后继续 drain 其余已就绪票。
      if (attempted)
        autoRunRequested = true;
    }
  }
  finally {
    autoRunnerActive = false;
    if (autoRunRequested && !autoRunnerStopped && betSettings.value.autoPlace)
      void drainAutoPlaceQueue();
  }
}

function placeButtonTitle(ticket: (typeof tickets.value)[number]): string | undefined {
  const block = placeBlock(ticket);
  if (block)
    return block;
  const pending = pendingStateFor(ticket, {
    id: ticket.id,
    at: 0,
    home: "",
    away: "",
    league: "",
    sideLabel: "",
    marketLabel: "",
    nvp: 0,
    minObOdds: 0,
    maxObOdds: 0,
    obQuote: 0,
    pinPrevious: 0,
    pinCurrent: 0,
    dropPct: 0,
    stake: 0,
    oid: "",
    obMid: "",
    marketCode: "",
    boardSide: null,
    boardLine: null,
    placed: isVenuePlaced(ticket.id, "OB"),
    placedAt: 0,
    placeNote: placeNote.value[venuePlaceKey("OB", ticket.id)] || "",
  });
  if (pending.placed || pending.detail === "可手点" || pending.detail === "待自动")
    return undefined;
  return formatPodFollowPending(pending);
}

function pmPlaceButtonTitle(ticket: (typeof tickets.value)[number]): string | undefined {
  const block = pmPlaceBlock(ticket);
  return block || undefined;
}

function recordObAttempt(
  ticket: (typeof tickets.value)[number],
  status: "manual_click" | "auto_attempt" | "blocked" | "placed" | "failed",
  opts: { reason?: string; message?: string; stake?: number } = {},
) {
  const shadowMessage = ticket.shadowCompare.ok ? "" : `shadow:${ticket.shadowCompare.summary}`;
  const message = [opts.message, shadowMessage].filter(Boolean).join(" | ");
  recordFootballFollowAttempt({
    ticketId: ticket.id,
    venue: "OB",
    status,
    reason: opts.reason,
    message,
    auto: status === "auto_attempt",
    odds: Number(ticket.obQuote.quote) || Number(ticket.marketMatch.quote) || 0,
    stake: Number(opts.stake) || followStakeFor("OB"),
    selection: ticket.selectionShadow.key,
  });
}

const collapsed = ref(false);
const left = ref(0);
const top = ref(72);
const width = ref(DEFAULT_W);
const height = ref(DEFAULT_H);
const dragging = ref(false);
const resizing = ref(false);
let dragDx = 0;
let dragDy = 0;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;

const statusText = computed(() => {
  if (!betSettings.value.enabled)
    return "筛选已关";
  if (!portReady.value)
    return "扩展未连通";
  if (betSettings.value.autoPlace && !autoReady.value)
    return "恢复订单 · 自动暂停";
  if (snapshot.value.sourceConnected && snapshot.value.gridFound) {
    const n = displayRows.value.length;
    const live = tickets.value.filter(ticketHasAnyVenueMatch).length;
    if (!n)
      return "等待机会";
    return betSettings.value.autoPlace
      ? `${n} 条 · ${live} 在线 · 自动开`
      : `${n} 条 · ${live} 在线`;
  }
  if (snapshot.value.sourceConnected)
    return "等 Dropping Odds";
  return "等待 POD 页";
});

const statusKind = computed(() => {
  if (!betSettings.value.enabled)
    return "idle";
    if (tickets.value.length || logRows.value.length)
      return "ok";
  if (portReady.value)
    return "wait";
  return "idle";
});

const panelStyle = computed(() => ({
  left: `${left.value}px`,
  top: `${top.value}px`,
  width: `${width.value}px`,
  height: collapsed.value ? `${HEADER_H}px` : `${height.value}px`,
}));

function clampPos(x: number, y: number) {
  const w = width.value;
  const h = collapsed.value ? HEADER_H : height.value;
  const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - Math.min(h, 80) - MARGIN);
  left.value = Math.min(maxX, Math.max(MARGIN, x));
  top.value = Math.min(maxY, Math.max(MARGIN, y));
}

function clampSize(nextW: number, nextH: number) {
  const maxW = Math.max(MIN_W, window.innerWidth - left.value - MARGIN);
  const maxH = Math.max(MIN_H, window.innerHeight - top.value - MARGIN);
  width.value = Math.min(maxW, Math.max(MIN_W, Math.round(nextW)));
  height.value = Math.min(maxH, Math.max(MIN_H, Math.round(nextH)));
}

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw)
      return;
    const parsed = JSON.parse(raw) as {
      left?: unknown;
      top?: unknown;
      width?: unknown;
      height?: unknown;
      collapsed?: unknown;
      alertFilter?: unknown;
    };
    if (typeof parsed.collapsed === "boolean")
      collapsed.value = parsed.collapsed;
    if (parsed.alertFilter === "all" || parsed.alertFilter === "matched")
      alertFilter.value = parsed.alertFilter;
    if (Number.isFinite(Number(parsed.width)) && Number.isFinite(Number(parsed.height)))
      clampSize(Number(parsed.width), Number(parsed.height));
    if (Number.isFinite(Number(parsed.left)) && Number.isFinite(Number(parsed.top)))
      clampPos(Number(parsed.left), Number(parsed.top));
  }
  catch { /* ignore */ }
}

function savePos() {
  localStorage.setItem(POS_KEY, JSON.stringify({
    left: left.value,
    top: top.value,
    width: width.value,
    height: height.value,
    collapsed: collapsed.value,
    alertFilter: alertFilter.value,
  }));
}

function expandTable() {
  collapsed.value = false;
  left.value = MARGIN;
  top.value = MARGIN;
  clampSize(window.innerWidth - MARGIN * 2, window.innerHeight - MARGIN * 2);
  savePos();
}

function setAlertFilter(value: "all" | "matched") {
  alertFilter.value = value;
  savePos();
}

function onHeaderPointerDown(ev: PointerEvent) {
  if ((ev.target as HTMLElement | null)?.closest("button, .pod-follow-panel__resize"))
    return;
  dragging.value = true;
  dragDx = ev.clientX - left.value;
  dragDy = ev.clientY - top.value;
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
}

function onHeaderPointerMove(ev: PointerEvent) {
  if (!dragging.value)
    return;
  clampPos(ev.clientX - dragDx, ev.clientY - dragDy);
}

function onHeaderPointerUp(ev: PointerEvent) {
  if (!dragging.value)
    return;
  dragging.value = false;
  try {
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
  }
  catch { /* ignore */ }
  savePos();
}

function onResizePointerDown(ev: PointerEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  resizing.value = true;
  resizeStartX = ev.clientX;
  resizeStartY = ev.clientY;
  resizeStartW = width.value;
  resizeStartH = height.value;
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
}

function onResizePointerMove(ev: PointerEvent) {
  if (!resizing.value)
    return;
  clampSize(
    resizeStartW + (ev.clientX - resizeStartX),
    resizeStartH + (ev.clientY - resizeStartY),
  );
}

function onResizePointerUp(ev: PointerEvent) {
  if (!resizing.value)
    return;
  resizing.value = false;
  try {
    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
  }
  catch { /* ignore */ }
  savePos();
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  savePos();
}

function onWindowResize() {
  clampSize(width.value, height.value);
  clampPos(left.value, top.value);
}

function startUiClock() {
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
  nowTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, UI_TICK_MS);
}

async function refreshSportAmount() {
  try {
    sportAmount.value = await fetchObSportAmount();
  }
  catch {
    sportAmount.value = 0;
  }
}

function reloadBetSettings() {
  const next = readPodBetSettings();
  if (!next.autoPlace || !next.enabled
    || next.followAccountIds.join(",") !== betSettings.value.followAccountIds.join(","))
    resetPodMarketPrefetch();
  betSettings.value = next;
  followV2.value = readFootballFollowV2Settings();
  if (betSettings.value.autoPlace)
    requestAutoPlace();
  else
    autoRunRequested = false;
}

function openPodSettings() {
  openFootballSettings("pod");
}

function jumpToLog(row: PodFollowLogRow) {
  const venue = Object.values(row.venues || {}).find(record => record.matchId && record.fixtureId);
  if (venue) {
    requestPodBoardFocus({ matchId: venue.fixtureId, obMid: venue.obMid,
      marketCode: venue.marketCode, side: venue.side, line: venue.line, oid: venue.oid });
    return;
  }
  if (!row.obMid)
    return;
  requestPodBoardFocus({
    matchId: 0,
    obMid: row.obMid,
    marketCode: row.marketCode,
    side: row.boardSide,
    line: row.boardLine,
    oid: row.oid,
  });
}

function onClearLog() {
  logRows.value = clearPodFollowLog();
  placed.value = {};
  placeNote.value = {};
}

async function restoreAutoPlaceState() {
  autoReady.value = false;
  try {
    if (!accountStore.loaded)
      await accountStore.loadAccounts(false);
    const [, unifiedLoaded] = await Promise.all([
      footballOrders.loaded ? Promise.resolve() : footballOrders.load(),
      orderStore.fetchOrders(undefined, { sideEffects: false }),
    ]);
    if (!accountStore.loaded || !footballOrders.loaded || unifiedLoaded !== true)
      throw new Error("自动下注状态恢复未完成");
    refreshLog();
    placed.value = Object.fromEntries(logRows.value
      .filter(row => row.placed)
      .map(row => [venuePlaceKey("OB", row.id), true as const]));
    autoReady.value = true;
    requestAutoPlace();
  }
  catch {
    // 资金安全优先：恢复失败时保持禁用，等待页面重载或用户修复连接。
    autoReady.value = false;
  }
}

onMounted(() => {
  void refreshRayOrders();
  rayOrderTimer = setInterval(() => { void refreshRayOrders(); }, 15_000);
  autoRunnerStopped = false;
  left.value = Math.max(MARGIN, window.innerWidth - DEFAULT_W - 16);
  loadPos();
  store.start();
  reloadBetSettings();
  refreshLog();
  placed.value = Object.fromEntries(logRows.value
    .filter(row => row.placed)
    .map(row => [venuePlaceKey("OB", row.id), true as const]));
  window.addEventListener("resize", onWindowResize);
  window.addEventListener(POD_BET_SETTINGS_UPDATED, reloadBetSettings);
  stopMissSearch = subscribePodObMissSearch(() => {
    missTick.value += 1;
  });
  stopPrefetch = subscribePodMarketPrefetch(() => {
    prefetchTick.value += 1;
  });
  startUiClock();
  void restoreAutoPlaceState();
  void refreshSportAmount();
  amountTimer = setInterval(() => {
    void refreshSportAmount();
  }, 30_000);
});

onUnmounted(() => {
  if (rayOrderTimer) clearInterval(rayOrderTimer);
  autoRunnerStopped = true;
  autoRunRequested = false;
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener(POD_BET_SETTINGS_UPDATED, reloadBetSettings);
  stopMissSearch?.();
  stopPrefetch?.();
  stopMissSearch = null;
  stopPrefetch = null;
  resetPodObMissSearch();
  resetPodMarketPrefetch();
  store.stop();
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
  if (amountTimer) {
    clearInterval(amountTimer);
    amountTimer = null;
  }
});
</script>

<template>
  <div
    class="pod-follow-panel"
    :class="{ 'is-collapsed': collapsed, 'is-dragging': dragging || resizing }"
    :style="panelStyle"
  >
    <div
      class="pod-follow-panel__header"
      @pointerdown="onHeaderPointerDown"
      @pointermove="onHeaderPointerMove"
      @pointerup="onHeaderPointerUp"
      @pointercancel="onHeaderPointerUp"
    >
      <span class="pod-follow-panel__dot" :class="`is-${statusKind}`" />
      <span class="pod-follow-panel__title">POD 足球</span>
      <span class="pod-follow-panel__status">{{ statusText }}</span>
      <button type="button" class="pod-follow-panel__btn" @click="openPodSettings">
        设置
      </button>
      <button type="button" class="pod-follow-panel__btn" @click="toggleCollapsed">
        {{ collapsed ? "展开" : "收起" }}
      </button>
    </div>
    <div v-show="!collapsed" class="pod-follow-panel__summary" @pointerdown.stop>
      <span class="pod-follow-panel__summary-label">配置</span>
      <span class="pod-follow-panel__summary-text">{{ followSummary }}</span>
    </div>
    <div v-show="!collapsed" class="pod-follow-panel__columns">
      <section class="pod-follow-panel__column pod-follow-panel__column--alerts">
        <div class="pod-follow-panel__column-head">
          <div>
            <strong>POD 降赔</strong>
            <span>{{ visiblePodAlerts.length }}/{{ alerts.length }} · 匹配 {{ matchedAlertCount }}</span>
          </div>
          <div class="pod-follow-panel__filter" @pointerdown.stop>
            <button
              type="button"
              :class="{ 'is-active': alertFilter === 'all' }"
              @click="setAlertFilter('all')"
            >全部</button>
            <button
              type="button"
              :class="{ 'is-active': alertFilter === 'matched' }"
              @click="setAlertFilter('matched')"
            >仅已匹配</button>
          </div>
        </div>
        <div class="pod-follow-panel__column-body">
          <p v-if="!snapshot.sourceConnected" class="pod-follow-panel__hint">
            请在同一 Chrome 打开 pinnacleoddsdropper.com/terminal 的 Dropping Odds。
          </p>
          <p v-else-if="!snapshot.gridFound" class="pod-follow-panel__hint">
            已连接 POD，请切到 Alerts [Dropping odds]。
          </p>
          <p v-else-if="!alerts.length" class="pod-follow-panel__hint">
            已连接，暂无降赔信息。
          </p>
          <p v-else-if="!visiblePodAlerts.length" class="pod-follow-panel__hint">
            当前没有已匹配的降赔信息。
          </p>
          <div v-else class="pod-alert-list">
            <article
              v-for="alert in visiblePodAlerts"
              :key="alert.id"
              class="pod-alert-row"
              :class="{
                'is-fresh': isFreshPodAlert(alert.alertedAt, nowTick),
                'is-matched': podAlertMatched(alert.id),
                'is-jumpable': alertVenueMatches.get(alert.id)?.get('OB')?.fixture.status === 'matched',
              }"
              @click="onPodAlertClick(alert.id)"
            >
              <div class="pod-alert-row__top">
                <span class="pod-alert-row__drop">{{ formatPodDropPct(alert.dropPct) }}</span>
                <span class="pod-alert-row__match">{{ alert.home }} vs {{ alert.away }}</span>
                <span class="pod-alert-row__matched">{{ alertMatchStatuses.get(alert.id)?.label || "赛事未找到" }}</span>
              </div>
              <div class="pod-alert-row__meta">
                {{ alert.league }} · {{ formatPodPeriod(alert.period) }} · {{ formatPodOutcome(alert) }}
                <span v-if="alertMatchStatuses.get(alert.id)?.gateLabel"> · {{ alertMatchStatuses.get(alert.id)?.gateLabel }}</span>
              </div>
              <div class="pod-alert-row__prices">
                <span>{{ formatPodPrice(alert.previous) }} → {{ formatPodPrice(alert.current) }}</span>
                <span>NVP {{ formatPodPrice(alert.nvp) }}</span>
                <span>{{ formatPodAgo(alert.alertedAt, nowTick) }}</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section class="pod-follow-panel__column pod-follow-panel__column--follow">
        <div class="pod-follow-panel__column-head">
          <div>
            <strong>POD 跟单明细</strong>
            <span>{{ displayRows.length }} 条</span>
          </div>
          <button type="button" class="pod-follow-panel__btn" @pointerdown.stop @click="expandTable">宽屏</button>
          <button
            v-if="logRows.length"
            type="button"
            class="pod-follow-panel__btn"
            @pointerdown.stop
            @click="onClearLog"
          >清空</button>
        </div>
        <div class="pod-follow-panel__body">
          <p v-if="!betSettings.enabled" class="pod-follow-panel__hint">
        跟单筛选已关。左侧降赔信息仍会正常显示；开启后右侧会标记已下/未下。
      </p>
      <template v-else>
        <p v-if="!snapshot.sourceConnected && !displayRows.length" class="pod-follow-panel__hint">
          等 POD 连通后，对上场和盘的会进来并一直留下。冷票保护只挡自动。
        </p>
        <p v-else-if="!displayRows.length" class="pod-follow-panel__hint">
          还没有跟单机会。对上足球板的场和盘才会进来，并标有没有下单。
        </p>
        <PodFollowTable
          :rows="displayRows" :now="nowTick"
          :show-diagnostics="followV2.showDiagnostics"
          empty-text="还没有跟单机会。匹配到比赛和盘口后显示在这里。" @locate="onDisplayClick"
        >
          <template #diagnostics="{ row }">
            <div v-if="row.live?.fixtureMatch.status === 'matched'" class="pod-follow-row__diag"
              :class="`is-${decisionShadowTone(row.live)}`" :title="decisionShadowTitle(row.live)">
              OB 诊断 {{ decisionShadowText(row.live) }}
            </div>
          </template>
          <template #actions="{ row }">
            <template v-if="row.live">
              <button v-if="row.live.fixtureMatch.status === 'matched' && !isVenuePlaced(row.live.id, 'OB') && followObEnabled" type="button" class="pod-follow-row__place"
                :disabled="!!placeBlock(row.live) || placingId === row.live.id" :title="placeButtonTitle(row.live)"
                @click="onPlaceClick($event, row.live)">OB · {{ placeLabel(row.live) }}</button>
              <button v-if="row.live.rayFixtureMatch.status === 'matched' && followRayEnabled" type="button" class="pod-follow-row__place"
                :disabled="!!rayPlaceBlock(row.live) || placingRayId === row.live.id"
                :title="rayPlaceBlock(row.live) || undefined" @click="onRayPlaceClick($event, row.live)">
                {{ isVenuePlaced(row.live.id, 'RAY') ? 'RAY已提交' : placingRayId === row.live.id ? 'RAY中' : '下RAY' }}
              </button>
              <button v-if="row.live.pmFixtureMatch.status === 'matched' && !isVenuePlaced(row.live.id, 'Polymarket') && followPmEnabled" type="button" class="pod-follow-row__place"
                :disabled="!!pmPlaceBlock(row.live) || placingPmId === row.live.id" :title="pmPlaceButtonTitle(row.live)"
                @click="onPmPlaceClick($event, row.live)">{{ pmPlaceLabel(row.live) }}</button>
            </template>
          </template>
        </PodFollowTable>
          </template>
        </div>
      </section>
    </div>
    <button
      v-show="!collapsed"
      type="button"
      class="pod-follow-panel__resize"
      aria-label="缩放面板"
      @pointerdown="onResizePointerDown"
      @pointermove="onResizePointerMove"
      @pointerup="onResizePointerUp"
      @pointercancel="onResizePointerUp"
    />
  </div>
</template>

<style scoped>
.pod-follow-panel {
  position: fixed;
  z-index: 1890;
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 16px);
  color: #e8edf4;
  background: #14110ee6;
  border: 1px solid #f59e0b33;
  border-radius: 10px;
  box-shadow: 0 12px 40px #00000073;
  backdrop-filter: blur(10px);
  user-select: none;
  overflow: hidden;
}

.pod-follow-panel.is-dragging {
  opacity: 0.92;
}

.pod-follow-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  flex: 0 0 40px;
  padding: 0 10px 0 12px;
  cursor: grab;
  border-bottom: 1px solid #ffffff14;
}

.pod-follow-panel.is-collapsed .pod-follow-panel__header {
  border-bottom: 0;
}

.pod-follow-panel__header:active {
  cursor: grabbing;
}

.pod-follow-panel__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ffffff66;
  flex-shrink: 0;
}

.pod-follow-panel__dot.is-ok {
  background: #f59e0b;
  box-shadow: 0 0 8px #f59e0bcc;
}

.pod-follow-panel__dot.is-wait {
  background: #e6a23c;
  box-shadow: 0 0 8px #e6a23ccc;
}

.pod-follow-panel__title {
  font-size: 13px;
  font-weight: 700;
}

.pod-follow-panel__status {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pod-follow-panel__btn {
  border: 0;
  background: transparent;
  color: #cbd5e1;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
}

.pod-follow-panel__btn:hover {
  color: #fff;
}

.pod-follow-panel__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 40px;
  padding: 6px 10px;
  border-bottom: 1px solid #ffffff14;
  font-size: 12px;
  color: #cbd5e1;
}

.pod-follow-panel__summary-label {
  flex-shrink: 0;
  font-weight: 600;
}

.pod-follow-panel__summary-text {
  color: #94a3b8;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pod-follow-panel__columns {
  display: grid;
  grid-template-columns: minmax(230px, 0.32fr) minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
}

.pod-follow-panel__column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pod-follow-panel__column--alerts {
  border-right: 1px solid #ffffff18;
  background: #0f172a33;
}

.pod-follow-panel__column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 38px;
  min-width: 0;
  padding: 0 10px;
  border-bottom: 1px solid #ffffff14;
  color: #e2e8f0;
  font-size: 12px;
}

.pod-follow-panel__column-head > div:first-child {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.pod-follow-panel__column-head strong {
  white-space: nowrap;
}

.pod-follow-panel__column-head span {
  color: #94a3b8;
  white-space: nowrap;
}

.pod-follow-panel__column-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.pod-follow-panel__filter {
  display: inline-flex;
  flex-shrink: 0;
  padding: 2px;
  border: 1px solid #ffffff1f;
  border-radius: 6px;
  background: #02061766;
}

.pod-follow-panel__filter button {
  padding: 3px 7px;
  border: 0;
  border-radius: 4px;
  color: #94a3b8;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.pod-follow-panel__filter button.is-active {
  color: #fff;
  background: #2563eb;
}

.pod-alert-list {
  display: flex;
  flex-direction: column;
}

.pod-alert-row {
  padding: 10px 12px;
  border-bottom: 1px solid #ffffff0f;
}

.pod-alert-row.is-fresh {
  background: #67c23a12;
}

.pod-alert-row.is-matched {
  box-shadow: inset 3px 0 #60a5fa;
}

.pod-alert-row.is-jumpable {
  cursor: pointer;
}

.pod-alert-row.is-jumpable:hover {
  background: #ffffff0b;
}

.pod-alert-row__top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pod-alert-row__drop {
  flex-shrink: 0;
  color: #4ade80;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pod-alert-row__match {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #f1f5f9;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pod-alert-row__matched {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  color: #94a3b8 !important;
  background: #ffffff0d;
  font-size: 10px;
}

.pod-alert-row.is-matched .pod-alert-row__matched {
  color: #bfdbfe !important;
  background: #2563eb33;
}

.pod-alert-row__meta,
.pod-alert-row__prices {
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
}

.pod-alert-row__prices {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-variant-numeric: tabular-nums;
}

.pod-follow-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 760px) {
  .pod-follow-panel__columns {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(150px, 0.8fr) minmax(180px, 1.2fr);
  }

  .pod-follow-panel__column--alerts {
    border-right: 0;
    border-bottom: 1px solid #ffffff18;
  }
}

.pod-follow-panel__toolbar {
  display: flex;
  justify-content: flex-end;
  flex: 0 0 auto;
  padding: 4px 6px 0;
}

.pod-follow-panel__hint {
  margin: 0;
  padding: 14px 14px 16px;
  font-size: 12px;
  line-height: 1.55;
  color: #cbd5e1;
}

.pod-follow-row__diag {
  margin-top: 4px;
  font-size: 10px;
  color: #94a3b8;
  opacity: 0.78;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pod-follow-row__diag.is-ok {
  color: #86efac;
}

.pod-follow-row__diag.is-wait {
  color: #7dd3fc;
}

.pod-follow-row__diag.is-block {
  color: #fb923c;
}

.pod-follow-venue-note {
  margin-top: 6px;
  color: #cbd5e1;
  white-space: normal;
  overflow-wrap: anywhere;
}

.pod-follow-row__place {
  padding: 2px 8px;
  border: 1px solid #f59e0b99;
  border-radius: 999px;
  background: #f59e0b22;
  color: #fde68a;
  font-size: 11px;
  cursor: pointer;
}

.pod-follow-row__place:hover:not(:disabled) {
  background: #f59e0b44;
}

.pod-follow-row__place:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pod-follow-panel__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 0 0 10px 0;
  background:
    linear-gradient(135deg, transparent 0 55%, #ffffff55 55% 62%, transparent 62% 72%, #ffffff55 72% 79%, transparent 79%);
  cursor: nwse-resize;
}
</style>
