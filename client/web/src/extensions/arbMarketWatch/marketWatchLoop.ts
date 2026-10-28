import type { DetectOpportunitiesParams } from "@changmen/arb-core/opportunity/detect";
import type { OpportunityTransition } from "@changmen/arb-core/opportunity/state";
import type { ArbOpportunity, OpportunityKey } from "@changmen/arb-core/opportunity/types";
import type { ViewMatch } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import type { UserConfig } from "@/types/userConfig";
import type { ArbProfitAccount } from "@changmen/arb-core";
import { deliverMarketWatchSink } from "@/extensions/arbMarketWatch/watchSinks";
import { detectOpportunities } from "@changmen/arb-core/opportunity/detect";
import {
  diffOpportunities,

  snapshotOpportunities,
} from "@changmen/arb-core/opportunity/state";
import { useAccountStore } from "@/stores/accountStore";
import { useMatchStore } from "@/stores/matchStore";
import { useOddsStore } from "@/stores/oddsStore";
import { useUserStore } from "@/stores/userStore";
import { filterArbProviderKeys } from "@/types/extensionPrefs";

export const MARKET_WATCH_LOOP_DEBOUNCE_MS = 250;
export const MARKET_WATCH_LOOP_FALLBACK_MS = 5_000;

export interface MarketWatchLoopTickInput {
  snapshot: Map<OpportunityKey, ArbOpportunity>;
  matches: ViewMatch[];
  config: UserConfig;
  accounts?: ArbProfitAccount[];
  actionablePlatforms?: Iterable<PlatformId>;
}

export interface MarketWatchLoopTickResult {
  snapshot: Map<OpportunityKey, ArbOpportunity>;
  transitions: OpportunityTransition[];
}

/** 单拍：fullMarket detect → diff */
export function runMarketWatchLoopTick(input: MarketWatchLoopTickInput): MarketWatchLoopTickResult {
  const detectParams: DetectOpportunitiesParams = {
    matches: input.matches,
    config: input.config,
    accounts: input.accounts,
    actionablePlatforms: input.actionablePlatforms,
  };
  const current = detectOpportunities(detectParams, "fullMarket");
  return {
    snapshot: snapshotOpportunities(current),
    transitions: diffOpportunities(input.snapshot, current),
  };
}

let activeLoop: { stop: () => void } | null = null;

/** [changmen 扩展] 全盘口盯盘旁路（关买入 + notifyArbOpportunity 时按需启动） */
export function startMarketWatchLoop(): void {
  stopMarketWatchLoop();

  let snapshot = new Map<OpportunityKey, ArbOpportunity>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const runTick = () => {
    if (stopped)
      return;

    const user = useUserStore();
    const accountStore = useAccountStore();
    const matchStore = useMatchStore();
    const config = user.config;
    const detectParams: DetectOpportunitiesParams = {
      matches: [],
      config,
      accounts: accountStore.accounts,
      actionablePlatforms: filterArbProviderKeys([...accountStore.getProviders().keys()], user.extensionPrefs.arbAllowedPlatforms),
    };

    const matches = user.userId && matchStore.matchs.length ? matchStore.matchs : [];
    detectParams.matches = matches;

    // 无用户或列表未就绪：静默清快照，避免误发「机会结束」
    if (!matches.length) {
      snapshot = new Map();
      return;
    }

    const result = runMarketWatchLoopTick({
      snapshot,
      matches,
      config,
      accounts: detectParams.accounts,
      actionablePlatforms: detectParams.actionablePlatforms,
    });
    snapshot = result.snapshot;

    deliverMarketWatchSink(result.transitions, snapshot, detectParams);
  };

  const scheduleDebounced = () => {
    if (stopped)
      return;
    if (debounceTimer)
      clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runTick();
    }, MARKET_WATCH_LOOP_DEBOUNCE_MS);
  };

  const oddsStore = useOddsStore();
  // 旁路盯盘：订阅 store mutation（含 data/lock），250ms debounce 合并；勿绑 UI 全局 foRevision
  const unsubscribeOdds = oddsStore.$subscribe(() => {
    scheduleDebounced();
  });

  const fallbackInterval = setInterval(runTick, MARKET_WATCH_LOOP_FALLBACK_MS);
  scheduleDebounced();

  activeLoop = {
    stop: () => {
      stopped = true;
      if (debounceTimer)
        clearTimeout(debounceTimer);
      clearInterval(fallbackInterval);
      unsubscribeOdds();
      activeLoop = null;
    },
  };
}

export function stopMarketWatchLoop(): void {
  activeLoop?.stop();
}
