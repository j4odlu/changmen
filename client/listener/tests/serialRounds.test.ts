import { describe, expect, it } from "vitest";
import { SerialRounds } from "../module/serialRounds";
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
describe("standalone listener serial execution", () => {
  it("serializes maintenance and notification bodies", async () => {
    const queue = new SerialRounds(); const order: string[] = []; let release!: () => void;
    const first = queue.run(async () => { order.push("maintenance:start"); await new Promise<void>(resolve => { release = resolve; }); order.push("maintenance:end"); });
    const second = queue.run(async () => { order.push("notification"); });
    await flush(); expect(order).toEqual(["maintenance:start"]);
    release(); await Promise.all([first, second]); expect(order).toEqual(["maintenance:start", "maintenance:end", "notification"]);
  });
  it("propagates errors to the original caller and permits later work", async () => {
    const queue = new SerialRounds(); let next = false;
    await expect(queue.run(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await queue.run(async () => { next = true; }); expect(next).toBe(true);
  });
  it("drains the current body and skips pending work on stop", async () => {
    const queue = new SerialRounds(); const order: number[] = []; let release!: () => void;
    const first = queue.run(async () => { order.push(1); await new Promise<void>(resolve => { release = resolve; }); order.push(2); });
    const pending = queue.run(async () => { order.push(3); }); await flush();
    let stopped = false; const stopping = queue.cancel().then(() => { stopped = true; });
    await flush(); expect(stopped).toBe(false); release(); await Promise.all([first, pending, stopping]);
    expect(order).toEqual([1, 2]); expect(stopped).toBe(true);
  });
  it("accepts a fresh generation after stop without overlapping in-flight work", async () => {
    const queue = new SerialRounds(); const order: number[] = []; let release!: () => void;
    const old = queue.run(async () => { order.push(1); await new Promise<void>(resolve => { release = resolve; }); order.push(2); });
    await flush(); const stopping = queue.cancel(); const fresh = queue.run(async () => { order.push(3); });
    await flush(); expect(order).toEqual([1]); release(); await Promise.all([old, stopping, fresh]); expect(order).toEqual([1, 2, 3]);
  });
});
