import { beforeEach, expect, it, vi } from "vitest";
import { validateGtcConfirmedResult, syncGtcConfirmedResult, readGtcConfirmedResults, saveClientGtcOrders } from "./results.js";
const mock = vi.hoisted(() => ({ save: vi.fn(), owned: vi.fn(), fetch: vi.fn(), ordinary: vi.fn(), bind: vi.fn() }));
vi.mock("@changmen/db", async importOriginal => {
  const original = await importOriginal();
  return { resolveGtcFinancialOrder: original.resolveGtcFinancialOrder, isConfirmedClientBindLink: original.isConfirmedClientBindLink,
    isCreateAtPlaceholderLink: original.isCreateAtPlaceholderLink, isBackendBindPlaceholderLink: original.isBackendBindPlaceholderLink,
    isInsertTimePlaceholderLink: original.isInsertTimePlaceholderLink, isHashLink: original.isHashLink,
    savePmGtcConfirmedResult: mock.save, fetchOrdersByPlayerOrderIdsStrict: mock.fetch };
});
vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: mock.owned }));
vi.mock("../../account/order_store.js", () => ({ saveOrder: mock.ordinary, saveOrderBind: mock.bind }));
const hash = `0x${"a".repeat(64)}`, id = "11111111-1111-4111-8111-111111111111";
const fill = { key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "3.000001", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 };
const result = () => ({ executionId: id, orderId: hash, playerId: 1, linkId: -100, createdAt: 1, revision: 4,
  match: "m", bet: "b", item: "i", tokenId: "t", conditionId: "c", buyShares: "3.000001", principalUsdc: "1.5", feeUsdc: "0", fills: [fill],
  financial: { pmShares: 3.000001, pmFillPrice: 0.5, pmStakeUsdc: 1.5, pmFeeUsdc: 0, odds: 2, betMoney: 1.5 * 6.7 } });
// 与 api/client.ts 的 toA8PostBody + urlencoded HTTP 传输一致。
const formBody = body => Object.fromEntries(new URLSearchParams(Object.entries(body)
  .map(([key, value]) => [key, value && typeof value === "object" ? JSON.stringify(value) : String(value)])));
beforeEach(() => { vi.clearAllMocks(); mock.owned.mockResolvedValue({ ok: true, player: { provider: "Polymarket" } }); mock.fetch.mockResolvedValue([]); mock.save.mockResolvedValue(true); mock.ordinary.mockResolvedValue(true); mock.bind.mockResolvedValue(true); });
it("accepts the browser form-encoded confirmed result without weakening its validation", async () => {
  await expect(syncGtcConfirmedResult(formBody({ result: result() }), "owner")).resolves.toBe(true);
  expect(mock.save).toHaveBeenCalledExactlyOnceWith("owner", result());
  mock.save.mockClear();
  await expect(syncGtcConfirmedResult(formBody({ result: { ...result(), buyShares: "4" } }), "owner")).rejects.toThrow("不一致");
  expect(mock.save).not.toHaveBeenCalled();
});
it("reads exact financial originals from browser form-encoded anchors", async () => {
  await expect(readGtcConfirmedResults(formBody({ anchors: [{ executionId: id, playerId: 1, provider: "Polymarket", orderId: hash }] }), "owner")).resolves.toEqual([]);
  expect(mock.fetch).toHaveBeenCalledExactlyOnceWith(1, "owner", [hash]);
});
it("binds the screenshot's RAY placeholder through browser form-encoded origins", async () => {
  mock.owned.mockResolvedValue({ ok: true, player: { provider: "RAY" } });
  const order = { orderId: "ray-original", provider: "RAY", link: 1792058633922, pmGtcExecutionId: id };
  mock.fetch.mockResolvedValue([{ order_id: order.orderId, provider: "RAY", link: 1792058632999, create_at: 1792058633000, raw: {} }]);
  const body = formBody({ playerId: 2, type: "RAY", orders: [order], origins: [{ executionId: id, playerId: 2, provider: "RAY", orderId: order.orderId }] });
  expect(await saveClientGtcOrders(body, "owner")).toEqual({ ok: true, info: true });
  expect(mock.bind).toHaveBeenCalledExactlyOnceWith([{ OrderID: order.orderId, PlayerID: 2, Provider: "RAY", LinkID: order.link }], "owner");
  expect(mock.ordinary).toHaveBeenCalledExactlyOnceWith(2, [order], "owner", "RAY");
});
it.each(["{", "null", "[]", '"nested string"'])("rejects invalid form result %s before persistence", async value => {
  await expect(syncGtcConfirmedResult({ result: value }, "owner")).rejects.toThrow();
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.owned).not.toHaveBeenCalled();
});
it.each(["{", "null", "{}", "[null]"])("rejects invalid form identity lists %s before order access", async value => {
  await expect(readGtcConfirmedResults({ anchors: value }, "owner")).rejects.toThrow();
  expect(await saveClientGtcOrders({ playerId: 1, orders: "[]", origins: value }, "owner")).toMatchObject({ ok: false });
  expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.ordinary).not.toHaveBeenCalled(); expect(mock.bind).not.toHaveBeenCalled();
});
it("accepts confirmed partial fills with six-decimal shares and saves no control record", async () => {
  await expect(syncGtcConfirmedResult({ result: result() }, "owner")).resolves.toBe(true);
  expect(mock.owned).toHaveBeenCalledExactlyOnceWith(1, "owner"); expect(mock.save).toHaveBeenCalledExactlyOnceWith("owner", result());
});
it.each(["MATCHED", "MINED", "RETRYING"])("refuses intermediate %s fills", status => {
  expect(() => validateGtcConfirmedResult({ ...result(), fills: [{ ...fill, status }] }, "owner")).toThrow("已确认");
});
it.each(["pmAuthorized", "submit", "cancel", "other", "order", "plan"])("rejects process field %s", key => {
  expect(() => validateGtcConfirmedResult({ ...result(), [key]: {} }, "owner")).toThrow("已确认");
});
it("rejects unknown fees, duplicate fills and forged totals", () => {
  expect(() => validateGtcConfirmedResult({ ...result(), fills: [{ ...fill, fee: null }] }, "owner")).toThrow();
  expect(() => validateGtcConfirmedResult({ ...result(), fills: [fill, fill] }, "owner")).toThrow("重复");
  expect(() => validateGtcConfirmedResult({ ...result(), buyShares: "4" }, "owner")).toThrow("不一致");
  expect(() => validateGtcConfirmedResult({ ...result(), financial: { ...result().financial, betMoney: 100 } }, "owner")).toThrow("不一致");
});
it("accepts explicit FAILED rollback evidence, including zero cost", () => {
  const zero = { ...result(), buyShares: "0", principalUsdc: "0", fills: [{ ...fill, status: "FAILED" }], financial: { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 } };
  expect(validateGtcConfirmedResult(zero, "owner")).toEqual(zero);
});
it("rejects foreign or non-PM accounts before saving", async () => {
  for (const owned of [{ ok: false, msg: "foreign" }, { ok: true, player: { provider: "RAY" } }]) {
    mock.owned.mockResolvedValue(owned); await expect(syncGtcConfirmedResult({ result: result() }, "owner")).rejects.toThrow();
  }
  expect(mock.save).not.toHaveBeenCalled();
});
it("financial reads use only exact owned account/order identities", async () => {
  await readGtcConfirmedResults({ anchors: [{ executionId: id, playerId: 1, provider: "Polymarket", orderId: hash }] }, "owner");
  expect(mock.fetch).toHaveBeenCalledExactlyOnceWith(1, "owner", [hash]);
});
it("financial reads reject foreign rows and conflicting execution identities", async () => {
  const body = { anchors: [{ executionId: id, playerId: 1, provider: "Polymarket", orderId: hash }] };
  mock.fetch.mockResolvedValue([{ player_id: 1, user_id: "foreign", provider: "Polymarket", order_id: hash }]);
  await expect(readGtcConfirmedResults(body, "owner")).rejects.toThrow("账号归属");
  mock.fetch.mockResolvedValue([{ player_id: 1, user_id: "owner", provider: "Polymarket", order_id: hash, raw: { pmGtcExecutionId: "other" } }]);
  await expect(readGtcConfirmedResults(body, "owner")).rejects.toThrow("身份冲突");
});
it("manual sells require their already-synchronized canonical buy and retain the ordinary merger", async () => {
  const sell = { orderId: "sell", provider: "Polymarket", pmSide: "sell", pmBuyOrderId: hash, pmGtcExecutionId: id };
  const body = { playerId: 1, type: "Polymarket", orders: JSON.stringify([sell]), origins: [{ executionId: id, playerId: 1, provider: "Polymarket", orderId: hash }] };
  expect(await saveClientGtcOrders(body, "owner")).toMatchObject({ ok: false }); expect(mock.ordinary).not.toHaveBeenCalled();
  mock.fetch.mockResolvedValue([{ order_id: hash, raw: { pmGtcExecutionId: id } }]);
  expect(await saveClientGtcOrders(body, "owner")).toEqual({ ok: true, info: true });
  expect(mock.ordinary).toHaveBeenCalledWith(1, [sell], "owner", "Polymarket");
});
it.each(["RAY", "IM"])("late %s counterparts establish only their exact result identity through the ordinary merger", async provider => {
  mock.owned.mockResolvedValue({ ok: true, player: { provider } });
  const order = { orderId: "other", provider, link: -123, status: "reject", pmGtcExecutionId: id };
  mock.fetch.mockResolvedValue([{ order_id: "other", link: 0, raw: {} }]);
  const body = { playerId: 2, type: provider, orders: JSON.stringify([order]),
    origins: [{ executionId: id, playerId: 2, provider, orderId: "other" }] };
  expect(await saveClientGtcOrders(body, "owner")).toEqual({ ok: true, info: true });
  expect(mock.ordinary).toHaveBeenCalledExactlyOnceWith(2, [order], "owner", provider);
});
it("an unrelated confirmed Link or execution cannot be silently relabelled as a GTC counterpart", async () => {
  mock.owned.mockResolvedValue({ ok: true, player: { provider: "RAY" } });
  const order = { orderId: "other", provider: "RAY", link: -123, pmGtcExecutionId: id };
  const body = { playerId: 2, type: "RAY", orders: JSON.stringify([order]),
    origins: [{ executionId: id, playerId: 2, provider: "RAY", orderId: "other" }] };
  mock.fetch.mockResolvedValue([{ order_id: "other", link: -456, raw: {} }]);
  expect(await saveClientGtcOrders(body, "owner")).toMatchObject({ ok: false, msg: expect.stringContaining("其他 Link") });
  mock.fetch.mockResolvedValue([{ order_id: "other", link: -123, raw: { pmGtcExecutionId: "different" } }]);
  expect(await saveClientGtcOrders(body, "owner")).toMatchObject({ ok: false });
  expect(mock.ordinary).not.toHaveBeenCalled();
});
it.each(["legacy", "backend", "insert"])("fixes the %s placeholder through exact binding before the ordinary protected Link save", async kind => {
  mock.owned.mockResolvedValue({ ok: true, player: { provider: "RAY" } });
  const created = 1791558222471;
  const oldLink = kind === "legacy" ? created : kind === "backend" ? created - 1 : created + 1000;
  mock.fetch.mockResolvedValue([{ order_id: "OTHER", provider: "RAY", link: oldLink, create_at: created, raw: {} }]);
  const order = { orderId: "other", provider: "RAY", link: created - 5000, pmGtcExecutionId: id };
  const body = { playerId: 2, type: "RAY", orders: JSON.stringify([order]),
    origins: [{ executionId: id, playerId: 2, provider: "RAY", orderId: "other" }] };
  expect(await saveClientGtcOrders(body, "owner")).toEqual({ ok: true, info: true });
  expect(mock.bind).toHaveBeenCalledExactlyOnceWith([{ OrderID: "OTHER", PlayerID: 2, Provider: "RAY", LinkID: order.link }], "owner");
  expect(mock.bind.mock.invocationCallOrder[0]).toBeLessThan(mock.ordinary.mock.invocationCallOrder[0]);
  mock.bind.mockResolvedValue(false); mock.ordinary.mockClear();
  expect(await saveClientGtcOrders(body, "owner")).toMatchObject({ ok: false, msg: expect.stringContaining("关联失败") });
  expect(mock.ordinary).not.toHaveBeenCalled();
});
it("repeated synchronization preserves a user's existing Link for an already identified GTC order", async () => {
  mock.owned.mockResolvedValue({ ok: true, player: { provider: "RAY" } });
  mock.fetch.mockResolvedValue([{ order_id: "other", link: -456, raw: { pmGtcExecutionId: id } }]);
  const order = { orderId: "other", provider: "RAY", link: -123, pmGtcExecutionId: id };
  expect(await saveClientGtcOrders({ playerId: 2, type: "RAY", orders: JSON.stringify([order]),
    origins: [{ executionId: id, playerId: 2, provider: "RAY", orderId: "other" }] }, "owner")).toEqual({ ok: true, info: true });
  expect(mock.bind).not.toHaveBeenCalled();
});
