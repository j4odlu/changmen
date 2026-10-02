import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadObservationBatch } from "./orderObservationTransport";

const mocks = vi.hoisted(() => ({ network: vi.fn(), session: true, transition: false, headers: vi.fn(() => ({ token: "test-token" })) }));
vi.mock("@changmen/client-core/shared/a8Axios", () => ({ a8Axios: { post: mocks.network } }));
vi.mock("@/config/apiBase", () => ({ getApiBase: () => "http://localhost:3700" }));
vi.mock("@/api/client", () => ({ authHeaders: mocks.headers, getAuthSessionVersion: () => "s1", isAuthSessionCurrent: () => mocks.session, isAuthTransitionPending: () => mocks.transition }));
describe("旁路传输不操作登录状态", () => {
  beforeEach(() => { mocks.network.mockReset(); mocks.session = true; mocks.transition = false; });
  it("authentication rejection fails only this upload and does not replay requests", async () => {
    mocks.network.mockResolvedValue({ data: { success: 0, code: "ACCESS_TOKEN_EXPIRED" } });
    await expect(uploadObservationBatch("u1", [], () => "u1")).rejects.toThrow("旁路事件上传未确认");
    expect(mocks.network).toHaveBeenCalledTimes(1);
    expect(mocks.network.mock.calls[0]![2].timeout).toBe(10000);
  });
  it("does not send another user's events or send during login transitions", async () => {
    expect(await uploadObservationBatch("u1", [], () => "u2")).toEqual([]);
    mocks.transition = true;
    expect(await uploadObservationBatch("u1", [], () => "u1")).toEqual([]);
    expect(mocks.network).not.toHaveBeenCalled();
  });
  it("ignores an acknowledgement after the session changes", async () => {
    mocks.network.mockImplementation(async () => { mocks.session = false; return { data: { success: 1, info: { accepted: ["event-001"] } } }; });
    expect(await uploadObservationBatch("u1", [], () => "u1")).toEqual([]);
  });
});
