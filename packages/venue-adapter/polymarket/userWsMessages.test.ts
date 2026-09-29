import { describe, expect, it } from "vitest";
import {
  interpretPolymarketUserWsMessage,
  polymarketOrderRowFromUserWsMessage,
  polymarketUserOrderIdsFromMessage,
} from "./userWsMessages";

const ORDER_ID = "0xabc123";

describe("polymarketUserOrderIdsFromMessage", () => {
  it("collects taker, order id, and maker order ids", () => {
    expect(polymarketUserOrderIdsFromMessage({
      id: "0xmaker",
      taker_order_id: "0xtaker",
      maker_orders: [{ order_id: "0xmaker-leg" }],
    })).toEqual(["0xtaker", "0xmaker", "0xmaker-leg"]);
  });
});

describe("interpretPolymarketUserWsMessage", () => {
  it("preserves a partial fill when the remaining quantity is canceled", () => {
    const msg = { event_type: "order", type: "CANCELLATION", id: ORDER_ID,
      status: "CANCELED", size_matched: "3", original_size: "10" };
    expect(interpretPolymarketUserWsMessage(msg, ORDER_ID)).toBe("matched");
    expect(polymarketOrderRowFromUserWsMessage(msg, "matched")).toMatchObject({
      size_matched: "3", original_size: "10",
    });
  });

  it("does not invent zero filled quantity for incomplete cancellation events", () => {
    expect(interpretPolymarketUserWsMessage({ event_type: "order", type: "CANCELLATION",
      id: ORDER_ID }, ORDER_ID)).toBeNull();
  });
  it("matched on trade CONFIRMED for taker order", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "trade",
      type: "TRADE",
      status: "CONFIRMED",
      taker_order_id: ORDER_ID,
      size: "10",
    }, ORDER_ID)).toBe("matched");
  });

  it("does not treat a failed trade as a canceled order", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "trade",
      type: "TRADE",
      status: "FAILED",
      taker_order_id: ORDER_ID,
    }, ORDER_ID)).toBeNull();
  });

  it("unfilled on order CANCELLATION", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "order",
      type: "CANCELLATION",
      id: ORDER_ID,
      size_matched: "0",
    }, ORDER_ID)).toBe("unfilled");
  });

  it("pending on UPDATE with unmatched and no fill (FOK not terminal yet)", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "order",
      type: "UPDATE",
      id: ORDER_ID,
      status: "unmatched",
      size_matched: "0",
    }, ORDER_ID)).toBeNull();
  });

  it("pending on UPDATE with live and no fill", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "order",
      type: "UPDATE",
      id: ORDER_ID,
      status: "live",
      size_matched: "0",
    }, ORDER_ID)).toBeNull();
  });

  it("pending (null) on PLACEMENT delayed", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "order",
      type: "PLACEMENT",
      id: ORDER_ID,
      status: "delayed",
      size_matched: "0",
    }, ORDER_ID)).toBeNull();
  });

  it("unfilled on status CANCELED", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "order",
      type: "UPDATE",
      id: ORDER_ID,
      status: "CANCELED",
      size_matched: "0",
    }, ORDER_ID)).toBe("unfilled");
  });

  it("matched on order UPDATE with size_matched", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "order",
      type: "UPDATE",
      id: ORDER_ID,
      size_matched: "5",
    }, ORDER_ID)).toBe("matched");
  });

  it("ignores unrelated order id", () => {
    expect(interpretPolymarketUserWsMessage({
      event_type: "trade",
      type: "TRADE",
      status: "CONFIRMED",
      taker_order_id: "0xother",
    }, ORDER_ID)).toBeNull();
  });
});

describe("polymarketOrderRowFromUserWsMessage", () => {
  it("builds matched row with size", () => {
    const row = polymarketOrderRowFromUserWsMessage({
      status: "CONFIRMED",
      size: "8.5",
      id: "trade-1",
    }, "matched");
    expect(row.status).toBe("CONFIRMED");
    expect(row.size_matched).toBe("8.5");
    expect(row.associate_trades).toEqual(["trade-1"]);
  });
});
