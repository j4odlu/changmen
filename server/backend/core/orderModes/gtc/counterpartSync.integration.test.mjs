import { beforeEach, expect, it, vi } from "vitest";
import { saveClientGtcOrders } from "./results.js";
import { saveOrder } from "../../account/order_store.js";

const mock = vi.hoisted(() => ({ rows: [], provider: "RAY", bind: vi.fn(), upsert: vi.fn() }));
vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: async () => ({ ok: true, player: { provider: mock.provider } }) }));
vi.mock("@changmen/db", async importOriginal => {
  const original = await importOriginal();
  return { ...original,
    fetchOrdersByPlayerOrderIdsStrict: async (player, owner, ids) => structuredClone(mock.rows.filter(row => row.user_id === owner
      && row.player_id === player && ids.some(id => id.toLowerCase() === row.order_id.toLowerCase()))),
    updateOrderBind: async (id, owner, link, options) => {
      const row = mock.rows.find(row => row.user_id === owner && row.player_id === options.playerId && row.order_id === id);
      if (!row || !original.shouldAllowOrderBind(row, link)) return false;
      mock.bind(id, owner, link, options); row.link = link; return true;
    },
    upsertOrders: async rows => {
      mock.upsert(rows);
      for (const row of rows) {
        const at = mock.rows.findIndex(old => old.user_id === row.user_id && old.player_id === row.player_id && old.order_id === row.order_id);
        if (at < 0) mock.rows.push(structuredClone(row)); else mock.rows[at] = structuredClone(row);
      }
      return true;
    },
  };
});
const id = "11111111-1111-4111-8111-111111111111";
const created = 1791558222471;
beforeEach(() => { vi.clearAllMocks(); mock.rows = []; });
it.each(["RAY", "IM"])("late %s attribution corrects the real ordinary writer's existing placeholder and survives later normal saves", async provider => {
  mock.provider = provider;
  const original = { orderId: "other-original", provider, createAt: created, betMoney: 100, money: 0,
    odds: 2, status: "none", match: "m", bet: "b", item: "i" };
  expect(await saveOrder(2, [original], "owner", provider)).toBe(true);
  expect(mock.rows[0].link).toBe(created - 1);
  const confirmed = { ...original, pmGtcExecutionId: id, link: created - 5000, status: "reject" };
  const body = { playerId: 2, type: provider, orders: JSON.stringify([confirmed]),
    origins: [{ executionId: id, playerId: 2, provider, orderId: original.orderId }] };
  expect(await saveClientGtcOrders(body, "owner")).toEqual({ ok: true, info: true });
  expect(mock.rows).toHaveLength(1);
  expect(mock.rows[0]).toMatchObject({ link: confirmed.link, status: "Reject", raw: { pmGtcExecutionId: id } });
  expect(mock.bind).toHaveBeenCalledExactlyOnceWith(original.orderId, "owner", confirmed.link, { playerId: 2, provider });
  expect(await saveClientGtcOrders(body, "owner")).toEqual({ ok: true, info: true });
  expect(mock.bind).toHaveBeenCalledOnce();
  expect(await saveOrder(2, [{ ...original, status: "reject" }], "owner", provider)).toBe(true);
  expect(mock.rows[0]).toMatchObject({ link: confirmed.link, status: "Reject", raw: { pmGtcExecutionId: id } });
  expect(mock.rows).toHaveLength(1);
});
