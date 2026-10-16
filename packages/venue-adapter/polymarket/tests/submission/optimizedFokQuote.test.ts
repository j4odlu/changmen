import { beforeEach, expect, test, vi } from "vitest";
import { getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { optimizedFokQuoteBlock } from "../../submission/preflight/optimized/pmExecutableQuote";
vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({ getVenueOddsEntry: vi.fn() }));
beforeEach(() => vi.mocked(getVenueOddsEntry).mockReset());
test.each([
  [99, .6, false, false], [100, .6, false, false], [101, .6, false, true],
  [101, .5, false, false], [101, .4, false, false], [101, .4, true, true],
  [99, .4, true, true], [100, .4, true, true],
])("quote time %s ask %s lock %s blocks=%s", (time, clobPrice, isLock, blocked) => {
  vi.mocked(getVenueOddsEntry).mockReturnValue({ id: "a", odds: 2, time, clobPrice, isLock });
  expect(Boolean(optimizedFokQuoteBlock("a", .5, 100))).toBe(blocked);
});
test("missing data does not invent liquidity or block a valid book", () => {
  expect(optimizedFokQuoteBlock("a", .5, 100)).toBeNull();
});
