import type { Pinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ user: { ready: false, sessionRestoreRetryable: true, sessionRestoreError: "offline", restoreSession: vi.fn() }, state: { value: "unavailable" }, version: "one" }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mock.user }));
vi.mock("@/api/client", () => ({ browserAuthState: mock.state, getAuthSessionVersion: () => mock.version, isAuthSessionCurrent: (version: string) => version === mock.version }));
import { installSessionRecovery } from "./sessionRecovery";
let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers(); mock.version = "one"; mock.state.value = "unavailable"; mock.user.ready = false;
  mock.user.sessionRestoreError = "offline"; mock.user.restoreSession.mockReset();
  mock.user.sessionRestoreRetryable = true;
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("identity restoration retry", () => {
  it("retries an outage, then stops once the profile is ready", async () => {
    mock.user.restoreSession.mockResolvedValueOnce(false).mockImplementationOnce(async () => { mock.user.ready = true; return true; });
    stop = installSessionRecovery({} as Pinia);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mock.user.restoreSession).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.user.restoreSession).toHaveBeenCalledTimes(2);
  });
  it("does not retry an explicitly anonymous user", async () => {
    mock.user.sessionRestoreError = ""; mock.state.value = "anonymous";
    stop = installSessionRecovery({} as Pinia);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.user.restoreSession).toHaveBeenCalledTimes(1);
  });
  it("does not automatically retry a deterministic configuration rejection", async () => {
    mock.user.restoreSession.mockImplementation(async () => {
      mock.user.sessionRestoreRetryable = false;
      return false;
    });
    stop = installSessionRecovery({} as Pinia);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mock.user.restoreSession).toHaveBeenCalledTimes(1);
  });
});
