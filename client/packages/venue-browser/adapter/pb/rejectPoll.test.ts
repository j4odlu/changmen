import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pbRejectStorageKey, startPbRejectPoll } from "./rejectPoll";

const pbGet = vi.fn();
vi.mock("./transport", () => ({
  pbGet: (...args: unknown[]) => pbGet(...args),
}));

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@changmen/client-core/bridge/clientApi", () => ({
  saveUserLog: vi.fn().mockResolvedValue(undefined),
}));

const sessionMock = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => sessionMock.get(k) ?? null,
  setItem: (k: string, v: string) => {
    sessionMock.set(k, v);
  },
  removeItem: (k: string) => {
    sessionMock.delete(k);
  },
  clear: () => sessionMock.clear(),
});

describe("startPbRejectPoll", () => {
  const account = new PlatformAccount({
    accountId: 8,
    playerName: "pb2",
    provider: "PB",
    gateway: "https://pb.example",
    token: "{}",
  });

  beforeEach(() => {
    pbGet.mockReset();
    sessionMock.clear();
  });

  afterEach(() => {
    sessionMock.clear();
  });

  it("REJECTED 写入 sessionStorage 且 status=reject（对齐 A8 _Q）", async () => {
    pbGet.mockResolvedValue([
      ["oid", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "REJECTED", 123, 0, 0, "item", 0, 0, 1.9, 0, 0, "LOL - x", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0],
    ]);

    await startPbRejectPoll(account, Date.now());

    const cached = JSON.parse(sessionMock.get(pbRejectStorageKey(account))!);
    expect(cached.status).toBe("reject");
    expect(cached.orderId).toBe("oid");
  });
});
