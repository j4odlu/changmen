import { beforeEach, describe, expect, it, vi } from "vitest";
import { runA8ArbRound } from "@/stores/betting/a8/runA8ArbRound";

import { executeArbBet } from "@/stores/betting/autoBet/executeArbBet";
import { createDefaultUserConfig } from "@/types/userConfig";

const config = createDefaultUserConfig();
const matchStoreState = {
  matchs: [] as { id: number; bets: { id: number }[] }[],
};

vi.mock("@/stores/userStore", () => ({
  useUserStore: () => ({ config }),
}));

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => matchStoreState,
}));

vi.mock("@/stores/betting/autoBet/executeArbBet", () => ({
  executeArbBet: vi.fn(async () => {}),
}));

describe("runA8ArbRound", () => {
  beforeEach(() => {
    Object.assign(config, createDefaultUserConfig());
    matchStoreState.matchs = [];
    vi.mocked(executeArbBet).mockClear();
  });

  it("does nothing when betting off", async () => {
    config.betting = false;
    matchStoreState.matchs = [{ id: 100, bets: [{ id: 1 }] }];

    await runA8ArbRound({ setMessage: () => {} });

    expect(executeArbBet).not.toHaveBeenCalled();
  });

  it("calls executeArbBet for every bet when betting on", async () => {
    matchStoreState.matchs = [
      { id: 100, bets: [{ id: 1 }, { id: 2 }] },
    ];
    config.betting = true;

    await runA8ArbRound({ setMessage: () => {} });

    expect(executeArbBet).toHaveBeenCalledTimes(2);
  });
});
