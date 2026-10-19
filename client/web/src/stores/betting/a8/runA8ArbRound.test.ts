import { beforeEach, describe, expect, it, vi } from "vitest";
import { runA8ArbRound } from "@/stores/betting/a8/runA8ArbRound";

import { executeArbBet } from "@/stores/betting/autoBet/executeArbBet";
import { createDefaultUserConfig } from "@/types/userConfig";
import * as ray from "@changmen/venue-adapter/ray";

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
    vi.spyOn(ray, "isRayMatchRiskClosed").mockReturnValue(false);
    Object.assign(config, createDefaultUserConfig());
    matchStoreState.matchs = [];
    vi.mocked(executeArbBet).mockClear();
  });

  it("excludes closed matches from betting while retaining the display list and normal matches", async () => {
    matchStoreState.matchs = [{ id: 100, bets: [{ id: 1 }, { id: 2 }] }, { id: 101, bets: [{ id: 3 }] }];
    vi.mocked(ray.isRayMatchRiskClosed).mockImplementation(match => match.id === 100);
    config.betting = true;
    await runA8ArbRound({ setMessage: vi.fn() });
    expect(executeArbBet).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ match: matchStoreState.matchs[1] }));
    expect(matchStoreState.matchs).toHaveLength(2);
    expect(matchStoreState.matchs[0]!.bets).toHaveLength(2);
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
