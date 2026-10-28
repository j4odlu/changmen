import type { ArbOpportunity } from "@changmen/arb-core/opportunity/types";
import { describe, expect, it } from "vitest";
import {
  diffOpportunities,
  snapshotOpportunities,
} from "@changmen/arb-core/opportunity/state";
import { opportunityKey } from "@changmen/arb-core/opportunity/types";

function makeOpp(patch: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    scope: "fullMarket",
    matchId: 100,
    betId: 1,
    matchTitle: "A vs B",
    betName: "[地图1] 获胜",
    homePlatform: "PB",
    awayPlatform: "RAY",
    homeItemId: "h1", awayItemId: "a2",
    homeOdds: 2.1,
    awayOdds: 2.2,
    implied: 1.05,
    ...patch,
  };
}

describe("diffOpportunities", () => {
  it("emits appeared when a new opportunity key shows up", () => {
    const opp = makeOpp();
    const transitions = diffOpportunities(new Map(), [opp]);
    expect(transitions).toEqual([{ kind: "appeared", opportunity: opp }]);
  });

  it("emits gone when an opportunity key disappears", () => {
    const opp = makeOpp();
    const key = opportunityKey(opp);
    const transitions = diffOpportunities(snapshotOpportunities([opp]), []);
    expect(transitions).toEqual([{ kind: "gone", key, previous: opp }]);
  });
});
