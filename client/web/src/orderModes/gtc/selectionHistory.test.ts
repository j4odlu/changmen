import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gtcSelectionHistoryStatus } from "./selectionHistory";

const state = vi.hoisted(() => ({ refresh: vi.fn(), start: vi.fn(), generation: 0, changes: { revision: 0 } }));
vi.mock("./executionState", () => ({ refreshGtcRecords: state.refresh,
  captureGtcSession: () => { const stamp = state.generation; return () => stamp === state.generation; },
}));
vi.mock("./localStore", () => ({ localGtcChanges: state.changes }));
vi.mock("./runtime", () => ({ startGtcRuntime: state.start }));
const account = (id: number, maxBetCount = 1) => ({ accountId: id, maxBetCount }) as PlatformAccount;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); state.generation++; state.changes.revision = 0; state.refresh.mockResolvedValue(undefined); });

describe("GTC selection history readiness", () => {
  it("does no recovery when all history limits are disabled", () => {
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1, 0)], false)).toBeUndefined();
    expect(state.refresh).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled();
  });
  it("shares a pending read, then reuses restored history without IO", async () => {
    let release!: () => void;
    state.refresh.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    expect(gtcSelectionHistoryStatus("owner", 1, [account(2), account(1), account(3, 0)], false)).toContain("恢复中");
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1), account(2)], false)).toContain("恢复中");
    expect(state.refresh).toHaveBeenCalledExactlyOnceWith(1, [1, 2]);
    release(); await flush();
    expect(gtcSelectionHistoryStatus("owner", 1, [account(2), account(1)], false)).toBeUndefined();
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("invalidates on local or cross-tab persisted changes", async () => {
    gtcSelectionHistoryStatus("owner", 1, [account(1)], false); await flush();
    state.changes.revision++;
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1)], false)).toContain("恢复中");
    await flush();
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1)], false)).toBeUndefined();
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });
  it("cannot reuse readiness across sessions or newly eligible accounts", async () => {
    gtcSelectionHistoryStatus("owner", 1, [account(1)], false); await flush();
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1), account(2)], false)).toContain("恢复中");
    await flush(); state.generation++;
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1)], false)).toContain("恢复中");
    await flush(); expect(state.refresh).toHaveBeenCalledTimes(3);
  });
  it("does not mark failed restoration ready or retry on every scan", async () => {
    state.refresh.mockRejectedValue(new Error("history unavailable"));
    gtcSelectionHistoryStatus("owner", 1, [account(1)], false); await flush();
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1)], false)).toBe("history unavailable");
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("does not certify a snapshot when storage changed during the read", async () => {
    let release!: () => void;
    state.refresh.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    gtcSelectionHistoryStatus("owner", 1, [account(1)], false);
    state.changes.revision++; release(); await flush();
    expect(gtcSelectionHistoryStatus("owner", 1, [account(1)], false)).toContain("恢复中");
    await flush(); expect(state.refresh).toHaveBeenCalledTimes(2);
  });
});
