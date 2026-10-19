import { describe, expect, it } from "vitest";
import { BetResult } from "./betResult";

describe("betResult", () => {
  it("message 原样赋值，空值不兜底（对齐 A8 uo）", () => {
    expect(new BetResult("OB", true, "").message).toBe("");
    expect(new BetResult("OB", true, undefined).message).toBeUndefined();
    expect(new BetResult("RAY", false, "").message).toBe("");
    expect(new BetResult("PB", false, undefined).message).toBeUndefined();
  });

  it("保留 A8 uo 默认字段", () => {
    const r = new BetResult("OB", true, "ok");
    expect(r.tip).toBeNull();
    expect(r.reject).toBeNull();
    expect(r.orderId).toBeNull();
    expect(r.link).toBe(0);
  });
});
