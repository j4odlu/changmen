import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoseOrder } from "@/models/loseOrder";
import {
  ACTIVE_BET_RUN_QUEUE_CAP,
  ACTIVE_BET_TERMINAL_LINGER_MS,
  legPlacementStatusLabel,
  useActiveBetRunStore,
} from "@/stores/activeBetRunStore";
import {
  syncActiveBetBegin,
  syncActiveBetAfterRejectSync,
  syncActiveBetBindSuccess,
  syncActiveBetLegSettleResult,
  syncActiveBetPlaceResults,
  syncActiveBetPhase,
  syncActiveBetPrecheckResults,
} from "@/stores/betting/activeBetRunSync";

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: () => ({
    findAccount: (id?: number) =>
      id === 42 ? { provider: "OB", playerName: "ob1" } : undefined,
  }),
}));

describe("activeBetRunStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useActiveBetRunStore();
    store.$reset();
    store.runs.clear();
  });

  it("tracks arb begin through dual-leg success and removes terminal run after a short linger", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    expect(store.visibleRuns).toHaveLength(1);
    expect(store.visibleRuns[0]?.phase).toBe("preparing");

    syncActiveBetAfterRejectSync(100, {
      hasA: true,
      hasB: true,
      rejectA: false,
      rejectB: false,
      okA: true,
      okB: true,
      makeupQueued: false,
    });

    expect(store.visibleRuns[0]?.phase).toBe("syncing");
    expect(store.visibleRuns[0]?.overallLabel).toBe("双腿已成交");
    expect(store.visibleRuns[0]?.terminalAt).toBeTypeOf("number");
    vi.advanceTimersByTime(ACTIVE_BET_TERMINAL_LINGER_MS - 1);
    expect(store.visibleRuns).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.visibleRuns).toHaveLength(0);
  });

  it(`FIFO queue keeps at most ${ACTIVE_BET_RUN_QUEUE_CAP} columns and drops oldest`, () => {
    const store = useActiveBetRunStore();
    const n = ACTIVE_BET_RUN_QUEUE_CAP + 1;
    for (let i = 1; i <= n; i += 1) {
      syncActiveBetBegin({
        match: { id: i, title: `M${i}` } as never,
        bet: { id: 1000 + i, getBetName: () => `盘${i}` } as never,
        legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
        legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
        accountA: { playerName: "ob1" } as never,
        accountB: { playerName: "ray1" } as never,
        linkId: 1_000 + i,
        betBothLegs: true,
      });
    }
    expect(store.visibleRuns).toHaveLength(ACTIVE_BET_RUN_QUEUE_CAP);
    const expectedIds = Array.from({ length: ACTIVE_BET_RUN_QUEUE_CAP }, (_, i) => 1000 + n - i);
    expect(store.visibleRuns.map(r => r.betId)).toEqual(expectedIds);
    expect(store.visibleRuns[0]?.matchTitle).toBe(`M${n}`);
    expect(store.visibleRuns[ACTIVE_BET_RUN_QUEUE_CAP - 1]?.matchTitle).toBe("M2");
  });

  it("a new run with the same betId cancels the previous terminal removal", () => {
    const store = useActiveBetRunStore();
    const begin = () => syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    begin();
    store.scheduleTerminalRemoval(100, 1_000, "未成单");
    vi.advanceTimersByTime(500);
    begin();
    vi.advanceTimersByTime(1_000);

    expect(store.visibleRuns).toHaveLength(1);
    expect(store.visibleRuns[0]?.phase).toBe("preparing");
    expect(store.visibleRuns[0]?.terminalAt).toBeUndefined();
  });

  it("bootstrapFromLoseOrders marks success leg confirmed opposite makeup target", () => {
    const store = useActiveBetRunStore();
    const orders = new Map([
      [
        100,
        new LoseOrder({
          accountId: 42,
          matchId: 1,
          betId: 100,
          target: "Away",
          betMoney: 90,
          betOdds: 2.956,
          match: "G2 vs T1",
          bet: "地图4",
          linkId: 176,
        }),
      ],
    ]);
    store.bootstrapFromLoseOrders(orders);
    const run = store.visibleRuns[0];
    expect(run?.legs.find(l => l.target === "Home")?.status).toBe("confirmed");
    expect(run?.legs.find(l => l.target === "Away")?.status).toBe("makeup");
    expect(run?.legs.find(l => l.target === "Home")?.platform).toBe("OB");
  });

  it("pending POST shows pending_confirm leg and phase label", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetPlaceResults(
      100,
      { success: true },
      { success: true, pending: true, message: "0xabc / delayed / 待确认" },
      true,
      true,
    );

    const run = store.visibleRuns[0];
    expect(run?.phase).toBe("settling");
    expect(run?.overallLabel).toBe("待场馆确认");
    expect(run?.legs.find(l => l.side === "B")?.status).toBe("pending_confirm");
    expect(legPlacementStatusLabel(run!.legs.find(l => l.side === "B")!)).toBe("delayed 待确认");
    expect(run?.legs.find(l => l.side === "B")?.detail).toContain("delayed");
  });

  it("A8 submitted legs show 等待场馆确认 during settling", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetPlaceResults(100, { success: true }, { success: true }, true, true);

    const run = store.visibleRuns[0]!;
    expect(run.phase).toBe("settling");
    expect(run.overallLabel).toBe("等待场馆确认");
    const legA = run.legs.find(l => l.side === "A")!;
    expect(legA.status).toBe("submitted");
    expect(legPlacementStatusLabel(legA, run)).toBe("等待场馆确认");
    expect(legPlacementStatusLabel(legA)).toBe("已提交");
  });

  it("legPlacementStatusLabel maps skipped and 9999 precheck", () => {
    expect(legPlacementStatusLabel({
      side: "B",
      platform: "—",
      target: "Home",
      status: "skipped",
      events: [],
    })).toBe("不参与");

    expect(legPlacementStatusLabel({
      side: "A",
      platform: "OB",
      target: "Home",
      status: "pending",
      detail: "acc1 · 9999仅预检",
      events: [],
    })).toBe("仅预检");
  });

  it("patchLeg appends layered event when leg status changes", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    store.setPhase(100, "placing", "提交场馆订单");
    store.patchLeg(100, "A", { status: "placing", detail: "下单中" });
    const legA = store.visibleRuns[0]?.legs.find(l => l.side === "A");
    expect(legA?.events.some(e => e.stage === "下单" && e.detail === "下单中")).toBe(true);
  });

  it("phase updates append to run timeline only, not both legs", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetPhase(100, "checking", "正在预检");

    const run = store.visibleRuns[0]!;
    expect(run.overallLabel).toBe("正在预检");
    expect(run.phase).toBe("checking");
    expect(run.legs.every(l => l.events.some(e => e.stage === "预检" && e.detail === "正在预检"))).toBe(true);
  });

  it("appendEvent skips consecutive duplicate stage+detail", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    store.appendEvent(100, "预检", "正在预检");
    store.appendEvent(100, "预检", "正在预检");
    expect(store.visibleRuns[0]!.events.filter(e => e.detail === "正在预检")).toHaveLength(1);
  });

  it("precheck results append 正在预检 / 预检通过 / 预检失败", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    const beginA = store.visibleRuns[0]!.legs.find(l => l.side === "A")!;
    expect(beginA.events.some(e => e.stage === "预检" && e.detail === "正在预检")).toBe(true);

    store.setPhase(100, "checking", "正在预检");
    syncActiveBetPrecheckResults(100, {
      hasA: true,
      okA: true,
      hasB: true,
      okB: false,
      detailB: "盘口价高于检测价",
    });

    const run = store.visibleRuns[0]!;
    const legA = run.legs.find(l => l.side === "A")!;
    const legB = run.legs.find(l => l.side === "B")!;
    expect(legA.events.some(e => e.stage === "预检" && e.detail === "预检通过")).toBe(true);
    expect(legB.status).toBe("failed");
    expect(legB.events.some(e => e.stage === "预检" && e.detail.includes("预检失败"))).toBe(true);
    expect(run.overallLabel).toBe("预检失败");
    expect(run.phase).toBe("syncing");
  });

  it("precheck both fail updates overall away from 正在预检", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    store.setPhase(100, "checking", "正在预检");
    syncActiveBetPrecheckResults(100, {
      hasA: true,
      okA: false,
      detailA: "盘口已暂停",
      hasB: true,
      okB: false,
      detailB: "Polymarket 盘口价高于检测价",
    });

    const run = store.visibleRuns[0]!;
    expect(run.overallLabel).toBe("预检失败");
    expect(run.legs.every(l => l.status === "failed")).toBe(true);
  });

  it("place results append 预检/下单/拒单 layered timeline", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    store.setPhase(100, "checking", "正在预检");
    syncActiveBetPrecheckResults(100, { hasA: true, okA: true, hasB: true, okB: true });
    store.setPhase(100, "placing", "提交场馆订单");
    syncActiveBetPlaceResults(
      100,
      { success: true, message: "买入成功" },
      { success: false, message: "Predict.fun 盘口价高于检测价，整单取消" },
      true,
      true,
      "filled_pending_settle",
      "api_failed",
    );

    const run = store.visibleRuns[0]!;
    const legA = run.legs.find(l => l.side === "A")!;
    const legB = run.legs.find(l => l.side === "B")!;
    expect(legA.events.some(e => e.stage === "预检" && e.detail === "预检通过")).toBe(true);
    expect(legA.events.some(e => e.stage === "下单" && e.detail === "买入成功")).toBe(true);
    expect(legA.events.some(e => e.stage === "拒单" && e.detail === "等待场馆确认")).toBe(true);
    expect(legB.events.some(e => e.stage === "下单" && e.detail === "Predict.fun 盘口价高于检测价，整单取消")).toBe(true);
    expect(legB.events.some(e => e.stage === "拒单")).toBe(false);
    expect(run.overallLabel).toBe("等待场馆确认");
  });

  it("place failure without message falls back to 下单失败", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });
    store.setPhase(100, "placing", "提交场馆订单");
    syncActiveBetPlaceResults(
      100,
      { success: false },
      { success: false },
      true,
      true,
      "api_failed",
      "api_failed",
    );
    const run = store.visibleRuns[0]!;
    expect(run.legs.every(l => l.detail === "下单失败")).toBe(true);
    expect(run.legs.every(l => l.events.some(e => e.stage === "下单" && e.detail === "下单失败"))).toBe(true);
  });

  it("api_failed / not_attempted finalize details are not 未拒单", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetAfterRejectSync(100, {
      hasA: true,
      hasB: true,
      rejectA: false,
      rejectB: false,
      okA: false,
      okB: false,
      makeupQueued: false,
      placeOutcomeA: "api_failed",
      placeOutcomeB: "not_attempted",
    });

    const run = store.visibleRuns[0]!;
    const legA = run.legs.find(l => l.side === "A")!;
    const legB = run.legs.find(l => l.side === "B")!;
    expect(legA.detail).toBe("下单失败");
    expect(legB.detail).toBe("未下单");
    expect(legA.detail).not.toBe("未拒单");
    expect(legB.detail).not.toBe("未拒单");
  });

  it("keeps run when both legs fail without makeup", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "RAY", target: "Away", odds: 1.76, betMoney: 170 } as never,
      legB: { type: "Polymarket", target: "Home", odds: 2.631, betMoney: 100 } as never,
      accountA: { playerName: "ray1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetAfterRejectSync(100, {
      hasA: true,
      hasB: true,
      rejectA: true,
      rejectB: true,
      okA: false,
      okB: false,
      makeupQueued: false,
    });

    expect(store.visibleRuns).toHaveLength(1);
    expect(store.visibleRuns[0]?.overallLabel).toBe("未成单");
    expect(store.visibleRuns[0]?.legs.every(l =>
      l.events.some(e => e.stage === "拒单" && e.detail === "拒单"),
    )).toBe(true);
  });

  it("双侧 not_attempted 收尾保留第二道闸原因", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "Polymarket", target: "Home", odds: 2.4, betMoney: 150 } as never,
      legB: { type: "OB", target: "Away", odds: 1.85, betMoney: 200 } as never,
      accountA: { playerName: "pm1" } as never,
      accountB: { playerName: "ob1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    const reason = "Polymarket Home: 检测价已不能成交（fo 卖一高于上限）";
    syncActiveBetPlaceResults(
      100,
      undefined,
      undefined,
      true,
      true,
      "not_attempted",
      "not_attempted",
      reason,
    );
    expect(store.visibleRuns[0]?.overallLabel).toBe(reason);
    expect(store.visibleRuns[0]?.legs.every(l => l.detail === `未下单 · ${reason}`)).toBe(true);

    syncActiveBetAfterRejectSync(100, {
      hasA: true,
      hasB: true,
      rejectA: false,
      rejectB: false,
      okA: false,
      okB: false,
      makeupQueued: false,
      placeOutcomeA: "not_attempted",
      placeOutcomeB: "not_attempted",
    });

    expect(store.visibleRuns[0]?.overallLabel).toBe(reason);
    expect(store.visibleRuns[0]?.legs.every(l => l.detail === `未下单 · ${reason}`)).toBe(true);
  });

  it("bind success appends 已绑单 on reject layer", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "RAY", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "ray1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });
    syncActiveBetBindSuccess(100, ["A", "B"], "已绑单");
    const run = store.visibleRuns[0]!;
    expect(run.legs.every(l =>
      l.events.some(e => e.stage === "拒单" && e.detail === "已绑单"),
    )).toBe(true);
  });

  it("reject layer shows 未拒单 then 已成交; one-leg reject stays 补单中", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ob1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    store.setPhase(100, "settling", "等待场馆确认");
    store.patchLeg(100, "A", { status: "confirmed", detail: "未拒单" });
    store.patchLeg(100, "B", { status: "rejected", detail: "拒单" });

    syncActiveBetAfterRejectSync(100, {
      hasA: true,
      hasB: true,
      rejectA: false,
      rejectB: true,
      okA: true,
      okB: false,
      makeupQueued: true,
      makeupTarget: "B",
      makeupPlatform: "Polymarket",
    });

    const run = store.visibleRuns[0]!;
    const legA = run.legs.find(l => l.side === "A")!;
    const legB = run.legs.find(l => l.side === "B")!;
    expect(legA.events.some(e => e.stage === "拒单" && e.detail === "未拒单")).toBe(true);
    expect(legA.events.some(e => e.stage === "拒单" && e.detail === "已成交")).toBe(true);
    expect(legA.events.some(e => e.detail === "已确认")).toBe(false);
    expect(legB.events.some(e => e.stage === "拒单" && e.detail === "拒单")).toBe(true);
    expect(legB.status).toBe("makeup");
    expect(run.phase).toBe("makeup");
    expect(run.overallLabel).toBe("补单中");
  });

  it("marks a queued reject as not executed when automatic makeup is off", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "GamerLegion vs Sinners" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "Polymarket", target: "Away", odds: 1.9231, betMoney: 155 } as never,
      legB: { type: "RAY", target: "Home", odds: 2.48, betMoney: 111 } as never,
      accountA: { playerName: "pm" } as never,
      accountB: { playerName: "ray" } as never,
      linkId: 1_790_538_363_628,
      betBothLegs: true,
    });

    syncActiveBetAfterRejectSync(100, {
      hasA: true,
      hasB: true,
      rejectA: false,
      rejectB: true,
      okA: true,
      okB: false,
      makeupQueued: true,
      makeupEnabled: false,
      makeupTarget: "B",
      makeupPlatform: "RAY",
    });

    const run = store.visibleRuns[0]!;
    const rayLeg = run.legs.find(leg => leg.side === "B")!;
    expect(run.phase).toBe("syncing");
    expect(run.overallLabel).toBe("自动补单已关闭");
    expect(run.terminalAt).toBeTypeOf("number");
    expect(rayLeg.status).toBe("rejected");
    expect(rayLeg.detail).toBe("自动补单已关闭，未执行补单");
  });

  it("PM filled settle shows 已成交, not A8 未拒单", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "RAY", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ray1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });
    store.patchLeg(100, "B", { status: "pending_confirm", detail: "delayed 待确认" });

    syncActiveBetLegSettleResult(100, "B", true, false, { provider: "Polymarket" });

    const legB = store.visibleRuns[0]!.legs.find(l => l.side === "B")!;
    expect(legB.status).toBe("confirmed");
    expect(legB.detail).toBe("已成交");
    expect(legB.events.some(e => e.detail === "未拒单")).toBe(false);
    expect(legB.events.some(e => e.stage === "拒单" && e.detail === "已成交")).toBe(true);
  });

  it("PM timeout settle stays 待确认, not 拒单", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "RAY", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "Polymarket", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ray1" } as never,
      accountB: { playerName: "pm1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });
    store.patchLeg(100, "B", { status: "pending_confirm", detail: "delayed 待确认" });

    syncActiveBetLegSettleResult(100, "B", true, false, {
      pendingConfirm: true,
      provider: "Polymarket",
    });

    const legB = store.visibleRuns[0]!.legs.find(l => l.side === "B")!;
    expect(legB.status).toBe("pending_confirm");
    expect(legB.detail).toBe("delayed 待确认");
    expect(legB.events.some(e => e.detail === "未拒单")).toBe(false);
    expect(legB.events.some(e => e.detail === "拒单")).toBe(false);
  });

  it("A8 settle pass still uses 未拒单", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "RAY", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "OB", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ray1" } as never,
      accountB: { playerName: "ob1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetLegSettleResult(100, "A", true, false, { provider: "RAY" });

    const legA = store.visibleRuns[0]!.legs.find(l => l.side === "A")!;
    expect(legA.status).toBe("confirmed");
    expect(legA.detail).toBe("未拒单");
    expect(legA.events.some(e => e.stage === "拒单" && e.detail === "未拒单")).toBe(true);
  });

  it("PF pendingConfirm settle stays 已挂单待确认", () => {
    const store = useActiveBetRunStore();
    syncActiveBetBegin({
      match: { id: 1, title: "A vs B" } as never,
      bet: { id: 100, getBetName: () => "地图1" } as never,
      legA: { type: "RAY", target: "Home", odds: 2, betMoney: 100 } as never,
      legB: { type: "PredictFun", target: "Away", odds: 2.1, betMoney: 95 } as never,
      accountA: { playerName: "ray1" } as never,
      accountB: { playerName: "pf1" } as never,
      linkId: 1_000,
      betBothLegs: true,
    });

    syncActiveBetLegSettleResult(100, "B", true, false, {
      pendingConfirm: true,
      provider: "PredictFun",
      pendingDetail: "已挂单待确认",
    });

    const legB = store.visibleRuns[0]!.legs.find(l => l.side === "B")!;
    expect(legB.status).toBe("pending_confirm");
    expect(legB.detail).toBe("已挂单待确认");
    expect(legB.events.some(e => e.detail === "拒单")).toBe(false);
  });
});
