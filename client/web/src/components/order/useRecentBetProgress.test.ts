import type { ActiveBetRun } from "@/types/activeBetRun";
import { computed, effectScope, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { ACTIVE_BET_TERMINAL_LINGER_MS, useActiveBetRunStore } from "@/stores/activeBetRunStore";
import { useRecentBetProgress } from "./useRecentBetProgress";

vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => undefined }) }));

function run(betId: number, terminalAt?: number): ActiveBetRun {
  return {
    betId, matchId: 1, linkId: betId + 100, matchTitle: "A vs B", betName: "地图1",
    phase: terminalAt ? "syncing" : "placing", overallLabel: terminalAt ? "双腿已成交" : "下单中",
    startedAt: betId, updatedAt: betId, terminalAt,
    events: [{ at: betId, stage: "下单", detail: "提交" }],
    legs: [{ side: "A", platform: "OB", target: "Home", status: "placing", events: [] }],
  };
}

function setup(initial: ActiveBetRun[] = []) {
  const source = ref(initial);
  const owner = ref("user1");
  const scope = effectScope();
  const progress = scope.run(() => useRecentBetProgress(source, owner))!;
  return { source, owner, scope, ...progress };
}

describe("只读最近下单进度", () => {
  it("真实进度 store 仍按原定时器清理，展示快照独立保留", () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useActiveBetRunStore();
    const scope = effectScope();
    try {
      const progress = scope.run(() => useRecentBetProgress(computed(() => store.visibleRuns), ref("user1")))!;
      store.upsertRun(1, run(1));
      store.patchLeg(1, "A", { status: "confirmed" });
      store.scheduleTerminalRemoval(1, undefined, "双腿已成交");
      vi.advanceTimersByTime(ACTIVE_BET_TERMINAL_LINGER_MS);
      expect(store.runs.size).toBe(0);
      expect(progress.displayRuns.value).toHaveLength(1);
      expect(progress.activeRun.value?.overallLabel).toBe("双腿已成交");
      expect(progress.activeRun.value?.legs[0]?.status).toBe("confirmed");
      expect(progress.isTracking(progress.activeRun.value!)).toBe(false);
    }
    finally {
      scope.stop();
      vi.useRealTimers();
    }
  });

  it("终态清理后保留最后进度，新单进入只保留最近三单", () => {
    const p = setup();
    for (let id = 1; id <= 4; id++) {
      p.source.value = [run(id)];
      p.source.value[0]!.terminalAt = 100;
      p.source.value[0]!.overallLabel = "双腿已成交";
      p.source.value = [];
    }
    expect(p.displayRuns.value.map(r => r.betId)).toEqual([4, 3, 2]);
    expect(p.activeRun.value?.overallLabel).toBe("双腿已成交");
    expect(p.activeRun.value?.terminalAt).toBe(100);
    p.scope.stop();
  });

  it("旧单选择按执行身份保持，新单提示且可返回最新", () => {
    const p = setup([run(2), run(1)]);
    p.selectRun(p.displayRuns.value[1]!);
    p.source.value = [run(3), run(2), run(1)];
    expect(p.activeRun.value?.betId).toBe(1);
    expect(p.unseenLatest.value).toBe(true);
    p.source.value[2]!.overallLabel = "等待确认";
    expect(p.activeRun.value?.overallLabel).toBe("等待确认");
    p.showLatest();
    expect(p.activeRun.value?.betId).toBe(3);
    expect(p.unseenLatest.value).toBe(false);
    p.scope.stop();
  });

  it("嵌套快照与业务对象隔离，查看和移除快照不修改业务数据", () => {
    const p = setup([run(1)]);
    p.displayRuns.value[0]!.events[0]!.detail = "展示修改";
    p.displayRuns.value[0]!.legs[0]!.status = "failed";
    p.selectRun(p.displayRuns.value[0]!);
    expect(p.source.value[0]!.events[0]!.detail).toBe("提交");
    expect(p.source.value[0]!.legs[0]!.status).toBe("placing");
    p.source.value = [];
    expect(p.isTracking(p.displayRuns.value[0]!)).toBe(false);
    expect(p.displayRuns.value[0]!.terminalAt).toBeUndefined();
    p.scope.stop();
  });

  it("来源仍在跟踪的进行中任务不会被历史三单上限挤掉", () => {
    const p = setup([run(1), run(2), run(3), run(4)]);
    expect(p.displayRuns.value).toHaveLength(4);
    p.source.value[0]!.terminalAt = 100;
    expect(p.displayRuns.value.map(r => r.betId)).toEqual([4, 3, 2]);
    expect(p.source.value).toHaveLength(4);
    p.scope.stop();
  });

  it("同一盘口的新 Link 是独立执行，旧记录仍保留", () => {
    const p = setup([run(1, 100)]);
    p.selectRun(p.displayRuns.value[0]!);
    p.source.value = [{ ...run(1), linkId: 999, startedAt: 200 }];
    expect(p.displayRuns.value).toHaveLength(2);
    expect(p.activeRun.value?.linkId).toBe(101);
    expect(p.unseenLatest.value).toBe(true);
    p.scope.stop();
  });

  it("退出或切换用户清空展示记录，不清理业务 store", () => {
    const p = setup([run(1)]);
    p.owner.value = "";
    expect(p.displayRuns.value).toEqual([]);
    expect(p.source.value).toHaveLength(1);
    p.source.value = [run(2)];
    expect(p.displayRuns.value).toEqual([]);
    p.owner.value = "user2";
    p.source.value = [run(3)];
    expect(p.displayRuns.value.map(r => r.betId)).toEqual([3]);
    p.scope.stop();
  });
});
