import { beforeEach, expect, it, vi } from "vitest";
import { prepareOtherLeg } from "./gateway";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), betting: vi.fn(), observe: vi.fn() }));
vi.mock("@/runtime/providers", () => ({ getProvider: mocks.provider }));
vi.mock("@/services/orderObservation", () => ({ observeOption: mocks.observe, createObservationContext: vi.fn() }));
vi.mock("@/shared/betNotification", () => ({ notifyBet: async (_account: unknown, _option: unknown, run: () => Promise<unknown>) => run() }));
const account = { provider: "RAY", accountId: 2 } as never;
const option = () => ({ type: "RAY", data: { odds: 2.26 }, diagnosticAttempt: "initial" }) as never;
beforeEach(() => { vi.resetAllMocks(); mocks.provider.mockReturnValue({ betting: mocks.betting }); });

it("resolves the counterpart provider before preflight succeeds without submitting an order", async () => {
  const result = { success: true, orderId: "ray-order", saveLog: vi.fn() };
  mocks.betting.mockResolvedValueOnce(result);
  const submit = prepareOtherLeg(account, option(), 3);
  expect(mocks.provider).toHaveBeenCalledOnce(); expect(mocks.betting).not.toHaveBeenCalled();
  expect(await submit()).toBe(result); expect(mocks.betting).toHaveBeenCalledOnce(); expect(mocks.provider).toHaveBeenCalledOnce();
});
it("an unsupported counterpart fails during preparation before any POST", () => {
  mocks.provider.mockReturnValueOnce(null);
  expect(() => prepareOtherLeg(account, option(), 3)).toThrow("平台不支持");
  expect(mocks.betting).not.toHaveBeenCalled();
});
it("observation and log exceptions cannot discard a real venue receipt", async () => {
  mocks.observe.mockImplementation(() => { throw new Error("observation unavailable"); });
  const result = { success: true, orderId: "ray-order", saveLog: () => { throw new Error("log unavailable"); } };
  mocks.betting.mockResolvedValueOnce(result);
  expect(await prepareOtherLeg(account, option(), 3)()).toBe(result);
});
