import { expect, it, vi } from "vitest";
import { createPmDisplayFeeLoader } from "./pmDisplayFees";

const fee = { feeRate: .05, exponent: 1, takerOnly: true };
it("deduplicates simultaneous sides and caches by market, independently of price changes", async () => {
  let clock = 100;
  const read = vi.fn().mockResolvedValue(fee);
  const load = createPmDisplayFeeLoader(read, () => clock);
  const home = load("market");
  const away = load("market");
  expect(home).toBe(away);
  expect(await home).toEqual(fee);
  clock += 299_999;
  expect(await load("market")).toEqual(fee);
  expect(read).toHaveBeenCalledOnce();
  clock += 2;
  await load("market");
  expect(read).toHaveBeenCalledTimes(2);
});
it("backs off unknown or failed fees and recovers without pretending the rate is zero", async () => {
  let clock = 100;
  const read = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(undefined).mockResolvedValue(fee);
  const load = createPmDisplayFeeLoader(read, () => clock);
  expect(await load("market")).toBeUndefined();
  expect(await load("market")).toBeUndefined();
  expect(read).toHaveBeenCalledOnce();
  clock += 30_001;
  expect(await load("market")).toBeUndefined();
  clock += 30_001;
  expect(await load("market")).toEqual(fee);
  expect(await load("")).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(3);
});
it("bounds display requests when enabling many markets at once", async () => {
  const complete: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const read = vi.fn(() => new Promise<typeof fee>(resolve => {
    peak = Math.max(peak, ++active);
    complete.push(() => { active--; resolve(fee); });
  }));
  const load = createPmDisplayFeeLoader(read);
  const requests = Array.from({ length: 12 }, (_, i) => load(String(i)));
  for (let i = 0; i < 12; i++) {
    await vi.waitFor(() => expect(complete.length).toBeGreaterThan(0));
    complete.shift()!();
  }
  await Promise.all(requests);
  expect(peak).toBe(4);
});
