import { beforeEach, expect, it, vi } from "vitest";
import { handlePmPfAction } from "./pm_pf_routes.ts";

const mocks = vi.hoisted(() => ({ recover: vi.fn(), order: vi.fn() }));
vi.mock("../orderModes/gtc/handler.js", () => ({ handlePmGtc: mocks.recover }));
vi.mock("../auth/admin_auth.js", () => ({ isAdminUser: () => false }));
vi.mock("../integrations/polymarket/pm_client_handlers.js", () => ({ handlePmGetOrder: mocks.order }));
vi.mock("../integrations/polymarket/submission_handler.js", () => ({}));
vi.mock("../integrations/predictfun/pf_client_handlers.js", () => ({}));
beforeEach(() => {
  vi.clearAllMocks(); mocks.recover.mockResolvedValue({ executions: { ok: true, rows: [] }, orders: [] });
  mocks.order.mockResolvedValue({ ok: true, info: { id: "official" } });
});
it("dispatches the registered recovery endpoint with the authenticated owner and preserves partial section failures", async () => {
  const partial = { executions: { ok: false, message: "list offline" }, orders: [{ ok: true, ids: [], rows: [], unchangedIds: [] }] };
  mocks.recover.mockResolvedValue(partial);
  const body = { owner: "forged", discover: true };
  expect(await handlePmPfAction("Pm_GtcRecover", body, { user: { id: "owner" } })).toMatchObject({ success: 1, info: partial });
  expect(mocks.recover).toHaveBeenCalledExactlyOnceWith("Pm_GtcRecover", body, "owner");
  expect(mocks.order).not.toHaveBeenCalled();
});
it("authentication and parameter errors retain the ordinary API failure envelope", async () => {
  mocks.recover.mockRejectedValue(new Error("GTC 恢复身份无效"));
  expect(await handlePmPfAction("Pm_GtcRecover", {}, { user: { id: "owner" } })).toMatchObject({ success: 0, msg: "GTC 恢复身份无效" });
});
it("official PM queries retain their independent native handler", async () => {
  const body = { playerId: 1, orderId: "official" };
  expect(await handlePmPfAction("Pm_GetOrder", body, { user: { id: "owner" } })).toMatchObject({ success: 1, info: { id: "official" } });
  expect(mocks.order).toHaveBeenCalledExactlyOnceWith(body, "owner"); expect(mocks.recover).not.toHaveBeenCalled();
});
