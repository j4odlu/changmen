import { describe, expect, it } from "vitest";
import { buildRayLinkMonitorModel } from "./rayLinkMonitor";

describe("buildRayLinkMonitorModel", () => {
  it("independent order facts take priority over an old rejection observer or makeup run", () => {
    const model = buildRayLinkMonitorModel([{ Link: 12, Type: "RAY", OrderID: "original", Status: "None" }],
      { phase: "makeup", legs: [] } as never,
      { status: "watching", boundOrderId: "other", pollCount: 99 } as never,
      { phase: "watching", status: "pending", error: "network down", updatedAt: 500 });
    expect(model).toMatchObject({ label: "监控重试中", orderId: "original", observedAt: 500, detail: "network down" });
    const rejected = buildRayLinkMonitorModel([{ Link: 12, Type: "RAY", OrderID: "original" }], null, null,
      { phase: "closed", status: "reject", updatedAt: 600 });
    expect(rejected).toMatchObject({ label: "监控已结束", tone: "danger", venueStatus: "拒单", isLive: false });
  });
  it("shows the independent monitor instead of an old first-confirmation label", () => {
    const rows = [{ Link: 12, Type: "RAY", OrderID: "original", Status: "None" }];
    const model = buildRayLinkMonitorModel(rows, { legs: [{ platform: "RAY", status: "confirmed" }] } as never, null, { phase: "watching", status: "none", updatedAt: 200 });
    expect(model.label).toBe("持续监控中"); expect(model.isLive).toBe(true);
    const closed = buildRayLinkMonitorModel(rows, null, null, { phase: "closed", status: "lose", updatedAt: 300 });
    expect(closed.label).toBe("监控已结束"); expect(closed.venueStatus).toBe("输"); expect(closed.isLive).toBe(false);
  });
  it("only shows for positive links containing a RAY order", () => {
    expect(buildRayLinkMonitorModel([{ Link: 12, Type: "OB" }]).visible).toBe(false);
    expect(buildRayLinkMonitorModel([{ Link: -12, Type: "RAY" }]).visible).toBe(false);
    expect(buildRayLinkMonitorModel([{ Link: 12, Type: "RAY", Status: "None" }]).visible).toBe(true);
  });

  it("shows a confirmed reject before other states", () => {
    const model = buildRayLinkMonitorModel([
      { Link: 12, Type: "RAY", OrderID: "ray-1", Status: "Reject", CreateAt: 100 },
    ]);
    expect(model.tone).toBe("danger");
    expect(model.label).toBe("拒单已确认");
    expect(model.orderId).toBe("ray-1");
  });

  it("does not describe an unsettled historic row as actively monitored", () => {
    const model = buildRayLinkMonitorModel([
      { Link: 12, Type: "RAY", OrderID: "ray-1", Status: "None", CreateAt: 100 },
    ]);
    expect(model.label).toBe("等待恢复监控");
    expect(model.isLive).toBe(false);
  });

  it.each(["Win", "Lose", "Return"])("hides a finished RAY order with status %s", (status) => {
    const model = buildRayLinkMonitorModel([
      { Link: 12, Type: "RAY", OrderID: "ray-1", Status: status, CreateAt: 100 },
    ]);
    expect(model.visible).toBe(false);
    expect(model.isLive).toBe(false);
  });

  it("shows that a rejected RAY leg was not made up when automatic makeup is off", () => {
    const model = buildRayLinkMonitorModel(
      [{ Link: 12, Type: "RAY", OrderID: "ray-1", Status: "Reject", CreateAt: 100 }],
      {
        phase: "syncing",
        overallLabel: "自动补单已关闭",
        updatedAt: 200,
        legs: [{ platform: "RAY", status: "rejected", detail: "自动补单已关闭，未执行补单" }],
      } as never,
    );
    expect(model.label).toBe("拒单已确认");
    expect(model.summary).toBe("自动补单已关闭，未执行补单");
    expect(model.isLive).toBe(false);
  });
});
