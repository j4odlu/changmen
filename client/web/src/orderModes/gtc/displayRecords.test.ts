import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, nextTick, ref } from "vue";
import { useGtcDisplayRecords } from "./displayRecords";
import { gtcProgress } from "./gtcProgressState";

const mocks = vi.hoisted(() => ({ list: vi.fn(), command: vi.fn(), create: vi.fn(), start: vi.fn(), cancel: vi.fn(),
  version: "session-1", user: { isLoggedIn: true, userId: "owner", extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Participant: false } } }));
vi.mock("./api", () => ({ listGtc: mocks.list, commandGtc: mocks.command, createGtc: mocks.create }));
vi.mock("./runtime", () => ({ startGtcRuntime: mocks.start, cancelGtc: mocks.cancel }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.version, isAuthSessionCurrent: (version: string) => version === mocks.version }));
vi.mock("@/stores/userStore", async () => {
  const { reactive } = await import("vue");
  return { useUserStore: () => reactive(mocks.user) };
});
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert: () => {}, remove: () => {}, setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, patchProp: () => {} });
let app: ReturnType<typeof renderer.createApp> | undefined;
let display: ReturnType<typeof useGtcDisplayRecords>;
function mount(enabled: () => boolean = () => true) {
  app = renderer.createApp({ setup() { display = useGtcDisplayRecords(enabled); return () => null; } });
  app.mount({});
}
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick(); };
async function user() { return (await import("@/stores/userStore")).useUserStore() as unknown as typeof mocks.user; }
function record(owner = "owner", revision = 1) {
  return { ...createGtcExecution("zero", owner, "wallet", "maker", { shares: "10" } as GtcPlan, 1),
    submit: "accepted" as const, revision, matched: "0" };
}
function deferred() { let resolve!: (rows: GtcExecution[]) => void; let reject!: (error: Error) => void;
  const promise = new Promise<GtcExecution[]>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.version = "session-1";
  Object.assign(await user(), { isLoggedIn: true, userId: "owner" });
  gtcProgress.owner = ""; gtcProgress.records = []; gtcProgress.ready = false; gtcProgress.error = "";
  mocks.list.mockResolvedValue([record()]);
});
afterEach(() => {
  app?.unmount(); app = undefined; vi.useRealTimers();
  expect(mocks.command).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
});

describe("[changmen 扩展] isolated read-only zero-fill list", () => {
  it("does not read or display the current user's GTC rows in an embedded workspace", async () => {
    const visible = ref(false); mount(() => visible.value); await flush();
    expect(mocks.list).not.toHaveBeenCalled(); expect(display.records.value).toEqual([]);
    visible.value = true; await flush(); expect(display.records.value).toHaveLength(1);
    visible.value = false; await flush(); expect(display.records.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(30000); expect(mocks.list).toHaveBeenCalledOnce();
  });
  it("loads owned zero-fill records without participant hints, financial rows or a GTC executor", async () => {
    mount(); await flush();
    expect(mocks.list).toHaveBeenCalledOnce(); expect(mocks.list.mock.calls[0]).toEqual([]);
    expect(display.records.value).toEqual([record()]);
    expect(gtcProgress.records).toEqual([]); expect(gtcProgress.owner).toBe("");
    expect((await user()).extensionPrefs.pmArbOrderMode).toBe("FOK");
    expect((await user()).extensionPrefs.pmGtcV1Participant).toBe(false);
  });
  it("does not add foreign, positive-fill, rejected or unsubmitted records through display loading", async () => {
    mocks.list.mockResolvedValue([record(), record("foreign"), { ...record(), id: "positive", matched: "1" },
      { ...record(), id: "rejected", submit: "rejected" }, { ...record(), id: "prepared", submit: "prepared" }]);
    mount(); await flush(); expect(display.records.value).toEqual([record()]);
  });
  it("uses newer runtime facts without writing to them and deduplicates the exact execution", async () => {
    gtcProgress.owner = "owner"; gtcProgress.records = [{ ...record("owner", 2), matched: "1" }];
    const before = JSON.stringify(gtcProgress); mount(); await flush();
    expect(display.records.value).toEqual(gtcProgress.records); expect(JSON.stringify(gtcProgress)).toBe(before);
    gtcProgress.records = [record("owner", 0)]; await flush(); expect(display.records.value[0]!.revision).toBe(1);
  });
  it("keeps existing nonzero runtime cards and prevents another owner from entering the list", async () => {
    gtcProgress.owner = "owner"; gtcProgress.records = [{ ...record(), id: "filled", matched: "10" }, record("foreign")];
    mount(); await flush(); expect(display.records.value.map(row => row.id)).toEqual(["zero", "filled"]);
  });
  it("deduplicates in-flight polls and stops timers on unmount", async () => {
    const pending = deferred(); mocks.list.mockReturnValue(pending.promise); mount(); await flush();
    await vi.advanceTimersByTimeAsync(45000); expect(mocks.list).toHaveBeenCalledOnce();
    pending.resolve([record()]); await flush(); app!.unmount(); app = undefined;
    await vi.advanceTimersByTimeAsync(30000); expect(mocks.list).toHaveBeenCalledOnce(); expect(display.records.value).toEqual([]);
  });
  it("retains known rows through a network failure and clears the notice after successful polling", async () => {
    mount(); await flush(); mocks.list.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(15000); expect(display.records.value).toEqual([record()]);
    expect(display.error.value).toContain("读取失败");
    mocks.list.mockResolvedValue([]); await vi.advanceTimersByTimeAsync(15000);
    expect(display.records.value).toEqual([]); expect(display.error.value).toBe("");
  });
  it("does not fetch while logged out and clears the previous owner's rows on logout", async () => {
    (await user()).isLoggedIn = false; mount(); await flush(); expect(mocks.list).not.toHaveBeenCalled();
    (await user()).isLoggedIn = true; await flush(); expect(display.records.value).toHaveLength(1);
    (await user()).isLoggedIn = false; await flush(); expect(display.records.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(30000); expect(mocks.list).toHaveBeenCalledOnce();
  });
  it("rejects a late prior-owner response without blocking the new owner's query", async () => {
    const old = deferred(); mocks.list.mockReturnValueOnce(old.promise); mount(); await flush();
    mocks.list.mockResolvedValue([record("next")]); (await user()).userId = "next"; await flush();
    expect(display.records.value).toEqual([record("next")]); old.resolve([record()]); await flush();
    expect(display.records.value).toEqual([record("next")]);
  });
  it("rejects late responses from a replaced session of the same owner", async () => {
    const old = deferred(); mocks.list.mockReturnValueOnce(old.promise); mount(); await flush();
    mocks.version = "session-2"; old.resolve([record()]); await flush(); expect(display.records.value).toEqual([]);
    mocks.list.mockResolvedValue([record()]); await vi.advanceTimersByTimeAsync(15000); expect(display.records.value).toHaveLength(1);
  });
  it("does not publish a response or error after component destruction", async () => {
    const old = deferred(); mocks.list.mockReturnValueOnce(old.promise); mount(); await flush();
    app!.unmount(); app = undefined; old.reject(new Error("late failure")); await flush();
    expect(display.records.value).toEqual([]); expect(display.error.value).toBe("");
  });
});
