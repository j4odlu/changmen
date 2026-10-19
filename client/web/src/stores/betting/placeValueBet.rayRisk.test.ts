import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ray from "@changmen/venue-adapter/ray";
import { placeValueBetOrder, type PlaceValueBetParams } from "./placeValueBet";
import { collectValueBetAutoCandidates } from "@/extensions/valueBet/valueBetAutoBet";
import { valueBetCalcOptsFromPrefs } from "@/extensions/valueBet/evConfig";
import { resetMapBetMuteForTests } from "@/extensions/mapBetMute";
import { resetPrematchFullOnlyForTests } from "@/extensions/prematchFullOnly";

const mocks = vi.hoisted(() => ({ check: vi.fn(), betting: vi.fn(), mark: vi.fn(), bind: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({
  getAccount: () => ({ provider: "RAY", rate: 1, getBalance: () => 1000 }),
  checkBetting: mocks.check, betting: mocks.betting,
}) }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({}) }));
vi.mock("@/domain/betting/betFilters", () => ({ accountPassesMainBetFilter: () => true }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.mark }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbLegOrder: mocks.bind, refreshOrderListAfterBind: vi.fn() }));

function params(): PlaceValueBetParams {
  const item = { type: "RAY", matchId: "ray", betId: "group", getItemId: () => "odds", getOdds: () => 2.2 };
  const sharp = { type: "PB", getOdds: () => 1.95 };
  const bet = { id: 10, round: 1, items: [sharp, item] };
  return { match: { id: 1, liveRound: 0, bets: [bet] }, bet, item, side: "Home", amount: 10,
    minEdge: 0.03, silent: true, calcOpts: valueBetCalcOptsFromPrefs({ sharp: "PB" }) } as unknown as PlaceValueBetParams;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(ray, "isRayMatchRiskClosed").mockReturnValue(false);
  resetMapBetMuteForTests(); resetPrematchFullOnlyForTests();
  mocks.check.mockImplementation(async (_account, option) => { option.data = {}; return option; });
  mocks.betting.mockResolvedValue({ success: false, message: "test venue response" });
});

describe("RAY match closure across EV scanning and submission", () => {
  it("excludes the entire closed match before calculating EV and preserves the normal candidate", () => {
    const closed = params().match; const normal = { ...params().match, id: 2 };
    const odds = vi.spyOn(closed.bets[0]!.items[0]!, "getOdds");
    vi.mocked(ray.isRayMatchRiskClosed).mockImplementation(match => match.id === closed.id);
    const rows = collectValueBetAutoCandidates([closed, normal], valueBetCalcOptsFromPrefs({ sharp: "PB" }),
      { enabled: true, minEdgePct: 3, maxEdgePct: 20, minOdds: 1.3, maxOdds: 10, maxPerMap: 1 },
      { isMuted: () => false, mapCount: () => 0, isCooling: () => false });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.match.id === 2)).toBe(true);
    expect(odds).not.toHaveBeenCalled();
    expect(closed.bets).toHaveLength(1);
  });

  it.each(["entry", "precheck"])("blocks a stale EV request closed at %s", async phase => {
    if (phase === "entry") vi.mocked(ray.isRayMatchRiskClosed).mockReturnValue(true);
    else mocks.check.mockImplementationOnce(async (_account, option) => {
      option.data = {}; vi.mocked(ray.isRayMatchRiskClosed).mockReturnValue(true); return option;
    });
    expect(await placeValueBetOrder(params())).toMatchObject({ ok: false, code: "muted" });
    expect(mocks.betting).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.check).toHaveBeenCalledTimes(phase === "entry" ? 0 : 1);
  });

  it("keeps a normal EV request's amount, odds and single venue submission", async () => {
    expect(await placeValueBetOrder(params())).toMatchObject({ ok: false, code: "place_fail", message: "test venue response" });
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.betting).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ betMoney: 10, odds: 2.2 }), 0);
  });
});
