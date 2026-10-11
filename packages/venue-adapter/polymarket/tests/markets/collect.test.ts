import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { extractPolymarketWsBestAsks } from "../../wsQuotes";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("Polymarket collect fo lock contracts", () => {
  test("WS quote path writes locked:false (do not zero getOdds when other side missing)", () => {
    const src = readFileSync(join(root, "markets/collect.ts"), "utf8");
    const start = src.indexOf("function updateBetFromAsset");
    const end = src.indexOf("const unQuote", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/locked:\s*false/);
    expect(body).not.toMatch(/locked:\s*next\.Status/);
    expect(body).not.toMatch(/locked:\s*next\.Status === "Locked"/);
  });

  test("Index http seed skips overwrite when fo already has mqtt clob", () => {
    const src = readFileSync(join(root, "markets/collect.ts"), "utf8");
    const start = src.indexOf("function saveBetOddsToFo");
    const end = src.indexOf("export function startPolymarketCollector");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/prev\?\.source === "mqtt"/);
    expect(body).toMatch(/locked:\s*false/);
    // 禁止再用市场级 Status Locked 把有价一侧打成 isLock
    expect(body).not.toMatch(/locked:\s*locked\s*\|\|/);
    expect(body).not.toMatch(/isLock:\s*locked\s*\|\|/);
  });
});

describe("Polymarket WS quote parsing", () => {
  test("best_bid_ask event", () => {
    expect(extractPolymarketWsBestAsks(JSON.stringify({
      event_type: "best_bid_ask",
      asset_id: "asset-home",
      best_ask: "0.51",
    }))).toEqual([{ assetId: "asset-home", bestAsk: "0.51" }]);
  });

  test("price_change event — nested price_changes array (official asyncapi format)", () => {
    expect(extractPolymarketWsBestAsks(JSON.stringify([{
      event_type: "price_change",
      market: "0xabc",
      price_changes: [
        { asset_id: "asset-home", price: "0.52", size: "100", side: "BUY", best_ask: "0.53" },
        { asset_id: "asset-away", price: "0.47", size: "80",  side: "BUY", best_ask: "0.49" },
        { asset_id: "no-ask" },
      ],
    }]))).toEqual([
      { assetId: "asset-home", bestAsk: "0.53" },
      { assetId: "asset-away", bestAsk: "0.49" },
    ]);
  });

  test("book event — extracts best ask from asks array (initial_dump snapshot)", () => {
    expect(extractPolymarketWsBestAsks(JSON.stringify({
      event_type: "book",
      asset_id: "asset-home",
      market: "0xabc",
      bids: [{ price: "0.48", size: "200" }],
      asks: [
        { price: "0.62", size: "0" },    // size=0 → skip
        { price: "0.58", size: "10" },   // best non-zero ask
        { price: "0.60", size: "5" },
      ],
    }))).toEqual([{ assetId: "asset-home", bestAsk: 0.58 }]);
  });

  test("ignores heartbeat pong", () => {
    expect(extractPolymarketWsBestAsks("PONG")).toEqual([]);
  });
});
