import { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, expect, it, vi } from "vitest";
import { checkBetting, prepareOtherLeg } from "./gateway";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), check: vi.fn(), place: vi.fn() }));
vi.mock("@/runtime/providers", () => ({ getProvider: mocks.provider }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ checkBetting: mocks.check, betting: mocks.place }) }));
const account = { provider: "RAY", accountId: 2 } as PlatformAccount;
const option = () => {
  const input = new BetOption("RAY", "match", "bet", "item", 100, "Away", 2.26);
  input.data = { odds: 2.26 }; input.diagnosticAttempt = "initial";
  return input;
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.provider.mockReturnValue({ betting: vi.fn() });
  mocks.check.mockImplementation(async (_account, input) => input);
});

it("checks counterpart support before dispatch and uses the common gateway with the original link and wait", async () => {
  const result = { success: true, orderId: "ray-order" };
  const input = option(); mocks.place.mockResolvedValue(result);
  const submit = prepareOtherLeg(account, input, 3, 30);
  expect(mocks.provider).toHaveBeenCalledOnce(); expect(mocks.place).not.toHaveBeenCalled();
  expect(await submit()).toBe(result);
  expect(mocks.place).toHaveBeenCalledExactlyOnceWith(account, input, 30, { linkId: 3, requirePreparedQuote: true });
  expect(input.deferPostAcceptSettlement).toBe(true);
});
it("an unsupported counterpart fails during preparation before any POST", () => {
  mocks.provider.mockReturnValueOnce(null);
  expect(() => prepareOtherLeg(account, option(), 3)).toThrow("平台不支持");
  expect(mocks.place).not.toHaveBeenCalled();
});
it("missing or inconsistent frozen precheck prevents common gateway dispatch", () => {
  for (const data of [null, { odds: 2 }]) {
    const input = option(); input.data = data; input.checkError = "closed";
    expect(() => prepareOtherLeg(account, input, 3)).toThrow("冻结预检");
  }
  expect(mocks.place).not.toHaveBeenCalled();
});
it.each([false, true])("PM manual=%s reuses common precheck and only carries its mode policy", async (manual) => {
  const pm = { ...account, provider: "Polymarket" } as PlatformAccount;
  const input = option(); input.type = "Polymarket";
  expect(await checkBetting(pm, input, { manual, skipAccountRate: true, pmQuoteScope: "sport" })).toBe(input);
  expect(mocks.check).toHaveBeenCalledExactlyOnceWith(pm, input, {
    skipAccountRate: true, pmQuoteScope: "sport", pmOrderMode: "GTC", pmGtcAllowResting: manual,
  });
});
it("a traditional counterpart retains ordinary precheck arguments", async () => {
  const input = option(); await checkBetting(account, input, { skipStakeResolve: true, role: "precheckOnly" });
  expect(mocks.check).toHaveBeenCalledExactlyOnceWith(account, input, { skipStakeResolve: true, role: "precheckOnly" });
});
