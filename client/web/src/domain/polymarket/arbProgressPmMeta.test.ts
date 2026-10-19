import { BetOption as BetOptionClass } from "@changmen/client-core/models/betOption";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPolymarketArbProgressMeta } from "@/domain/polymarket/arbProgressPmMeta";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";

const getEntry = vi.hoisted(() => vi.fn());

vi.mock("@/stores/oddsStore", () => ({
  useOddsStore: () => ({ getEntry }),
}));

describe("buildPolymarketArbProgressMeta", () => {
  beforeEach(() => {
    getEntry.mockReset();
  });

  it("prefers fo clob over odds fallback", () => {
    getEntry.mockReturnValue({ clobPrice: 0.68 });
    const option = new BetOptionClass(
      PLATFORMS.Polymarket,
      "m1",
      "b1",
      "74711611114983512613640395677280477708501472242194933077402249873861095364481",
      35,
      "Home",
      1.47,
    );
    option.data = { detectionClobPrice: 0.68 };

    const meta = buildPolymarketArbProgressMeta(option);

    expect(meta.detectionMaxPrice).toBe(0.68);
    expect(meta.capSource).toBe("clob");
    expect(meta.tokenShort).toContain("747116");
  });

  it("includes book ask after successful precheck", () => {
    getEntry.mockReturnValue({ clobPrice: 0.68 });
    const option = new BetOptionClass(PLATFORMS.Polymarket, "m1", "b1", "1234567890", 35, "Away", 1.47);
    option.data = {
      detectionOdds: 1.47,
      detectionMaxPrice: 0.68,
      detectionClobPrice: 0.68,
      bookPrice: 0.681,
      apiBetMoney: 35.5,
    };

    const meta = buildPolymarketArbProgressMeta(option);

    expect(meta.bookPrice).toBe(0.681);
    expect(meta.apiBetMoney).toBe(35.5);
    expect(meta.capSource).toBe("locked");
  });
});
