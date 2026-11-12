import type { ArbBetAttemptParams, ArbBetPlaced } from "./types";
import type { ArbLegSettleSnapshot } from "./settleBothArbLegs";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageStore } from "@/stores/messageStore";
import { createArbExecutionTrace } from "@/stores/betting/autoBet/arbExecutionTrace";
import { finishArbExecutionTrace, sendArbBettingMessageIfNeeded } from "./finalizeArbMessaging";

const user = vi.hoisted(() => ({
  message: { telegramId: "test-chat", notifyArbProgress: true },
}));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => user }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({}) }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => ({}) }));

describe("套利结果通知与辅助进度报告", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
  });

  it.each(["A", "B"] as const)("OB 单边位于 %s 时，通知明确对冲腿跳过且不发布双腿锁利推单", side => {
    const messages = useMessageStore();
    const match = { id: 1, title: "A vs B" };
    const bet = { id: 2, getBetName: () => "地图1" };
    const ob = { type: "OB", target: "Home", odds: 3, betMoney: 100, match, bet };
    const peer = { type: "Polymarket", target: "Away", odds: 1.8, betMoney: 60, match, bet };
    const account = { provider: "OB", playerName: "ob1" };
    const result = { success: true, message: "已受理" };
    const placed = { executionMode: "obSingle", executionSide: side, betBothLegs: false, linkId: 1700000000000,
      legA: side === "A" ? ob : peer, legB: side === "B" ? ob : peer,
      accountA: side === "A" ? account : undefined, accountB: side === "B" ? account : undefined,
      resultA: side === "A" ? result : undefined, resultB: side === "B" ? result : undefined,
    } as unknown as ArbBetPlaced;
    sendArbBettingMessageIfNeeded({ match, bet } as ArbBetAttemptParams, placed,
      { rejectA: false, rejectB: false } as ArbLegSettleSnapshot);
    expect(messages.telegramQueue).toHaveLength(1);
    expect(messages.telegramQueue[0]).toContain("Polymarket（OB 对冲腿）");
    expect(messages.telegramQueue[0]).toContain("本侧按模式跳过下注；不补单");
    expect(messages.telegramQueue[0]).not.toContain("9999");
    expect(messages.telegramQueue[0]).not.toContain("高赔腿");
    expect(messages.pushQueue).toHaveLength(0);
  });

  it.each([true, false])("进度报告开关=%s 时，连续拒单的原通知都入队", (enabled) => {
    user.message.notifyArbProgress = enabled;
    const messages = useMessageStore();
    const match = { id: 1, title: "A vs B" };
    const bet = { id: 2, getBetName: () => "地图1" };
    const placed = {
      legA: { type: "OB", target: "Home", odds: 2, betMoney: 100, match, bet },
      legB: { type: "RAY", target: "Away", odds: 2, betMoney: 100, match, bet },
      accountA: { provider: "OB", playerName: "ob1" },
      accountB: { provider: "RAY", playerName: "ray1" },
      resultA: { success: true, message: "已受理" },
      resultB: { success: true, message: "已受理" },
      betBothLegs: true,
      linkId: 1700000000000,
    } as unknown as ArbBetPlaced;
    const settle = { rejectA: false, rejectB: true } as ArbLegSettleSnapshot;

    for (let attempt = 0; attempt < 2; attempt++) {
      placed.linkId += 1;
      const params = { match, bet } as ArbBetAttemptParams;
      params.trace = createArbExecutionTrace(params.match, params.bet, undefined,
        payload => messages.arbProgressMessage(payload));
      finishArbExecutionTrace(params, placed, settle, {
        okA: true, okB: false, makeupQueued: false,
      });
      sendArbBettingMessageIfNeeded(params, placed, settle);
    }

    const originals = messages.telegramQueue.filter(body => body.includes("下单提醒"));
    expect(originals).toHaveLength(2);
    expect(originals[0]).toContain("是否拒单：🔴是");
    expect(originals[1]).toContain("是否拒单：🔴是");
    expect(originals[0]).toContain("1700000000001");
    expect(originals[1]).toContain("1700000000002");
    // 真实去重会吞掉第二份相同摘要的辅助报告，但不能吞掉原通知。
    expect(messages.telegramQueue.filter(body => body.includes("套利执行部分成功")))
      .toHaveLength(enabled ? 1 : 0);
  });
});
