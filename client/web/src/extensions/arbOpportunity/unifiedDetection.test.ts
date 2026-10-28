import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSSRApp, h, reactive, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { detectArbLegs, detectOpportunities } from "@changmen/arb-core";
import { providerKeysFromBetItems } from "@changmen/arb-core/providerKeys";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { buildOrderOptions } from "@/domain/betting/buildOrderOptions";
import { useBetRowArbUi } from "@/extensions/arbBet/ui/useBetRowArbUi";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

function fixture() {
  const prices = reactive({ pb: [2.1, 1.4], best: [2.4, 1.4], ray: [1.4, 2.2], ob: [1.4, 2.5] });
  const item = (type: ViewBetItem["type"], key: keyof typeof prices) => ({
    type, matchId: key, betId: key, homeId: `${key}-h`, awayId: `${key}-a`,
    getItemId(side: BetSide) { return side === "Home" ? this.homeId : this.awayId; },
    getOdds(side: BetSide) { return prices[key][side === "Home" ? 0 : 1]!; },
  } as ViewBetItem);
  const bet = reactive({ id: 1, items: [item("PB", "pb"), item("PB", "best"), item("RAY", "ray"), item("OB", "ob")],
    getBetName: () => "全场胜方" } as ViewBet);
  const match = { id: 100, title: "A vs B", game: "英雄联盟", bets: [bet] } as ViewMatch;
  return { prices, bet, match };
}

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(useUserStore().config, { betting: false, profit: 1.01, maxProfit: 2, minOdds: 1.01 });
  vi.spyOn(useAccountStore(), "getProviders").mockReturnValue(new Map([["PB", []], ["RAY", []], ["OB", []]]));
});
afterEach(() => vi.restoreAllMocks());

async function mountUi(match: ViewMatch, bet: ViewBet) {
  const enabled = ref(true);
  let ui!: ReturnType<typeof useBetRowArbUi>;
  await renderToString(createSSRApp({ setup() {
    ui = useBetRowArbUi(match, bet, enabled);
    return () => h("div");
  } }));
  return { ui, enabled };
}

describe("unified arb detection", () => {
  it("shares exact selection and quote snapshots across scanning, order building and line projection", async () => {
    const { match, bet } = fixture();
    const user = useUserStore();
    const accounts = useAccountStore().accounts;
    const keys = providerKeysFromBetItems(bet);
    const detection = detectArbLegs(bet, user.config, keys, accounts, match.game)!;
    const { ui } = await mountUi(match, bet);
    expect(ui.detection.value).toBe(detection);
    const [opportunity] = detectOpportunities({ matches: [match], config: user.config, accounts }, "fullMarket");
    expect(opportunity).toMatchObject({ homeItemId: "best-h", awayItemId: "ob-a",
      homeOdds: detection.homeOdds, awayOdds: detection.awayOdds, implied: detection.implied });
    const options = buildOrderOptions(bet, match, user.config, accounts, keys,
      { getEntry: () => undefined, getPmQuoteEntry: () => undefined });
    expect(options?.find(o => o.target === "Home")?.itemId).toBe(detection.homeItemId);
    expect(options?.find(o => o.target === "Away")?.itemId).toBe(detection.awayItemId);
    expect(ui.isArbLeg(bet.items[0]!, "Home")).toBe(false);
    expect(ui.isArbLeg(bet.items[1]!, "Home")).toBe(true);
  });

  it("keeps funded whitelist scope when betting is toggled and hides unfunded combinations", async () => {
    const { match, bet } = fixture();
    const user = useUserStore();
    const account = useAccountStore();
    const funding = vi.mocked(account.getProviders);
    user.extensionPrefs.arbAllowedPlatforms = ["PB", "RAY"];
    user.config.betting = true;
    const { ui } = await mountUi(match, bet);
    expect(ui.detection.value).toBe(detectArbLegs(bet, user.config, ["PB", "RAY"], account.accounts, match.game));
    expect(ui.detection.value?.awayItemId).toBe("ray-a");
    user.config.betting = false;
    expect(ui.detection.value?.awayItemId).toBe("ray-a");
    funding.mockReturnValue(new Map([["PB", []]]));
    // getProviders mock 本身非响应式；配置变化触发与真实余额写入相同的重读。
    user.config.betMoney += 1;
    expect(ui.detection.value).toBeUndefined();
    user.config.betting = true;
    expect(ui.detection.value).toBeUndefined();
    expect(detectOpportunities({ matches: [match], config: user.config }, "fullMarket")[0]?.awayItemId).toBe("ob-a");
  });

  it("invalidates immediately on prices, locks, selection IDs and profit overrides, without rewriting past snapshots", async () => {
    const { match, bet, prices } = fixture();
    const user = useUserStore();
    const { ui, enabled } = await mountUi(match, bet);
    const first = ui.detection.value!;
    prices.ob[1] = 1.4;
    expect(ui.detection.value?.awayItemId).toBe("ray-a");
    expect(first.awayOdds).toBe(2.5);
    bet.items[1]!.homeId = "replacement-h";
    expect(ui.detection.value?.homeItemId).toBe("replacement-h");
    prices.ray[1] = 0;
    prices.pb[1] = prices.best[1] = prices.ob[1] = 0;
    expect(ui.detection.value).toBeUndefined();
    prices.ray[1] = 2.2;
    const keys = providerKeysFromBetItems(bet);
    const overrides = [{ provider: "RAY" as const, profit: 2 }];
    expect(detectArbLegs(bet, user.config, keys, overrides)).toBeUndefined();
    overrides[0]!.profit = 0;
    expect(detectArbLegs(bet, user.config, keys, overrides)).toBeDefined();
    enabled.value = false;
    expect(ui.detection.value).toBeNull();
  });
});
