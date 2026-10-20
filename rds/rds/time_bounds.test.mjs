import { describe, expect, it } from "vitest";
import { localDayBounds, localMonthBounds } from "./time_bounds.js";

describe("localDayBounds", () => {
  it("returns local midnight bounds for YYYY-MM-DD", () => {
    const { dayStart, dayEnd } = localDayBounds("2026-06-18");
    expect(dayEnd - dayStart).toBe(86400000);
    const d = new Date(dayStart);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(0);
  });
});

describe("localMonthBounds", () => {
  it("returns local month bounds for YYYY-MM", () => {
    const { monthStart, monthEnd } = localMonthBounds("2026-06");
    expect(monthEnd - monthStart).toBeGreaterThan(28 * 86400000);
    const d = new Date(monthStart);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(1);
  });
});
