import "./vitestPolyfillLocalStorage";
import "./vitestSetupFokWebSocket";
import { vi } from "vitest";
import { toFixed } from "@changmen/client-core/shared/format";
import { registerOddsAccess } from "@changmen/client-core/bridge/oddsAccess";
import { useOddsStore } from "@/stores/oddsStore";

function withOddsStore<T>(run: (odds: ReturnType<typeof useOddsStore>) => T, fallback: T): T {
  try {
    return run(useOddsStore());
  }
  catch {
    return fallback;
  }
}

/** vitest 全局：ViewBetItem.getOdds → client-core odds 桥接 → useOddsStore（单测可先 createPinia 再读写 fo） */
registerOddsAccess({
  read: (provider, itemId, fallback) =>
    withOddsStore(odds => odds.getOdds(provider, itemId, fallback) || 0, fallback || 0),
  save: (platform, entry, source = "http") => {
    withOddsStore(odds => {
      const marketIdRaw = entry.marketId;
      const marketId = marketIdRaw != null && String(marketIdRaw).trim()
        ? String(marketIdRaw).trim()
        : undefined;
      odds.save(platform, {
        id: entry.id,
        odds: Number(toFixed(entry.odds)),
        isLock: entry.isLock,
        betId: entry.betId,
        side: entry.side,
        time: entry.time ?? Date.now(),
        clobPrice: entry.clobPrice,
        marketId,
      }, source);
    }, undefined);
  },
  clean: platform => withOddsStore(odds => odds.clean(platform), undefined),
  isOdds: (platform, oddsId) => withOddsStore(odds => odds.isOdds(platform, oddsId), false),
  getEntry: (platform, oddsId) => withOddsStore(odds => odds.getEntry(platform, oddsId), undefined),
  updateOddsLock: (platform, oddsId, locked) =>
    withOddsStore(odds => odds.updateOddsLock(platform, oddsId, locked), undefined),
  updateBetLock: (platform, betId, locked) =>
    withOddsStore(odds => odds.updateBetLock(platform, betId, locked), undefined),
  updateMessage: (platform, payload) =>
    withOddsStore(odds => odds.updateMessage(platform, payload), undefined),
  getLimit: (platform, oddsId) => withOddsStore(odds => odds.getLimit(platform, oddsId), undefined),
  setLimit: (platform, oddsId, value, payout, ttlSec) =>
    withOddsStore(odds => odds.setLimit(platform, oddsId, value, payout, ttlSec), undefined),
});

// 避免 clientApi 桥接在采集单测里抛错（各文件可 vi.mock 覆盖）
vi.mock("@changmen/client-core/bridge/clientApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@changmen/client-core/bridge/clientApi")>();
  return {
    ...actual,
    getCollectPlatform: vi.fn().mockResolvedValue(null),
    getGames: vi.fn().mockResolvedValue([]),
    saveLiveTimer: vi.fn().mockResolvedValue(undefined),
    updatePlatform: vi.fn().mockResolvedValue(undefined),
    getHgFollowOrders: vi.fn().mockResolvedValue([]),
    saveUserLog: vi.fn().mockResolvedValue(undefined),
  };
});
