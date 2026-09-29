import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ pmGetOrder: vi.fn(), pmGetOpenOrders: vi.fn() }));
vi.mock("./pmClientApi", () => api);
import { fetchPolymarketOrderRow } from "./orderStatus";
const account = { token: JSON.stringify({ address: "0x1", apiKey: "k", secret: "s", passphrase: "p" }) } as never;

describe("PM exact order reconciliation", () => {
  beforeEach(() => vi.resetAllMocks());
  it("uses exact ID filtering when the single-order endpoint is empty", async () => {
    api.pmGetOrder.mockResolvedValue(null);
    api.pmGetOpenOrders.mockResolvedValue({ data: [{ id: "other", status: "MATCHED" }, { id: "ours", status: "CANCELED", size_matched: "0" }] });
    expect(await fetchPolymarketOrderRow(account, "ours")).toMatchObject({ id: "ours", status: "CANCELED" });
    expect(api.pmGetOpenOrders).toHaveBeenCalledWith(account, undefined, "ours");
  });
  it("distinguishes authentication failure from missing order", async () => {
    api.pmGetOrder.mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));
    await expect(fetchPolymarketOrderRow(account, "ours")).rejects.toThrow("unauthorized");
    expect(api.pmGetOpenOrders).not.toHaveBeenCalled();
  });
  it("does not use another order as evidence", async () => {
    api.pmGetOrder.mockRejectedValue({ status: 404 });
    api.pmGetOpenOrders.mockResolvedValue({ data: [{ id: "other", status: "MATCHED" }] });
    expect(await fetchPolymarketOrderRow(account, "ours")).toBeNull();
  });
});
