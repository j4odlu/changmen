import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { ViewMatch } from "@/models/match";
import { startSportLiveOddsSession } from "@/runtime/sportLiveOdds";
import { useObSportLiveStore } from "@/stores/obSportLiveStore";

const ws = vi.hoisted(() => ({ handicap: (_row: { mid: string }) => {} }));
vi.mock("@/runtime/obSportWs", () => ({
  isObSportC8Mid: () => true,
  startObSportWs: (_session: unknown, callbacks: typeof ws & { onHandicapPlay: typeof ws.handicap }) => {
    ws.handicap = callbacks.onHandicapPlay;
    return { sync: vi.fn(), stop: vi.fn() };
  },
}));
vi.mock("@/runtime/obSportSessionLocal", () => ({ readLocalSportObSession: () => null }));
vi.mock("@/stores/footballOrderStore", () => ({ useFootballOrderStore: () => ({ applyVenueStatus: vi.fn(), syncVenueSettlementSoon: vi.fn() }) }));
vi.mock("@changmen/venue-adapter/ray", () => ({ createRayRealtimeClient: () => ({ start: async () => {}, stop: async () => {} }) }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({
  onPolymarketSportHubBound: () => () => {}, onPolymarketSportQuote: () => () => {},
  setPolymarketSportAssetIds: vi.fn(), ensurePolymarketSportMarketConnection: vi.fn(), clearPolymarketSportHub: vi.fn(),
}));
vi.mock("@changmen/venue-adapter/predictfun", () => ({
  onPredictFunSportHubBound: () => () => {}, onPredictFunSportQuote: () => () => {}, setPredictFunSportMarketIds: vi.fn(),
}));

beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => vi.useRealTimers());

it("refreshes list structure on a known match's handicap change, throttles repeats, and stops on unmount", () => {
  const match = { startAt: 200000, providers: { OB: "5505659" }, bets: [] } as unknown as ViewMatch;
  const session = startSportLiveOddsSession(() => [match], { patchMatchFallback: false });
  const live = useObSportLiveStore();
  const initial = live.listRev;
  ws.handicap({ mid: "5505659" });
  expect(live.listRev).toBe(initial + 1);
  ws.handicap({ mid: "5505659" });
  expect(live.listRev).toBe(initial + 1);
  vi.advanceTimersByTime(8000);
  ws.handicap({ mid: "5505659" });
  expect(live.listRev).toBe(initial + 2);
  session.stop();
  const stopped = live.listRev;
  ws.handicap({ mid: "5505659" });
  expect(live.listRev).toBe(stopped);
});
