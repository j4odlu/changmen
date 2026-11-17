/**
 * resolveSaveOrderLink：已绑正 EV / 9999 不得被场馆占位 link 覆盖。
 */
import { describe, expect, it } from "vitest";
import { OB_SINGLE_LINK_BASE, VALUE_BET_LINK_BASE } from "@changmen/db";
import { resolveSaveOrderLink } from "./link.js";

describe("resolveSaveOrderLink preserves EV / 9999 binds", () => {
  const orderId = "ord-1";
  const createAt = 1_756_000_000_000;
  const existing = new Map([
    [orderId, { order_id: orderId, link: 0, create_at: createAt }],
  ]);

  it("keeps OB single mode after venue order synchronization", () => {
    const ob = -(OB_SINGLE_LINK_BASE + createAt);
    existing.set(orderId, { order_id: orderId, link: ob, create_at: createAt });
    expect(resolveSaveOrderLink(
      { Link: createAt, OrderID: orderId }, {}, orderId, createAt,
      new Map(), existing, new Map(), "OB",
    )).toBe(ob);
  });

  it("keeps value-bet link when SaveOrder brings create_at placeholder", () => {
    const vb = -(VALUE_BET_LINK_BASE + createAt);
    existing.set(orderId, { order_id: orderId, link: vb, create_at: createAt });
    const link = resolveSaveOrderLink(
      { Link: createAt, OrderID: orderId },
      {},
      orderId,
      createAt,
      new Map(),
      existing,
      new Map(),
      "OB",
    );
    expect(link).toBe(vb);
  });

  it("keeps 9999 single-leg link when SaveOrder brings create_at", () => {
    const single = -createAt;
    existing.set(orderId, { order_id: orderId, link: single, create_at: createAt });
    const link = resolveSaveOrderLink(
      { Link: createAt, OrderID: orderId },
      {},
      orderId,
      createAt,
      new Map(),
      existing,
      new Map(),
      "RAY",
    );
    expect(link).toBe(single);
  });

  it("still keeps positive arb link", () => {
    const arb = createAt + 12;
    existing.set(orderId, { order_id: orderId, link: arb, create_at: createAt });
    const link = resolveSaveOrderLink(
      { Link: createAt, OrderID: orderId },
      {},
      orderId,
      createAt,
      new Map(),
      existing,
      new Map(),
      "OB",
    );
    expect(link).toBe(arb);
  });
});
