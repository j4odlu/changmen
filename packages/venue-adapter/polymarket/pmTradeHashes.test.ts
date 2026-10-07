import { describe, expect, it, vi } from "vitest";
import {
  collectPolymarketHashesFromTrades,
  enrichPolymarketOrderTradeHashes,
  isPolymarketTradeHashResolved,
  needsPolymarketTradeHashEnrichment,
  withPolymarketTransactionHashes,
} from "./pmTradeHashes";

describe("needsPolymarketTradeHashEnrichment", () => {
  it("true when tradeIDs present and hashes empty", () => {
    expect(needsPolymarketTradeHashEnrichment({
      tradeIDs: ["t1"],
    })).toBe(true);
  });

  it("false when hashes already present", () => {
    expect(needsPolymarketTradeHashEnrichment({
      tradeIDs: ["t1"],
      transactionsHashes: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    })).toBe(false);
  });

  it("false when no tradeIDs", () => {
    expect(needsPolymarketTradeHashEnrichment({
      transactionsHashes: [],
    })).toBe(false);
  });
});

describe("isPolymarketTradeHashResolved", () => {
  it("true for FAILED or non-empty hash", () => {
    expect(isPolymarketTradeHashResolved({ id: "a", status: "FAILED" })).toBe(true);
    expect(isPolymarketTradeHashResolved({
      id: "b",
      transaction_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    })).toBe(true);
    expect(isPolymarketTradeHashResolved({ id: "c", status: "MATCHED" })).toBe(false);
  });
});

describe("collectPolymarketHashesFromTrades", () => {
  it("collects hashes and marks FAILED without hash", () => {
    const out = collectPolymarketHashesFromTrades(
      ["a", "b", "c"],
      [
        { id: "a", transaction_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        { id: "b", status: "FAILED" },
        { id: "c" },
      ],
    );
    expect(out.hashes).toEqual([
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
    expect(out.failedIds).toEqual(["b"]);
    expect(out.pendingIds).toEqual(["c"]);
  });
});

describe("enrichPolymarketOrderTradeHashes", () => {
  it("a hung trade lookup cannot extend the ACK enrichment deadline", async () => {
    vi.useFakeTimers();
    try {
      const result = { success: true, orderID: "order", tradeIDs: ["trade"] };
      const promise = enrichPolymarketOrderTradeHashes(result, {
        fetchTradesById: () => new Promise(() => {}), timeoutMs: 300, intervalMs: 50,
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(await promise).toBe(result);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("returns original when enrichment not needed", async () => {
    const result = { success: true, orderID: "0x1" };
    const fetchTradesById = vi.fn();
    const out = await enrichPolymarketOrderTradeHashes(result, { fetchTradesById, timeoutMs: 500 });
    expect(out).toBe(result);
    expect(fetchTradesById).not.toHaveBeenCalled();
  });

  it("polls each tradeID via fetchTradesById (official shape)", async () => {
    const hash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const result = { success: true, tradeIDs: ["trade-1", "trade-2"] };
    const fetchTradesById = vi.fn(async (id: string) => {
      if (id === "trade-1")
        return [{ id: "trade-1", transaction_hash: hash, status: "CONFIRMED" }];
      if (id === "trade-2")
        return [{ id: "trade-2", status: "FAILED" }];
      return [];
    });
    const out = await enrichPolymarketOrderTradeHashes(result, {
      fetchTradesById,
      intervalMs: 50,
      timeoutMs: 500,
    });
    expect(fetchTradesById).toHaveBeenCalledWith("trade-1");
    expect(fetchTradesById).toHaveBeenCalledWith("trade-2");
    expect(out.transactionsHashes).toEqual([hash]);
    expect(out.transactionHashes).toBeUndefined();
  });

  it("returns original on timeout without hashes", async () => {
    const result = { success: true, tradeIDs: ["trade-missing"] };
    const fetchTradesById = vi.fn(async () => []);
    const out = await enrichPolymarketOrderTradeHashes(result, {
      fetchTradesById,
      intervalMs: 40,
      timeoutMs: 120,
    });
    expect(out).toEqual(result);
    expect(out.transactionsHashes).toBeUndefined();
  });

  it("withPolymarketTransactionHashes writes official field name only", () => {
    const hash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    expect(withPolymarketTransactionHashes({ tradeIDs: ["x"] }, [hash])).toEqual({
      tradeIDs: ["x"],
      transactionsHashes: [hash],
    });
  });
});
