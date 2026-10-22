import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetResult } from "@changmen/client-core/models/betResult";
import { confirmVenueBet } from "./confirmVenueBet";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), persistReject: vi.fn(), update: vi.fn() }));
vi.mock("@/domain/betting/resolveVenueLegOutcome", () => ({ resolveVenueLegOutcome: mocks.resolve }));
vi.mock("@/stores/account/pmRejectOrder", () => ({ persistPolymarketExecutionReject: mocks.persistReject }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ updateVenueOrders: mocks.update }) }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

describe("confirmation has no dependency on order names or rejection persistence", () => {
  it.each([
    ["unfilled", true, false], ["timeout", false, true], ["filled", false, false],
  ] as const)("returns %s without writing a rejection", async (settlement, rejected, pendingConfirm) => {
    const result = Object.assign(new BetResult("Polymarket", true), { orderId: "same-order", pending: true });
    mocks.resolve.mockResolvedValue({ settlement, orders: [] });
    const account = { provider: "Polymarket", accountId: 292 } as never;
    expect(await confirmVenueBet(account, result, { pmConditionId: "condition", rejectWaitSec: 0 }))
      .toEqual({ orders: [], rejected, pendingConfirm });
    expect(mocks.resolve).toHaveBeenCalledWith(account, result, expect.any(Function), {
      confirmPostAccepted: true, pmConditionId: "condition", rejectWaitSec: 0,
    });
    expect(mocks.persistReject).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
