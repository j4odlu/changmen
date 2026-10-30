import type { PlaceValueBetParams } from "./placeValueBet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { valueBetCalcOptsFromPrefs } from "@/extensions/valueBet/evConfig";
import { placeValueBetOrder } from "./placeValueBet";

const mocks = vi.hoisted(() => ({
  prefs: { pmMaxOverroundPct: 6 },
  checkBetting: vi.fn(),
  betting: vi.fn(),
  account: { getBalance: () => 1000 },
}));

vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ extensionPrefs: { valueBet: mocks.prefs } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({
  getAccount: () => mocks.account, checkBetting: mocks.checkBetting, betting: mocks.betting,
}) }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({}) }));
vi.mock("@/domain/betting/betFilters", () => ({ accountPassesMainBetFilter: () => true }));
vi.mock("@/domain/betting/singleLegRate", () => ({ isSingleLegRateAtOdds: () => false }));
vi.mock("@/extensions/mapBetMute", () => ({ isMapMuteActive: () => false }));
vi.mock("@/extensions/prematchFullOnly", () => ({ isPrematchFullMarketAllowed: () => true }));
vi.mock("@/extensions/valueBet/valueBetMapCount", () => ({ getValueBetMapCount: () => 0, recordValueBetMapFill: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ bindArbLegOrder: vi.fn(), refreshOrderListAfterBind: vi.fn() }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: vi.fn() }));
vi.mock("@changmen/client-core/models/betOption", () => ({ BetOption: class { odds = 0; data = {}; } }));

function params(): PlaceValueBetParams {
  const pm = { type: "Polymarket", getOdds: () => 1.9 };
  const ray = { type: "RAY", getOdds: (side: string) => side === "Home" ? 2.2 : 1.7 };
  return {
    match: { id: 1, liveRound: 0 } as never,
    bet: { id: 1, round: 0, items: [pm, ray] } as never,
    item: ray as never,
    side: "Home",
    amount: 10,
    calcOpts: valueBetCalcOptsFromPrefs({ sharp: "Polymarket", pmMaxOverroundPct: 6 }),
    minEdge: 0.03,
  };
}

describe("PM baseline validation before placing EV orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefs.pmMaxOverroundPct = 6;
    mocks.checkBetting.mockImplementation(async (_account, option) => option);
    // No test submits a real order, even when a valid candidate reaches this mock.
    mocks.betting.mockResolvedValue({ success: false });
  });

  it("rejects a pending confirmation after the user tightens the PM limit", async () => {
    const pending = params();
    mocks.prefs.pmMaxOverroundPct = 3;
    expect(await placeValueBetOrder(pending)).toMatchObject({ ok: false, code: "gone" });
    expect(mocks.checkBetting).not.toHaveBeenCalled();
    expect(mocks.betting).not.toHaveBeenCalled();
  });

  it("rechecks the current limit after asynchronous platform preflight", async () => {
    mocks.checkBetting.mockImplementation(async (_account, option) => {
      mocks.prefs.pmMaxOverroundPct = 3;
      return option;
    });
    expect(await placeValueBetOrder(params())).toMatchObject({ ok: false, code: "gone" });
    expect(mocks.checkBetting).toHaveBeenCalledOnce();
    expect(mocks.betting).not.toHaveBeenCalled();
  });

  it("allows valid PM quotes through preflight at the configured limit", async () => {
    expect(await placeValueBetOrder(params())).toMatchObject({ ok: false, code: "place_fail" });
    expect(mocks.checkBetting).toHaveBeenCalledOnce();
    expect(mocks.betting).toHaveBeenCalledOnce();
  });

  it("does not apply the PM limit to a PB baseline", async () => {
    const input = params();
    input.bet.items[0]!.type = "PB";
    input.calcOpts = valueBetCalcOptsFromPrefs({ sharp: "PB" });
    mocks.prefs.pmMaxOverroundPct = 0;
    expect(await placeValueBetOrder(input)).toMatchObject({ ok: false, code: "place_fail" });
    expect(mocks.betting).toHaveBeenCalledOnce();
  });
});
