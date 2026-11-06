import { afterEach, expect, it, vi } from "vitest";
import { createPolymarketOrderMarketReader } from "../../../../polymarket/orders/history/orderMarketReader";
import type { PolymarketRawMarket } from "../../../../polymarket/markets/parse";

const condition = "0x" + "a".repeat(64);
const gamma = (version: "v1" | "v2" = "v1"): PolymarketRawMarket => ({ version, conditionId: condition, closed: true,
  ...(version === "v1" ? { clobTokenIds: '["101","102"]' } : { positionIds: ["201", "202"], clobTokenIds: '["101","102"]' }),
  outcomePrices: '["0.5","0.5"]', question: "Home vs Away - Map 1 Winner" });
function setup(respond: (url: URL) => unknown | Promise<unknown>) {
  const get = vi.fn(async (url: string) => respond(new URL(url)));
  const publish = vi.fn();
  const reader = createPolymarketOrderMarketReader({ get: async <T>(url: string) => await get(url) as T, publishMarket: publish });
  return { ...reader, get, publish, urls: () => get.mock.calls.map(([url]) => new URL(url)) };
}
afterEach(() => vi.restoreAllMocks());

it("empty identifiers never issue a request or publish metadata", async () => {
  const r = setup(() => { throw Error("unexpected network"); });
  expect((await r.read([], [])).size).toBe(0);
  expect(r.get).not.toHaveBeenCalled();
  expect(r.publish).not.toHaveBeenCalled();
});

it.each(["v1", "v2"] as const)("%s preserves request order, official overlay and metadata publication", async version => {
  const asset = version === "v1" ? "101" : "201", other = version === "v1" ? "102" : "202";
  const r = setup(url => url.hostname.includes("gamma") ? [gamma(version)] : {
    version, condition_id: condition, tokens: [{ token_id: asset, winner: false }, { token_id: other, winner: true }],
  });
  const result = await r.read([condition], [asset]);
  const urls = r.urls();
  expect(urls.map(url => url.pathname)).toEqual(["/markets/keyset", "/markets/keyset", `/markets/${condition}`]);
  expect(urls[0]!.searchParams.getAll("condition_ids")).toEqual([condition]);
  expect(urls[1]!.searchParams.getAll("clob_token_ids")).toEqual([asset]);
  expect(result.get(`token:${asset}`)).toBe(result.get(condition));
  expect(result.get(condition)?.tokens?.find(token => token.winner)?.token_id).toBe(other);
  expect(r.publish.mock.calls.at(-1)?.[0]).toBe(result.get(condition));
});

it.each(["v1", "v2"] as const)("%s fetches final half payouts only after public market snapshots", async version => {
  const ids = version === "v1" ? ["101", "102"] : ["201", "202"];
  const resolution = { condition_id: condition, status: "resolved", payouts: [500000, 500000] };
  const r = setup(url => url.hostname.includes("gamma") ? [gamma(version)]
    : url.pathname === "/v2/resolutions" ? { data: [resolution] }
      : { version, condition_id: condition, closed: true, tokens: ids.map(token_id => ({ token_id, winner: false })) });
  const result = await r.read([condition], [ids[0]!]);
  expect(r.urls().at(-1)?.pathname).toBe("/v2/resolutions");
  expect(r.urls().at(-1)?.searchParams.get("condition")).toBe(condition);
  expect(result.get(condition)?.finalResolution).toEqual(resolution);
  expect(r.publish.mock.calls.at(-1)?.[0].finalResolution).toEqual(resolution);
});

it("keyset failure uses the existing markets endpoint; an empty keyset does not", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const r = setup(url => {
    if (url.pathname === "/markets/keyset") throw Error("keyset unavailable");
    if (url.pathname === "/markets") return [gamma()];
    throw Error("CLOB unavailable");
  });
  expect((await r.read([condition])).get(condition)).toMatchObject({ version: "v1" });
  expect(r.urls().slice(0, 2).map(url => url.pathname)).toEqual(["/markets/keyset", "/markets"]);
  const empty = setup(() => []);
  await empty.read([condition]);
  expect(empty.urls().some(url => url.pathname === "/markets")).toBe(false);
});

it("V2 position lookup is used only for tokens missing from the prior Gamma lookup", async () => {
  const r = setup(url => url.searchParams.has("position_ids") ? [gamma("v2")] : []);
  const result = await r.read([], ["201"]);
  expect(r.urls().map(url => [url.searchParams.getAll("clob_token_ids"), url.searchParams.getAll("position_ids")]))
    .toEqual([[["201"], []], [[], ["201"]]]);
  expect(result.get("token:201")?.version).toBe("v2");
});

it("normalizes and deduplicates conditions and tokens without changing the requested closed scope", async () => {
  const r = setup(url => url.hostname.includes("gamma") ? [gamma()] : { condition_id: condition, tokens: [{ token_id: "101", winner: true }, { token_id: "102", winner: false }] });
  await r.read([` ${condition.toUpperCase()} `, condition], [" 101 ", "101"]);
  const requests = r.urls().filter(url => url.hostname.includes("gamma"));
  expect(requests).toHaveLength(2);
  expect(requests[0]!.searchParams.getAll("condition_ids")).toEqual([condition]);
  expect(requests[1]!.searchParams.getAll("clob_token_ids")).toEqual(["101"]);
  expect(requests.every(url => url.searchParams.get("closed") === "any")).toBe(true);
});

it.each(["wrongCondition", "unsupportedVersion", "differentAssets"] as const)("does not publish an invalid CLOB overlay: %s", async kind => {
  const r = setup(url => url.hostname.includes("gamma") ? [gamma()] : {
    version: kind === "unsupportedVersion" ? "future" : "v1",
    condition_id: kind === "wrongCondition" ? "other" : condition,
    tokens: [{ token_id: "101", winner: false }, { token_id: kind === "differentAssets" ? "999" : "102", winner: true }],
  });
  const result = await r.read([condition], ["101"]);
  expect(result.get(condition)?.tokens).toBeUndefined();
  expect(r.publish.mock.calls.every(([market]) => !market.tokens)).toBe(true);
});

it("a failed finality query retains the known market without fabricating a half payout", async () => {
  const r = setup(url => {
    if (url.hostname.includes("gamma")) return [gamma()];
    if (url.pathname === "/v2/resolutions") throw Error("finality unavailable");
    return { condition_id: condition, closed: true, tokens: [{ token_id: "101", winner: false }, { token_id: "102", winner: false }] };
  });
  const result = await r.read([condition]);
  expect(result.get(condition)?.finalResolution).toBeUndefined();
  expect(result.get(condition)).toBeDefined();
});

it("all read failures return no new market facts and never publish a result", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const r = setup(() => { throw Error("offline"); });
  expect((await r.read([condition], ["101"])).size).toBe(0);
  expect(r.publish).not.toHaveBeenCalled();
});

it("conditions, token/position fallbacks and finality retain the original twenty-item batches", async () => {
  const ids = Array.from({ length: 21 }, (_, i) => "0x" + String(i + 1).padStart(64, "0"));
  const tokens = ids.map((_, i) => String(1000 + i));
  const r = setup(url => url.hostname.includes("gamma") ? [] : url.pathname === "/v2/resolutions" ? { data: [] }
    : { version: "v1", condition_id: url.pathname.split("/").at(-1), closed: true,
      tokens: [{ token_id: "101", winner: false }, { token_id: "102", winner: false }] });
  await r.read(ids, tokens);
  for (const key of ["condition_ids", "clob_token_ids", "position_ids"])
    expect(r.urls().filter(url => url.searchParams.has(key)).map(url => url.searchParams.getAll(key).length)).toEqual([20, 1]);
  expect(r.urls().filter(url => url.pathname === "/v2/resolutions").map(url => url.searchParams.get("condition")!.split(",").length)).toEqual([20, 1]);
});
