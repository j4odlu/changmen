import { expect, it } from "vitest";
import { projectRayLinkMonitorDisplay, resolveRayOrderDisplayStatus } from "./rayOrderDisplay";
import { buildRayLinkMonitorModel } from "./rayLinkMonitor";
import type { OrderRow } from "@/types/order";

const row: OrderRow = Object.freeze({ Type: "RAY", OrderID: "one", PlayerID: 2, Status: "None", BetMoney: 100, Money: 0 });
it("projects native Pending and Open without changing business status or PM", () => {
  expect(resolveRayOrderDisplayStatus(row, "Pending")).toBe("RayPending");
  expect(resolveRayOrderDisplayStatus(row, "Open")).toBe("None");
  expect(row.Status).toBe("None");
  expect(resolveRayOrderDisplayStatus({ ...row, Type: "Polymarket" }, "Pending")).toBeUndefined();
});
it("projects only the matching venue status while leaving monitoring and makeup actions unchanged", () => {
  const model = Object.freeze(buildRayLinkMonitorModel([{ ...row, Link: 10 }], null, null, { phase: "watching", status: "none", updatedAt: 100 }));
  for (const [display, venueStatus] of [["RayPending", "待确认"], ["None", "待结算"], ["Reject", "拒单"], ["Return", "退回"], ["RaySettled", "已结算"]]) {
    expect(projectRayLinkMonitorDisplay(model, row, display)).toEqual({ ...model, venueStatus });
    expect(projectRayLinkMonitorDisplay(model, { ...row, OrderID: "other" }, display)).toBe(model);
  }
  const rejected = Object.freeze({ ...model, venueStatus: "拒单" });
  expect(projectRayLinkMonitorDisplay(rejected, row, "RayPending")).toBe(rejected);
  expect(projectRayLinkMonitorDisplay(rejected, row, "None")).toBe(rejected);
  expect(model).toMatchObject({ label: "持续监控中", isLive: true, venueStatus: "待结算" });
});
it.each(["Reject", "Win", "Lose", "Return"])("stored or monitored %s overrides a stale native Pending", (status) => {
  expect(resolveRayOrderDisplayStatus({ ...row, Status: status }, "Pending")).toBe(status);
  expect(resolveRayOrderDisplayStatus(row, "Pending", { phase: "closed", status: status.toLowerCase(), updatedAt: 100 })).toBe(status);
});
it("does not turn a no-reject monitor result into Open while native confirmation is still pending", () => {
  expect(resolveRayOrderDisplayStatus(row, "Pending", { phase: "watching", status: "none", updatedAt: 100 })).toBe("RayPending");
  expect(resolveRayOrderDisplayStatus(row)).toBeUndefined();
});
it("projects H5 detail rejections/returns without promoting them into business facts", () => {
  const monitoring = Object.freeze({ phase: "watching" as const, status: "none", updatedAt: 100 });
  expect(resolveRayOrderDisplayStatus(row, "Rejected", monitoring)).toBe("Reject");
  expect(resolveRayOrderDisplayStatus(row, "Returned", monitoring)).toBe("Return");
  expect(resolveRayOrderDisplayStatus({ ...row, Status: "Reject" }, "Returned", { ...monitoring, status: "reject" })).toBe("Return");
  expect(resolveRayOrderDisplayStatus(row, "Settled", monitoring)).toBe("RaySettled");
  expect(resolveRayOrderDisplayStatus({ ...row, Status: "Win" }, "Rejected", monitoring)).toBe("Win");
  expect(row.Status).toBe("None");
  expect(monitoring).toEqual({ phase: "watching", status: "none", updatedAt: 100 });
});
it.each(["RayConfirming", "Pending"])("local %s is not a native Pending without venue facts", (Status) => {
  const preview = Object.freeze({ ...row, Status, DisplayOnly: true as const });
  const monitoring = Object.freeze({ phase: "watching" as const, status: "pending", updatedAt: 100 });
  expect(resolveRayOrderDisplayStatus(preview)).toBe("RayConfirming");
  expect(resolveRayOrderDisplayStatus(row, undefined, monitoring)).toBe("RayConfirming");
  expect(resolveRayOrderDisplayStatus(preview, "Open", monitoring)).toBe("None");
  expect(resolveRayOrderDisplayStatus(preview, "Pending", monitoring)).toBe("RayPending");
  expect(preview.Status).toBe(Status);
  expect(monitoring.status).toBe("pending");
});
