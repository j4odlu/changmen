import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owned: vi.fn(), logs: vi.fn() }));
vi.mock("@changmen/db", () => ({ fetchPmSubmissionLogs: mocks.logs }));
vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: mocks.owned }));
import { handlePmGetSubmission } from "./submission_handler.js";
const orderId = `0x${"9".repeat(64)}`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue({ ok: true, player: { id: 317, provider: "Polymarket", playerName: "a" } });
  mocks.logs.mockResolvedValue([]);
});
it("rejects unauthenticated, invalid and foreign-account requests before reading logs", async () => {
  expect((await handlePmGetSubmission({ orderId, playerId: 317 }, "")).ok).toBe(false);
  expect((await handlePmGetSubmission({ orderId: "%", playerId: 317 }, "user")).ok).toBe(false);
  mocks.owned.mockResolvedValue({ ok: false, msg: "foreign" });
  expect((await handlePmGetSubmission({ orderId, playerId: 317 }, "user")).ok).toBe(false);
  expect(mocks.logs).not.toHaveBeenCalled();
});
it("scopes lookup to the authenticated user and returns no guessed amount", async () => {
  expect(await handlePmGetSubmission({ orderId, playerId: 317 }, "user")).toEqual({ ok: true, info: null });
  expect(mocks.logs).toHaveBeenCalledWith("user", orderId);
});
