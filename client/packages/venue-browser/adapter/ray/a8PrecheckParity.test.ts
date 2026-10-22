import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { rayProvider } from "./bet";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./accountHttp", () => ({ accountGet: http.get, accountPostForm: http.post }));
vi.mock("@changmen/venue-browser/shared/webBridge", () => ({
  useMessageStore: () => ({ limitMessage: () => "limit" }),
}));

// [A8 可证实] 原样提取 index0706.js rHe.checkBet，在相同输入下比较原实现而非手写预期逻辑。
const fixture = JSON.parse(readFileSync(new URL("./fixtures/a8RayPrecheck.json", import.meta.url), "utf8")) as {
  checkBet: string;
};
const account = { provider: "RAY", gateway: "https://ray.example", token: "Bearer t" } as PlatformAccount;

function row(overrides: Record<string, unknown> = {}) {
  return {
    odds_id: 100, id: 100, enable_parlay: 1, status: 1, odds: "1.88", bet_limit: [10, 3000],
    odds_group_id: 200, value: "home", win: -1, last_update: "1792536816", match_stage: "final",
    match_name: "A vs B", group_name: "获胜者", group_short_name: "Winner", team_id: 300,
    name: "A", match_id: 400, tag: "win", game_id: 140, start_time: "2000-01-01",
    ...overrides,
  };
}
function quote(overrides: Record<string, unknown> = {}) {
  return { code: 200, result: { start_time: "2099-01-01T00:00:00Z", odds: [row(overrides)] } };
}
function option(overrides: Record<string, unknown> = {}): BetOption {
  return { type: "RAY", matchId: "400", betId: "200", itemId: "100", betMoney: 100, odds: 1.89,
    data: null, updateOdds: vi.fn(), ...overrides } as unknown as BetOption;
}
function original(response: unknown) {
  return vm.runInNewContext(`({ ${fixture.checkBet} }).checkBet`, {
    gr: { get: async () => ({ data: response }) }, wr: { axios: "axios" }, l1: () => ({}),
    Ha: () => ({ send: { LimitMessage: () => "limit" } }), Date,
  }) as (this: { account: PlatformAccount }, input: BetOption) => Promise<BetOption>;
}
const wire = (value: unknown) => JSON.stringify(value);

describe("RAY precheck matches original A8", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T00:00:00Z")); http.get.mockReset(); http.post.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it("pins the extracted original method", () => {
    expect(createHash("sha256").update(fixture.checkBet).digest("hex")).toBe("652ed5c9fe486a506e972474095f8d820afebb375fed1d8e5934344b3e21d03c");
  });

  const cases: Array<[string, () => unknown, Record<string, unknown>?]> = [
    ["normal full snapshot", () => quote()],
    ["increasing odds", () => quote({ odds: "2.10" })],
    ["falling odds", () => quote({ odds: "1.50" })],
    ["one cent floating boundary", () => quote({ odds: "2.01" }), { odds: 2.02 }],
    ["exact minimum", () => quote(), { betMoney: 10 }],
    ["exact maximum", () => quote(), { betMoney: 3000 }],
    ["below minimum", () => quote(), { betMoney: 9 }],
    ["above maximum", () => quote(), { betMoney: 3001 }],
    ["round only in payload", () => quote(), { betMoney: 100.6 }],
    ["non parlay", () => quote({ enable_parlay: 0 })],
    ["string parlay flag", () => quote({ enable_parlay: "1" })],
    ["locked", () => quote({ status: 2 })],
    ["string status", () => quote({ status: "1" })],
    ["business error", () => ({ code: 401, desc: "not authorized" })],
    ["live match", () => ({ ...quote(), result: { ...quote().result, start_time: "2000-01-01" } })],
    ["live determined by response, not row", () => quote({ start_time: "2000-01-01" })],
    ["exact start time is not live", () => ({ ...quote(), result: { ...quote().result, start_time: new Date().toISOString() } })],
    ["preserve existing error", () => quote(), { checkError: "earlier" }],
    ["business failure preserves existing data", () => ({ code: 401 }), { data: { previous: true } }],
    ["price failure preserves existing data", () => quote({ odds: "1.50" }), { data: { previous: true } }],
  ];

  it.each(cases)("%s", async (_name, makeResponse, overrides) => {
    const response = makeResponse(); http.get.mockResolvedValue(response);
    const reference = option(overrides), actual = option(overrides);
    const capture = async (run: () => Promise<BetOption>) => {
      try { return { value: await run(), error: undefined }; }
      catch (error) { return { value: undefined, error: (error as Error).name }; }
    };
    const expected = await capture(() => original(response).call({ account }, reference));
    const observed = await capture(() => rayProvider.checkBet(account, actual));
    expect(observed.error).toBe(expected.error);
    if (!expected.error) expect(observed.value).toBe(actual);
    expect(actual.response).toBe(reference.response);
    expect(actual.checkError).toBe(reference.checkError);
    expect(actual.odds).toBe(reference.odds);
    expect(actual.betMoney).toBe(reference.betMoney);
    expect(wire(actual.data)).toBe(wire(reference.data));
    expect(vi.mocked(actual.updateOdds).mock.calls).toEqual(vi.mocked(reference.updateOdds).mock.calls);
    expect(http.post).not.toHaveBeenCalled();
  });

  it("sends the complete prepared A8 JSON unchanged", async () => {
    const response = quote(); http.get.mockResolvedValue(response);
    const input = option(), expected = option();
    await original(response).call({ account }, expected);
    await rayProvider.checkBet(account, input);
    http.post.mockResolvedValue({ code: 200, result: 900 });
    const result = await rayProvider.betting(account, input);
    expect(result.success).toBe(true);
    expect(http.post).toHaveBeenCalledExactlyOnceWith(account, "/v2/order", { order: wire(expected.data) });
    expect(input.data).toEqual(expected.data);
  });
});
