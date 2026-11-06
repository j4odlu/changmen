import { beforeEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import type { OrderRow } from "@/types/order";
import { useOrderListActions } from "./useOrderListActions";

const api = vi.hoisted(() => ({ pm: vi.fn(), pf: vi.fn(), pmAllowed: vi.fn(), pfAllowed: vi.fn(),
  closing: vi.fn(), pmBusy: vi.fn(), pfBusy: vi.fn(), confirm: vi.fn() }));
vi.mock("@/stores/account/pmManualSell", () => ({ canManualSellPmBuy: api.pmAllowed, confirmAndSellPmBuyOrder: api.pm,
  isPmManualSellClosing: api.closing, isPmManualSellInFlight: api.pmBusy }));
vi.mock("@/stores/account/pfManualSell", () => ({ canManualSellPfBuy: api.pfAllowed, confirmAndSellPfBuyOrder: api.pf,
  isPfManualSellInFlight: api.pfBusy }));
vi.mock("element-plus", () => ({ ElMessageBox: { confirm: api.confirm } }));
const pm: OrderRow = { OrderID: "buy", Type: "Polymarket", Status: "None", BetMoney: 72 };
beforeEach(() => { vi.resetAllMocks(); api.pmAllowed.mockReturnValue(true); api.pfAllowed.mockReturnValue(true); api.confirm.mockResolvedValue("confirm"); });

it("preserves permissions, display-only restrictions and venue eligibility", () => {
  const props = reactive({ allowPmSell: false, allowPfSell: false });
  const c = useOrderListActions(props, vi.fn());
  expect(c.showPmSellButton(pm)).toBe(false);
  expect(c.showPfSellButton({ Type: "PredictFun" })).toBe(false);
  props.allowPmSell = true; props.allowPfSell = true;
  expect(c.showPmSellButton(pm)).toBe(true);
  expect(c.showPmSellButton({ ...pm, DisplayOnly: true })).toBe(false);
  expect(c.showPfSellButton({ Type: "PredictFun" })).toBe(true);
  api.pmAllowed.mockReturnValue(false); api.pfAllowed.mockReturnValue(false);
  expect(c.showPmSellButton(pm)).toBe(false);
  expect(c.showPfSellButton({ Type: "PredictFun" })).toBe(false);
});
it("delegates the exact row to the existing sell service and preserves errors", async () => {
  const c = useOrderListActions({ allowPmSell: true, allowPfSell: true }, vi.fn());
  await c.onPmSell({ ...pm, DisplayOnly: true });
  expect(api.pm).not.toHaveBeenCalled();
  await c.onPmSell(pm);
  expect(api.pm).toHaveBeenCalledExactlyOnceWith(pm);
  const pf: OrderRow = { Type: "PredictFun", OrderID: "pf" };
  await c.onPfSell(pf);
  expect(api.pf).toHaveBeenCalledExactlyOnceWith(pf);
  api.pm.mockRejectedValue(Error("API unavailable"));
  await expect(c.onPmSell(pm)).rejects.toThrow("API unavailable");
  expect(c.isPmManualSellInFlight).toBe(api.pmBusy);
  expect(c.isPfManualSellInFlight).toBe(api.pfBusy);
});
it("keeps closing status ahead of financial and venue badges", () => {
  const c = useOrderListActions({ allowPmSell: true, allowPfSell: true }, vi.fn());
  expect(c.statusClass({ ...pm, Status: "Lose", Money: -72, PmMatchResult: "EqualSplit" })).toBe("Lose");
  expect(c.statusClass({ Type: "PredictFun", PfSellState: "closed", Status: "None", Money: 10 })).toBe("Win");
  api.closing.mockReturnValue(true);
  expect(c.statusClass(pm)).toBe("PmClosing");
});
it("cancels makeup only after confirmation and ignores cancellation/ordinary rows", async () => {
  const cancelled = vi.fn(), c = useOrderListActions({ allowPmSell: false, allowPfSell: false }, cancelled);
  c.onCancelMakeup(pm);
  expect(api.confirm).not.toHaveBeenCalled();
  let confirm!: (value: string) => void;
  api.confirm.mockReturnValue(new Promise(resolve => { confirm = resolve; }));
  c.onCancelMakeup({ OrderID: "makeup-123", Status: "MakeupPending" });
  expect(cancelled).not.toHaveBeenCalled();
  confirm("confirm"); await Promise.resolve();
  expect(cancelled).toHaveBeenCalledExactlyOnceWith(123);
  api.confirm.mockRejectedValue("cancel");
  c.onCancelMakeup({ OrderID: "makeup-456", Status: "MakeupPending" });
  await Promise.resolve(); await Promise.resolve();
  expect(cancelled).toHaveBeenCalledTimes(1);
});
