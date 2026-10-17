import { expect, test } from "vitest";
// Test oracle only. Production uses public type exports, not this unstable internal package.
import { MarketBookEventSchema, MarketPriceChangeEventSchema } from "@polymarket/bindings/subscriptions";
import { reduceBookFrame } from "../../realtime/orderBook/bookReducer";
const market = "0x" + "a".repeat(64), timestamp = String(Date.now());
const book = {event_type:"book",asset_id:"1",market,timestamp,bids:[],asks:[{price:"0.5",size:"10"}],hash:"h"};
const apply = (event: unknown, current = new Map()) => reduceBookFrame(current,event,new Set(["1"]),1,100,Date.now()).books;
test.each([undefined, null, ""])("official optional hash %s is parseable but cannot establish execution evidence", hash => {
  const raw = {...book,hash}; expect(MarketBookEventSchema.safeParse(raw).success).toBe(true);
  const result = apply(raw); expect(result.get("1")).toMatchObject({snapshotEvidence:false});
  const next = apply({event_type:"price_change",market,timestamp,price_changes:[{asset_id:"1",price:"0.5",size:"9",side:"SELL"}]},new Map(result));
  expect(next.get("1")?.snapshotEvidence).toBe(false);
});
test.each(["SELL","sell","Sell"])("side %s follows official normalization and overwrites quantity", side => {
  const raw={event_type:"price_change",market,timestamp,price_changes:[{asset_id:"1",price:"0.5",size:"7",side}]};
  expect(MarketPriceChangeEventSchema.safeParse(raw).success).toBe(true);
  expect(apply(raw,new Map(apply(book))).get("1")?.asks.get("0.5")).toBe("7");
});
test("official optional timestamp is insufficient for our execution evidence; no clock is invented", () => {
  const raw={...book,timestamp:undefined}; expect(MarketBookEventSchema.safeParse(raw).success).toBe(true);
  expect(()=>apply(raw)).toThrow("timestamp");
});
