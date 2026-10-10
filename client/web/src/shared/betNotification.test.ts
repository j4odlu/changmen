import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyBet, showBetResultNotification, startBetNotification } from "./betNotification";

const mocks = vi.hoisted(() => ({ notify: vi.fn(), close: vi.fn() }));
vi.mock("element-plus", () => ({ ElNotification: mocks.notify }));
const account = { provider: "RAY", accountId: 1, platformName: "场馆", venueAccountName: "账号" } as PlatformAccount;
const option = { target: "Home", betMoney: 10, odds: 2 } as BetOption;
const present = (result: BetResult) => ({ type: "success" as const, message: result.message || "下单成功" });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockReset().mockReturnValue({ close: mocks.close });
});

describe("shared betting notifications", () => {
  it.each([0, 10, 30])("uses the same location, appearance and duration for every submission (%s seconds)", (seconds) => {
    const display = { provider: "OB", accountLine: "场馆 / 账号", detailHtml: "<p>赛事与金额</p>" };
    const loading = startBetNotification(display);
    loading.close();
    showBetResultNotification(display, { type: "warning", messageHtml: "<p>成交待确认</p>", statusSuffix: "确认中" }, seconds);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: "top-right", customClass: "notification loading OB", duration: 10_000 }));
    expect(mocks.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: "top-right", customClass: "notification OB", type: "warning", duration: seconds === 0 ? 3000 : seconds * 1000, message: expect.stringContaining("确认中") }));
  });
  it("shows the counterpart loading and result while returning the identical adapter result", async () => {
    const result = { success: true, message: "accepted <ok>" } as BetResult;
    const run = vi.fn(async () => result);
    expect(await notifyBet(account, option, run, present)).toBe(result);
    expect(run).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: "top-right", customClass: "notification loading RAY", message: expect.stringContaining("场馆 / 账号") }));
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: "top-right", type: "success", message: expect.stringContaining("accepted &lt;ok&gt;") }));
  });
  it("closes loading on a POST exception and preserves the original exception without retry", async () => {
    const error = new Error("POST timeout");
    const run = vi.fn(async () => { throw error; });
    await expect(notifyBet(account, option, run, present)).rejects.toBe(error);
    expect(run).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", message: expect.stringContaining("核对订单状态") }));
  });
  it("notification rendering failure cannot suppress or retry the actual submission", async () => {
    mocks.notify.mockImplementation(() => { throw new Error("UI unavailable"); });
    const result = { success: true } as BetResult;
    const run = vi.fn(async () => result);
    expect(await notifyBet(account, option, run, present)).toBe(result);
    expect(run).toHaveBeenCalledOnce();
  });
});
