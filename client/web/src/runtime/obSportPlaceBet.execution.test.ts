import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeObSportSingle, OB_SPORT_PROCESS_BET_PATH, OB_SPORT_QUERY_MARKET_PATH } from "@/runtime/obSportPlaceBet";
import { clearObSportMarketMeta, rememberObSportMarketMeta } from "@/runtime/obSportMarketMeta";
import { ObSportApiError } from "@/runtime/obSportApiError";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/obSportFootballFetch", () => ({ postObSportPb: post }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: [] }) }));
vi.mock("@/runtime/obSportBetAccount", () => ({
  pickObSportBetAccount: () => ({}),
  sportObSessionFromAccount: () => ({ token: "bet-token", gateway: "https://sport.example", sessionId: "123456789012345678" }),
  isObSportMemberId: () => true,
}));
vi.mock("@/runtime/obSportSessionLocal", () => ({ readLocalSportObSession: () => null }));

const request = { oid: "over", mid: "5505659", stake: 50, odds: 1.95,
  marketCode: "totals", boardSide: "over", line: 2.5, minOdds: 1.9, maxOdds: 2.2 };
const detail = { mid: request.mid, hps: [{ hpid: "2", hl: [{ hid: "hid", hv: "2.5", ol: [
  { oid: "over", ot: "Over", ov: 195000 }, { oid: "under", ot: "Under", ov: 190000 },
] }] }] };
function query(odds: number) {
  return { data: { hls: [{ ol: [{ oid: "over", hid: "hid", hpid: "2", mid: request.mid, ov: odds * 100000 }] }] } };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  clearObSportMarketMeta();
  rememberObSportMarketMeta("https://sport.example", detail);
  post.mockReset();
});
afterEach(() => { vi.useRealTimers(); clearObSportMarketMeta(); });

describe("OB final submission checks", () => {
  it("retries an explicit API envelope rejection without confusing it with a transport timeout", async () => {
    post.mockResolvedValueOnce(query(1.95))
      .mockRejectedValueOnce(new ObSportApiError(OB_SPORT_PROCESS_BET_PATH, "0402012", "盘口已变"))
      .mockResolvedValueOnce(detail).mockResolvedValueOnce(query(2))
      .mockResolvedValueOnce({ orderDetailRespList: [{ orderNo: "retry-envelope", orderStatusCode: 1 }] });
    expect(await placeObSportSingle(request)).toMatchObject({ ok: true, orderId: "retry-envelope" });
    expect(post).toHaveBeenCalledTimes(5);
  });
  it("does not replace an explicit locked precheck quote with a positive detail or requested quote", async () => {
    post.mockResolvedValueOnce(query(0));
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, message: expect.stringContaining("锁定") });
    expect(post.mock.calls.map(c => c[0])).toEqual([OB_SPORT_QUERY_MARKET_PATH]);
  });
  it("preserves a pending submission as unknown", async () => {
    post.mockResolvedValueOnce(query(1.95)).mockResolvedValueOnce({ orderDetailRespList: [{ orderStatusCode: 0, orderNo: "pending" }] });
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, outcomeUnknown: true });
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("refreshes the exact selection after an explicit odds rejection and submits at most twice", async () => {
    post.mockResolvedValueOnce(query(1.95))
      .mockResolvedValueOnce({ orderDetailRespList: [{ orderStatusCode: 2, msg: "Odds have been changed" }] })
      .mockResolvedValueOnce(detail).mockResolvedValueOnce(query(2))
      .mockResolvedValueOnce({ orderDetailRespList: [{ orderNo: "retry-order", orderStatusCode: 1 }] });
    expect(await placeObSportSingle(request)).toMatchObject({ ok: true, odds: 2 });
    expect(post.mock.calls.map(c => c[0])).toEqual([OB_SPORT_QUERY_MARKET_PATH, OB_SPORT_PROCESS_BET_PATH,
      "/yewu11/v1/w/getMatchBaseInfoByOddsPB", OB_SPORT_QUERY_MARKET_PATH, OB_SPORT_PROCESS_BET_PATH]);
  });
  it("preserves unknown on the retry submission and never retries a transport error", async () => {
    post.mockResolvedValueOnce(query(1.95))
      .mockResolvedValueOnce({ orderDetailRespList: [{ orderStatusCode: 2, msg: "Odds have been changed" }] })
      .mockResolvedValueOnce(detail).mockResolvedValueOnce(query(2))
      .mockRejectedValueOnce(new Error("timeout 0402012"));
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, outcomeUnknown: true });
    expect(post).toHaveBeenCalledTimes(5);
  });
  it("does not retry when the submission response has no order id", async () => {
    post.mockResolvedValueOnce(query(1.95)).mockResolvedValueOnce({});
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, outcomeUnknown: true });
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("rejects a final quote above the EV ceiling without submitting", async () => {
    post.mockResolvedValueOnce(query(2.4));
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, message: expect.stringContaining("EV 上限") });
    expect(post.mock.calls.map(c => c[0])).toEqual([OB_SPORT_QUERY_MARKET_PATH]);
  });
  it("rejects expiration during precheck", async () => {
    post.mockImplementationOnce(async () => { vi.setSystemTime(100101); return query(1.95); });
    expect(await placeObSportSingle({ ...request, submitBefore: 100100 })).toMatchObject({ ok: false, message: expect.stringContaining("过期") });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("skips even the precheck if the deadline has passed", async () => {
    expect((await placeObSportSingle({ ...request, submitBefore: 100000 })).ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
  it("uses fresh list identifiers, still prechecks, and submits a valid quote", async () => {
    post.mockResolvedValueOnce(query(1.95)).mockResolvedValueOnce({ orderDetailRespList: [{ orderNo: "order-1", orderStatusCode: 1 }] });
    expect(await placeObSportSingle(request)).toMatchObject({ ok: true, orderId: "order-1" });
    expect(post.mock.calls.map(c => c[0])).toEqual([OB_SPORT_QUERY_MARKET_PATH, OB_SPORT_PROCESS_BET_PATH]);
  });
  it("falls back to detail when metadata expires", async () => {
    vi.setSystemTime(116000);
    post.mockResolvedValueOnce(detail).mockResolvedValueOnce(query(2.4));
    await placeObSportSingle(request);
    expect(post.mock.calls[0]?.[0]).toContain("getMatchBaseInfoByOddsPB");
    expect(post.mock.calls[1]?.[0]).toBe(OB_SPORT_QUERY_MARKET_PATH);
  });
  it("checks account detail odds when precheck only returns limits despite cached identifiers", async () => {
    post.mockResolvedValueOnce({ data: { betAmountInfo: [{ playOptionsId: "over", playId: "2", marketId: "hid", minBet: 10, maxBet: 100 }] } })
      .mockResolvedValueOnce({ ...detail, hps: [{ hpid: "2", hl: [{ hid: "hid", hv: "2.5", ol: [{ oid: "over", ot: "Over", ov: 180000 }] }] }] });
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, message: expect.stringContaining("低于门槛") });
    expect(post.mock.calls.map(c => c[0])).toEqual([OB_SPORT_QUERY_MARKET_PATH, "/yewu11/v1/w/getMatchBaseInfoByOddsPB"]);
  });
  it("still submits when the account detail quote satisfies the limits", async () => {
    post.mockResolvedValueOnce({ data: { betAmountInfo: [{ playOptionsId: "over", playId: "2", marketId: "hid", minBet: 10, maxBet: 100 }] } })
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ orderDetailRespList: [{ orderNo: "order-2", orderStatusCode: 1 }] });
    expect(await placeObSportSingle(request)).toMatchObject({ ok: true, orderId: "order-2", odds: 1.95 });
    expect(post.mock.calls.map(c => c[0])).toEqual([OB_SPORT_QUERY_MARKET_PATH, "/yewu11/v1/w/getMatchBaseInfoByOddsPB", OB_SPORT_PROCESS_BET_PATH]);
    const body = post.mock.calls[2]?.[1];
    expect(body.seriesOrders[0].orderDetailList[0]).toMatchObject({ playOptionsId: "over", marketId: "hid", oddFinally: 1.95 });
  });
  it("does not submit the original quote if the missing account quote cannot be refreshed", async () => {
    post.mockResolvedValueOnce({ data: { betAmountInfo: [{ playOptionsId: "over", playId: "2", marketId: "hid", minBet: 10 }] } })
      .mockRejectedValueOnce(new Error("detail unavailable"));
    expect(await placeObSportSingle(request)).toMatchObject({ ok: false, message: "下注账号未返回有效赔率" });
    expect(post.mock.calls.map(c => c[0])).not.toContain(OB_SPORT_PROCESS_BET_PATH);
  });
});
