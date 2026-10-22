import { describe, expect, it } from "vitest";
import { toDateKey } from "./date_key.js";
import {
  forEachBookedProfitGroup,
  groupHomeTsFromRaw,
  groupRawOrdersForProfit,
} from "./group_home.js";

describe("group_home", () => {
  it("falls back to earliest create_at when Link is not a timestamp", () => {
    const yday = Date.parse("2026-09-04T23:46:19+08:00");
    const today = Date.parse("2026-09-05T00:08:27+08:00");
    const group = [
      { user_id: "u1", link: 42, create_at: yday, provider: "RAY" },
      {
        user_id: "u1",
        link: 42,
        create_at: today,
        provider: "Polymarket",
        raw: { pmSide: "buy" },
      },
    ];
    expect(groupHomeTsFromRaw(group)).toBe(yday);
    expect(toDateKey(groupHomeTsFromRaw(group))).toBe("2026-09-04");
  });

  it("uses Link bind time as home even if the only row filled next day", () => {
    const link = Date.parse("2026-09-04T23:46:13+08:00");
    const fill = Date.parse("2026-09-05T00:08:27+08:00");
    expect(groupHomeTsFromRaw([
      { user_id: "u1", link, create_at: fill, provider: "Polymarket", raw: { pmSide: "buy" } },
    ])).toBe(link);
    expect(toDateKey(link)).toBe("2026-09-04");
  });

  it("ignores PM sells when picking home", () => {
    const buyAt = Date.parse("2026-07-18T15:36:00+08:00");
    const sellAt = Date.parse("2026-07-19T00:24:00+08:00");
    expect(groupHomeTsFromRaw([
      { create_at: buyAt, provider: "Polymarket", raw: { pmSide: "buy" } },
      { create_at: sellAt, provider: "Polymarket", raw: { pmSide: "sell" } },
    ])).toBe(buyAt);
  });

  it("keeps link=0 orders as their own groups", () => {
    const groups = groupRawOrdersForProfit([
      { user_id: "u1", link: 0, create_at: 10, order_id: "a" },
      { user_id: "u1", link: 0, create_at: 20, order_id: "b" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("forEachBookedProfitGroup assigns both arb legs to home day", () => {
    const yday = Date.parse("2026-09-04T23:46:19+08:00");
    const today = Date.parse("2026-09-05T00:08:27+08:00");
    const booked = [];
    forEachBookedProfitGroup([
      { user_id: "u1", link: 7, create_at: yday, order_id: "ray" },
      { user_id: "u1", link: 7, create_at: today, order_id: "pm" },
    ], (group, homeKey) => {
      booked.push({ homeKey, ids: group.map(r => r.order_id).sort() });
    });
    expect(booked).toEqual([{ homeKey: "2026-09-04", ids: ["pm", "ray"] }]);
  });
});

describe("single-leg strategy booking dates", () => {
  const at = Date.parse("2026-10-22T23:59:00+08:00");
  it.each([6_000_000_000_000_000, 7_000_000_000_000_000, 0])("restores the original date for negative Link base %s", base => {
    const order = { link: -(base + at), create_at: at + 86_400_000, user_id: "owner", provider: "RAY", money: 10 };
    expect(groupHomeTsFromRaw([order])).toBe(at);
    const groups = [];
    forEachBookedProfitGroup([order], (rows, date) => groups.push({ rows, date }));
    expect(groups).toEqual([{ rows: [order], date: "2026-10-22" }]);
  });
});
