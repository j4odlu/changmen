import { expect, test } from "vitest";
import { bestAskFromBook } from "@changmen/venue-browser/polymarket/bookQuote";
import { extractPolymarketWsBestAsks as parse } from "@changmen/venue-browser/polymarket/wsQuotes";
import { bestAskFromBook as oldAsk } from "../../parse";
import { bestAskFromBook as nestedAsk } from "../../markets/parse";
import { extractPolymarketWsBestAsks as oldParse } from "../../wsQuotes";
import { extractPolymarketWsBestAsks as nestedParse } from "../../realtime/wsQuotes";

test("public and both legacy entries use the same functions", () => {
  expect(oldAsk).toBe(bestAskFromBook); expect(nestedAsk).toBe(bestAskFromBook);
  expect(oldParse).toBe(parse); expect(nestedParse).toBe(parse);
});

test("best ask retains unsorted level selection, size filtering and empty book behavior", () => {
  expect(bestAskFromBook(undefined)).toBe(0);
  expect(bestAskFromBook({ asks: [] })).toBe(0);
  expect(bestAskFromBook({ asks: [
    { price: ".01", size: 0 }, { price: ".02", size: -1 }, { price: "NaN", size: 1 },
    { price: ".6", size: 2 }, { price: ".3" }, { price: ".4", size: "unknown" },
  ] })).toBe(.3);
  expect(bestAskFromBook({ asks: [{ price: "1.2", size: 1 }] })).toBe(1.2);
});

test("mixed frames retain order, raw best ask values and per-change timestamp precedence", () => {
  expect(parse(JSON.stringify([
    { event_type: "best_bid_ask", asset_id: "a", best_ask: ".41", timestamp: "100" },
    { event_type: "price_change", timestamp: "200", price_changes: [
      { asset_id: "b", best_ask: ".42", timestamp: "201" },
      { asset_id: "c", best_ask: .43, timestamp: 0 },
    ] },
    { event_type: "book", asset_id: "d", timestamp: "invalid", asks: [{ price: ".5", size: 1 }, { price: ".4", size: 2 }] },
    { event_type: "unknown", asset_id: "ignored", best_ask: .5 },
  ]))).toEqual([
    { assetId: "a", bestAsk: ".41", timestamp: 100 },
    { assetId: "b", bestAsk: ".42", timestamp: 201 },
    { assetId: "c", bestAsk: .43, timestamp: 200 },
    { assetId: "d", bestAsk: .4 },
  ]);
});

test("PONG, empty updates and existing malformed-message errors stay unchanged", () => {
  expect(parse("PONG")).toEqual([]); expect(parse("[]")).toEqual([]);
  expect(parse('{"event_type":"book","asset_id":"a","asks":[]}')).toEqual([]);
  expect(() => parse("malformed")).toThrow(SyntaxError);
  expect(() => parse("null")).toThrow(TypeError);
  expect(() => parse('[null]')).toThrow(TypeError);
});
