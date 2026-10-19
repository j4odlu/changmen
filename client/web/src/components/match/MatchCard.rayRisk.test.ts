import { expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import type { ViewMatch } from "@/models/match";
import { updateRayMatchRisk } from "../../../../../packages/venue-adapter/ray/rayMatchRisk";
import MatchCard from "./MatchCard.vue";

vi.mock("./BetRow.vue", () => ({ default: { setup: () => () => h("div", { class: "test-bet-row" }, "可下注盘口") } }));

it("reactively retains only name, time and notice when the existing RAY response closes a match", async () => {
  const now = Date.now();
  const match = { id: 970001, title: "Home vs Away", startAt: now + 3600000, game: "cs2",
    providers: { RAY: "970002", Polymarket: "pm" },
    pmSport: { resolutionSource: "https://twitch.tv/epl_pro" }, bets: [{ id: 1 }] } as unknown as ViewMatch;
  const render = (value = match) => renderToString(createSSRApp(MatchCard, { match: value }));
  const normal = await render();
  expect(normal).toContain("test-bet-row"); expect(normal).toContain("game-icon");
  expect(normal).toContain("pm-match-status"); expect(normal).toContain("pm-sport-link");
  updateRayMatchRisk("970002", { id: "970002", status: 1, round: "bo3", start_time: new Date(now + 3600000).toISOString(),
    team: [{ pos: 1, team_id: "h" }, { pos: 2, team_id: "a" }], odds: [1, 2, 3].flatMap(map => [0, 1].map(side => ({
      odds_group_id: map, odds_id: `${map}:${side}`, team_id: side ? "a" : "h", match_stage: `map${map}`,
      group_name: "获胜者", status: map === 3 ? 5 : 1, win: map === 3 ? side : -1,
    }))) }, /^获胜者$/, "cs2", now);
  const closed = await render();
  expect(closed).toContain("Home vs Away"); expect(closed).toContain('class="startTime"');
  expect(closed).toContain("可能存在让局，此局关闭。");
  for (const marker of ["test-bet-row", "可下注盘口", 'class="bets', "game-icon", "pm-match-status", "pm-sport-link"])
    expect(closed).not.toContain(marker);
  expect(await render({ ...match, id: 970003, providers: { RAY: "970004" } })).toContain("test-bet-row");
  expect(match.bets).toHaveLength(1);
});
