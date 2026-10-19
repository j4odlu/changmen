import { describe, expect, test } from "vitest";
import {
  changmenDisplayLocked,
  changmenHttpSaveIsLock,
  compareHttpBlock,
  explainHttpBlock,
  httpBlockLocked,
  a8MqttLockFromPayload,
  summarizeGameViewJson,
} from "./lock_decision";

describe("lock_decision HTTP", () => {
  test("open when status=6 visible=1 suspended=0", () => {
    expect(httpBlockLocked({ status: 6, visible: 1, suspended: 0 })).toBe(false);
  });

  test("locked when status!=6", () => {
    const r = explainHttpBlock({ status: 7, visible: 1, suspended: 0 });
    expect(r.locked).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe("lock_decision A8 parity (fo/display)", () => {
  test("HTTP save follows block formula only", () => {
    const r = compareHttpBlock(
      { id: "m1", status: 6, visible: 1, suspended: 0 },
      { pendingBetLocks: { m1: true } },
    );
    expect(r.http.official).toBe(false);
    expect(r.http.changmenFoAfterHttp).toBe(false);
    expect(r.changmenDiffersFromOfficial).toBe(false);
  });

  test("display ignores sourceStatus when fo open", () => {
    const d = changmenDisplayLocked({ sourceStatus: "Locked", foLocked: false });
    expect(d.locked).toBe(false);
    expect(d.layer).toBe("open");
  });

  test("changmenHttpSaveIsLock ignores pending", () => {
    expect(changmenHttpSaveIsLock(false, true)).toBe(false);
    expect(changmenHttpSaveIsLock(true, false)).toBe(true);
  });
});

describe("lock_decision A8 MQTT", () => {
  test("statusUpdate always locks", () => {
    expect(a8MqttLockFromPayload("market.statusUpdate", { status: 6 }).locked).toBe(true);
  });

  test("suspended follows flag", () => {
    expect(a8MqttLockFromPayload("market.suspended", { suspended: 1 }).locked).toBe(true);
    expect(a8MqttLockFromPayload("market.suspended", { suspended: 0 }).locked).toBe(false);
  });
});

describe("summarizeGameViewJson", () => {
  test("parses fixture shape", () => {
    const summary = summarizeGameViewJson({
      status: "true",
      data: [
        { id: "1", cn_name: "全场获胜", status: 6, visible: 1, suspended: 0, round: 0 },
        { id: "2", cn_name: "地图1", status: 7, visible: 1, suspended: 0, round: 1 },
      ],
    });
    expect(summary.total).toBe(2);
    expect(summary.lockedOfficial).toBe(1);
    expect(summary.openOfficial).toBe(1);
  });
});
