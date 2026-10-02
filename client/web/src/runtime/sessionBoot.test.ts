import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ init: vi.fn(), config: vi.fn(), sync: vi.fn(), start: vi.fn(), stop: vi.fn(), prime: vi.fn() }));
vi.mock("@/stores/account/polymarketVenueSync", () => ({}));
vi.mock("@/stores/collectStore", () => ({ useCollectStore: () => ({ init: mocks.init }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ init: vi.fn() }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ loadConfig: mocks.config, syncPbCollectModeFromLocal: mocks.sync }) }));
vi.mock("@/runtime/collectors", () => ({ startCollectors: mocks.start, stopCollectors: mocks.stop }));
vi.mock("@changmen/venue-adapter/stake", () => ({ primeStakeTabId: mocks.prime }));
import { bootSessionRuntime, stopSessionRuntime } from "./sessionBoot";
beforeEach(() => { stopSessionRuntime(); vi.clearAllMocks(); mocks.init.mockResolvedValue(undefined); mocks.start.mockResolvedValue(undefined); });
describe("session runtime initialization", () => {
  it("allows retry after configuration fails", async () => {
    mocks.init.mockRejectedValueOnce(new Error("offline"));
    await expect(bootSessionRuntime()).rejects.toThrow("offline");
    await bootSessionRuntime();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it("shares concurrent initialization", async () => {
    await Promise.all([bootSessionRuntime(), bootSessionRuntime()]);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it("does not start collectors after logout during configuration loading", async () => {
    let release!: () => void;
    mocks.init.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const old = bootSessionRuntime();
    await Promise.resolve();
    stopSessionRuntime();
    release();
    await old;
    expect(mocks.start).not.toHaveBeenCalled();
    await bootSessionRuntime();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
