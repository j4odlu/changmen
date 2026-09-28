import { describe, expect, it } from "vitest";
import { buildRayLinkMonitorModel } from "./rayLinkMonitor";

describe("buildRayLinkMonitorModel", () => {
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
    expect(model.label).toBe("持续监控待接入");
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
