import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPodPrefetchQueue, runPodPrefetch } from "./podPrefetchQueue";

afterEach(() => { clearPodPrefetchQueue(); vi.useRealTimers(); });
describe("POD prefetch budget", () => {
  it("limits concurrency and drops queued work that has expired", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const finish: Array<() => void> = [];
    const running = Array.from({ length: 3 }, () => runPodPrefetch(() => new Promise<void>(r => finish.push(r))));
    const work = vi.fn().mockResolvedValue("expired");
    const queued = runPodPrefetch(work, 1100);
    expect(work).not.toHaveBeenCalled();
    vi.setSystemTime(1101);
    finish.forEach(r => r());
    await Promise.all(running);
    expect(await queued).toBeUndefined();
    expect(work).not.toHaveBeenCalled();
    expect(await runPodPrefetch(async () => "next")).toBe("next");
  });
  it("bounds the queue and cancels waiting work on reset", async () => {
    const finish: Array<() => void> = [];
    const running = Array.from({ length: 3 }, () => runPodPrefetch(() => new Promise<void>(r => finish.push(r))));
    const work = vi.fn().mockResolvedValue("queued");
    const queued = Array.from({ length: 12 }, () => runPodPrefetch(work));
    expect(await runPodPrefetch(work)).toBeUndefined();
    clearPodPrefetchQueue();
    expect(await Promise.all(queued)).toEqual(Array(12).fill(undefined));
    finish.forEach(r => r());
    await Promise.all(running);
    expect(work).not.toHaveBeenCalled();
  });
});
