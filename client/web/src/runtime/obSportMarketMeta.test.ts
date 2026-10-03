import { afterEach, describe, expect, it, vi } from "vitest";
import { clearObSportMarketMeta, peekObSportMarketMeta, rememberObSportMarketMeta } from "./obSportMarketMeta";

const row = (oid: string) => ({ mid: "5505659", playData: [{ hpid: "18", hl: [{ hid: "hid-18", hv: "1.5", ol: [
  { oid, ot: "Over", ov: 195000 }, { oid: `${oid}-under`, ot: "Under", ov: 190000 },
] }] }] });
afterEach(() => { clearObSportMarketMeta(); vi.useRealTimers(); });
describe("OB structural metadata reuse", () => {
  it("keeps exact oid/line/period identifiers and no quote, isolated by gateway", () => {
    rememberObSportMarketMeta("https://one.example/", [row("over")]);
    const meta = peekObSportMarketMeta("https://one.example", "5505659", "over");
    expect(meta).toEqual({ oid: "over", hid: "hid-18", hpid: "18", playOptions: "Over", marketValue: "1.5" });
    expect(peekObSportMarketMeta("https://two.example", "5505659", "over")).toBeUndefined();
  });
  it("replaces old identifiers on a new snapshot and expires stale metadata", () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    rememberObSportMarketMeta("https://one.example", [row("old")]);
    rememberObSportMarketMeta("https://one.example", { data: [row("new")] });
    expect(peekObSportMarketMeta("https://one.example", "5505659", "old")).toBeUndefined();
    expect(peekObSportMarketMeta("https://one.example", "5505659", "new")).toBeDefined();
    vi.setSystemTime(16000);
    expect(peekObSportMarketMeta("https://one.example", "5505659", "new")).toBeUndefined();
  });
});
