import { describe, expect, it } from "vitest";
import {
  dedupeObPlaySelectionRows,
  extractObPlaySelections,
  isObAhOuMarket,
  isObBoardMarket,
  parseObHandicapLine,
  playsFromObMatchRow,
} from "@/runtime/obSportOdds";

describe("extractObPlaySelections moneyline", () => {
  it("preserves the shared negative sign in OB Asian split handicaps", () => {
    expect(parseObHandicapLine("-0.5/1")).toBe(-0.75);
    expect(parseObHandicapLine("-1/1.5")).toBe(-1.25);
    expect(parseObHandicapLine("-0/0.5")).toBe(-0.25);
    expect(parseObHandicapLine("-0.5/-1")).toBe(-0.75);
    expect(parseObHandicapLine("0.5/1")).toBe(0.75);
    expect(parseObHandicapLine("0/0.5")).toBe(0.25);
    expect(parseObHandicapLine("abc/1")).toBeNull();
    expect(parseObHandicapLine("1/")).toBeNull();
    const rows = extractObPlaySelections({ hpid: "4", hl: [{ hv: "-1/1.5", ol: [
      { ot: "1", ov: 190000, oid: "home" }, { ot: "2", ov: 190000, oid: "away" },
    ] }] });
    expect(rows[0]?.line).toBe(-1.25);
  });
  it("keeps only the complete 1X2 line and drops draw-only extras", () => {
    const rows = extractObPlaySelections({
      hpid: "1",
      hpn: "全场独赢",
      hl: [
        {
          ol: [
            { on: "主胜", ov: 1.94, oid: "h" },
            { on: "和", ov: 3, oid: "d" },
            { on: "客胜", ov: 3.7, oid: "a" },
          ],
        },
        {
          ol: [{ on: "和", ov: 5.2, oid: "d2" }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.marketCode).toBe("moneyline");
    expect(rows[0]?.selections.map(s => s.side)).toEqual(["home", "draw", "away"]);
    expect(rows[0]?.selections.find(s => s.side === "draw")?.odds).toBe(3);
  });

  it("keeps European handicap 1X2 lines with hv", () => {
    const rows = extractObPlaySelections({
      hpid: "1",
      hpn: "全场独赢",
      hl: [
        {
          hv: "0",
          ol: [
            { on: "主胜", ov: 2.05, oid: "h" },
            { on: "和", ov: 3.4, oid: "d" },
            { on: "客胜", ov: 3.2, oid: "a" },
          ],
        },
        {
          hv: "-1",
          ol: [
            { on: "主胜", ov: 5.8, oid: "h2" },
            { on: "和", ov: 1.2, oid: "d2" },
            { on: "客胜", ov: 8.1, oid: "a2" },
          ],
        },
        {
          hv: "-2",
          ol: [
            { on: "主胜", ov: 5, oid: "h3" },
            { on: "和", ov: 1.28, oid: "d3" },
            { on: "客胜", ov: 6.9, oid: "a3" },
          ],
        },
      ],
    });
    expect(rows.map(r => r.line)).toEqual([0, -1, -2]);
    expect(rows.every(r => r.marketCode === "moneyline" && r.hpid === "1")).toBe(true);
    expect(rows[1]?.selections.find(s => s.side === "draw")?.odds).toBe(1.2);
  });

  it("parses European handicap score hv like 1-0 as home -1", () => {
    expect(parseObHandicapLine("1-0")).toBe(-1);
    expect(parseObHandicapLine("0-1")).toBe(1);
    expect(parseObHandicapLine("2:0")).toBe(-2);
    expect(parseObHandicapLine("-1")).toBe(-1);
    const rows = extractObPlaySelections({
      hpid: "1",
      hpn: "全场独赢",
      hl: [{
        hv: "1-0",
        ol: [
          { on: "主胜", ov: 4.7, oid: "h" },
          { on: "和", ov: 1.27, oid: "d" },
          { on: "客胜", ov: 8, oid: "a" },
        ],
      }],
    });
    expect(rows[0]?.line).toBe(-1);
  });
});

describe("dedupeObPlaySelectionRows", () => {
  it("drops hpsAdd duplicate of the same hid", () => {
    const play = {
      hpid: "1",
      hpn: "全场独赢",
      hl: {
        hid: "hid-even",
        ol: [
          { on: "主胜", ov: 2.05, oid: "h" },
          { on: "和", ov: 3.4, oid: "d" },
          { on: "客胜", ov: 3.2, oid: "a" },
        ],
      },
    };
    const add = { ...play, hlnm: 0 };
    const rows = dedupeObPlaySelectionRows(
      playsFromObMatchRow({ hpsData: [{ hps: [play], hpsAdd: [add] }] }).flatMap(extractObPlaySelections),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("isObAhOuMarket", () => {
  it("keeps handicap/totals hpids and drops moneyline", () => {
    expect(isObAhOuMarket("4", "spreads")).toBe(true);
    expect(isObAhOuMarket("2", "totals")).toBe(true);
    expect(isObAhOuMarket("19")).toBe(true);
    expect(isObAhOuMarket("1", "moneyline")).toBe(false);
    expect(isObAhOuMarket("", "ht_spreads")).toBe(true);
    expect(isObAhOuMarket("7", "ob:7")).toBe(false);
  });
});

describe("isObBoardMarket", () => {
  it("keeps ft/ht moneyline with handicap/totals and drops quarters or 波胆", () => {
    expect(isObBoardMarket("1", "moneyline")).toBe(true);
    expect(isObBoardMarket("17")).toBe(true);
    expect(isObBoardMarket("4", "spreads")).toBe(true);
    expect(isObBoardMarket("", "ht_moneyline")).toBe(true);
    expect(isObBoardMarket("25")).toBe(false);
    expect(isObBoardMarket("7", "ob:7")).toBe(false);
  });
});
