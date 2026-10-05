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
