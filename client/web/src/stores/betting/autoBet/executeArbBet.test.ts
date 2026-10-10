import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetMapBetMuteForTests,
  setFullMatchMuteGlobal,
  toggleMapMute,
} from "@/extensions/mapBetMute";
import {
  resetPrematchFullOnlyForTests,
  setPrematchFullMode,
} from "@/extensions/prematchFullOnly";
import { executeArbBet } from "@/stores/betting/autoBet/executeArbBet";
import { createDefaultUserConfig } from "@/types/userConfig";
import { syncActiveBetFail } from "@/stores/betting/activeBetRunSync";

const prepareArbAttempt = vi.hoisted(() => vi.fn());
const checkArbLegs = vi.hoisted(() => vi.fn());
const placeArbLegs = vi.hoisted(() => vi.fn());
const finalizeArbBet = vi.hoisted(() => vi.fn());
const recordArbAttemptMetric = vi.hoisted(() => vi.fn());
const releaseSingleLeg9999MapFill = vi.hoisted(() => vi.fn());
const releaseSingleLeg9999MapFillKeys = vi.hoisted(() => vi.fn());
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetFail: vi.fn() }));

vi.mock("@/stores/betting/autoBet/phases/prepareArbAttempt", () => ({
  prepareArbAttempt,
}));
vi.mock("@/stores/betting/autoBet/phases/checkArbLegs", () => ({
  checkArbLegs,
}));
vi.mock("@/stores/betting/autoBet/phases/placeArbLegs", () => ({
  placeArbLegs,
}));
vi.mock("@/stores/betting/autoBet/phases/finalizeArbBet", () => ({
  finalizeArbBet,
}));
vi.mock("@/stores/betting/autoBet/arbAttemptMetrics", () => ({
  recordArbAttemptMetric,
}));
vi.mock("@/extensions/arbBet/singleLeg9999MapCount", () => ({
  releaseSingleLeg9999MapFill,
  releaseSingleLeg9999MapFillKeys,
}));

function mockSessionStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  });
}

describe("executeArbBet orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorage();
    resetMapBetMuteForTests();
    resetPrematchFullOnlyForTests();
  });

  it("[changmen 扩展] 折叠全场时不进 prepare", async () => {
    toggleMapMute(1, 0);
    await executeArbBet({
      match: { id: 1, liveRound: 5 } as never,
      bet: { id: 10, round: 0 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).not.toHaveBeenCalled();
    expect(recordArbAttemptMetric).not.toHaveBeenCalled();
  });

  it("[changmen 扩展] 折叠地图3+ 时不进 prepare", async () => {
    toggleMapMute(1, 5);
    await executeArbBet({
      match: { id: 1, liveRound: 0 } as never,
      bet: { id: 10, round: 5 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).not.toHaveBeenCalled();
    expect(recordArbAttemptMetric).not.toHaveBeenCalled();
  });

  it("[changmen 扩展] 折叠后该局变 live 仍进 prepare", async () => {
    toggleMapMute(1, 5);
    prepareArbAttempt.mockResolvedValue(null);
    await executeArbBet({
      match: { id: 1, liveRound: 5 } as never,
      bet: { id: 10, round: 5 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).toHaveBeenCalled();
  });

  it("[changmen 扩展] 折叠地图1 时不进 prepare", async () => {
    toggleMapMute(1, 1);
    await executeArbBet({
      match: { id: 1, liveRound: 0 } as never,
      bet: { id: 10, round: 1 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).not.toHaveBeenCalled();
    expect(recordArbAttemptMetric).not.toHaveBeenCalled();
  });

  it("[changmen 扩展] 全场胜负总开关只拦全场，地图仍进 prepare", async () => {
    setFullMatchMuteGlobal(true);
    await executeArbBet({
      match: { id: 1, liveRound: 0 } as never,
      bet: { id: 10, round: 0 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).not.toHaveBeenCalled();

    prepareArbAttempt.mockResolvedValue(null);
    await executeArbBet({
      match: { id: 1, liveRound: 0 } as never,
      bet: { id: 11, round: 1 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).toHaveBeenCalledOnce();
  });

  it("预检通过后 place 失败结果仍调用 finalize", async () => {
    const ready = { linkId: 1 };
    const checked = { ...ready, waitSec: 10 };
    const placed = {
      ...checked,
      placeOutcomeA: "api_failed",
      placeOutcomeB: "not_attempted",
    };
    prepareArbAttempt.mockResolvedValue(ready);
    checkArbLegs.mockResolvedValue(checked);
    placeArbLegs.mockResolvedValue(placed);
    finalizeArbBet.mockResolvedValue(undefined);

    await executeArbBet({
      match: { id: 1 } as never,
      bet: { id: 10 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });

    expect(placeArbLegs).toHaveBeenCalled();
    expect(finalizeArbBet).toHaveBeenCalledWith(expect.anything(), placed);
    expect(recordArbAttemptMetric).toHaveBeenCalledWith(
      expect.objectContaining({ stop: "complete" }),
    );
  });

  it("预检失败不 place / finalize", async () => {
    prepareArbAttempt.mockResolvedValue({ linkId: 1 });
    checkArbLegs.mockResolvedValue(null);

    await executeArbBet({
      match: { id: 1 } as never,
      bet: { id: 10 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });

    expect(placeArbLegs).not.toHaveBeenCalled();
    expect(finalizeArbBet).not.toHaveBeenCalled();
    expect(recordArbAttemptMetric).toHaveBeenCalledWith(
      expect.objectContaining({ stop: "skip_check" }),
    );
  });

  it("9999 预占后检查阶段异常会释放并吞掉异常", async () => {
    const setMessage = vi.fn();
    prepareArbAttempt.mockResolvedValue({
      linkId: 1,
      singleLeg9999MapReserved: true,
      singleLeg9999MapKeys: ["m:1", "source:Polymarket:pm:bet"],
    });
    checkArbLegs.mockRejectedValue(new Error("check boom"));

    await expect(executeArbBet({
      match: { id: 1 } as never,
      bet: { id: 10, round: 2 } as never,
      config: createDefaultUserConfig(),
      setMessage,
    })).resolves.toBeUndefined();

    expect(releaseSingleLeg9999MapFillKeys).toHaveBeenCalledWith(["m:1", "source:Polymarket:pm:bet"]);
    expect(setMessage).toHaveBeenCalledWith("自动下单异常：check boom");
    expect(syncActiveBetFail).toHaveBeenCalledWith(10, "check boom", "预检");
    expect(recordArbAttemptMetric).toHaveBeenCalledWith(
      expect.objectContaining({ stop: "error" }),
    );
  });

  it("进入下单阶段后异常不向主循环冒泡，也不释放 9999 预占", async () => {
    const setMessage = vi.fn();
    const ready = {
      linkId: 1,
      singleLeg9999MapReserved: true,
      singleLeg9999MapKeys: ["m:1"],
    };
    prepareArbAttempt.mockResolvedValue(ready);
    checkArbLegs.mockResolvedValue({ ...ready, waitSec: 10 });
    placeArbLegs.mockRejectedValue(new Error("place boom"));

    await expect(executeArbBet({
      match: { id: 1 } as never,
      bet: { id: 10, round: 2 } as never,
      config: createDefaultUserConfig(),
      setMessage,
    })).resolves.toBeUndefined();

    expect(releaseSingleLeg9999MapFillKeys).not.toHaveBeenCalled();
    expect(releaseSingleLeg9999MapFill).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith("自动下单异常：place boom");
    expect(syncActiveBetFail).toHaveBeenCalledWith(10, "place boom", "下单");
  });

  it("失败进度记录异常不能中断 FOK 指标收尾或向主循环冒泡", async () => {
    prepareArbAttempt.mockResolvedValue({ linkId: 1 });
    checkArbLegs.mockResolvedValue({ linkId: 1 });
    placeArbLegs.mockRejectedValue(new Error("place boom"));
    vi.mocked(syncActiveBetFail).mockImplementationOnce(() => { throw new Error("progress unavailable"); });
    const setMessage = vi.fn();
    await expect(executeArbBet({ match: { id: 1 } as never, bet: { id: 10, round: 2 } as never,
      config: createDefaultUserConfig(), setMessage })).resolves.toBeUndefined();
    expect(setMessage).toHaveBeenCalledWith("自动下单异常：place boom");
    expect(recordArbAttemptMetric).toHaveBeenCalledWith(expect.objectContaining({ stop: "error" }));
  });

  it("[changmen 扩展] 赛前全场 off 时未折叠的地图仍进 prepare", async () => {
    prepareArbAttempt.mockResolvedValue(null);
    await executeArbBet({
      match: { id: 1, liveRound: 0, startAt: Date.now() + 86_400_000 } as never,
      bet: { id: 10, round: 1 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).toHaveBeenCalled();
  });

  it("[changmen 扩展] 赛前全场 liveRound 模式下地图不进 prepare", async () => {
    setPrematchFullMode("liveRound");
    await executeArbBet({
      match: { id: 1, liveRound: 0, startAt: Date.now() + 86_400_000 } as never,
      bet: { id: 10, round: 1 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).not.toHaveBeenCalled();
    expect(recordArbAttemptMetric).not.toHaveBeenCalled();
  });

  it("[changmen 扩展] 赛前全场 liveRound 模式下滚球全场不进 prepare", async () => {
    setPrematchFullMode("liveRound");
    await executeArbBet({
      match: { id: 1, liveRound: 1, startAt: Date.now() + 86_400_000 } as never,
      bet: { id: 10, round: 0 } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
    expect(prepareArbAttempt).not.toHaveBeenCalled();
  });
});
