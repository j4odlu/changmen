/**
 * 整管线：cluster → project → shape → multi/ended（内存快照，无 RDS）。
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { clusterByGbThenName } from "../compose/cluster/merge_clusters.js";
import { resolveIdsDryRun } from "../compose/ids/resolve_ids.js";
import { checkNotSamePhysicalSide } from "../compose/invariants.js";
import { filterActiveClientMatches } from "../compose/shape/ended_filter.js";
import { applyLiveShape, filterMultiPlatform } from "../compose/shape/live_shape.js";
import { projectList } from "../compose/sides/project_sources.js";
import { resolveMatchStructure } from "../compose/structure/resolve_structure.js";
import {
  GB_K27,
  GB_NIP,
  installPlugin,
  makeBets,
  pmOb,
  pmRay,
  pmRayFlipped,
  rawOb,
  rawRay,
  rawRayFlipped,
} from "./fixtures.mjs";

describe("pipeline integration", () => {
  it("compose OB+RAY flipped → reverse + hedge ok", () => {
    installPlugin();
    const matches = {
      OB: { ob1: pmOb },
      RAY: { ray1: pmRayFlipped },
    };
    const bets = makeBets({
      OB: { 0: rawOb },
      RAY: { 0: rawRayFlipped },
    });
    let list = clusterByGbThenName(matches, []);
    assert.equal(list.length, 1);
    let info = resolveIdsDryRun(list, { matches, existingClientRows: [] });
    resolveMatchStructure(info, { matches, timers: {}, bets });
    projectList(info, { matches, bets, existingClientRows: [] });
    applyLiveShape(info, { matches });
    info = filterMultiPlatform(info);
    assert.equal(info.length, 1);
    assert.equal(info[0].HomeGbTeamId, GB_NIP);
    assert.equal(info[0].AwayGbTeamId, GB_K27);
    assert.ok(info[0].Reverse.includes("RAY"));
    const hedge = checkNotSamePhysicalSide(info[0], {
      platformA: "OB",
      slotA: "Home",
      platformB: "RAY",
      slotB: "Away",
      nativeByPlatformMap: { "OB:0": rawOb, "RAY:0": rawRayFlipped },
      matches,
    });
    assert.equal(hedge.ok, true, hedge.violations?.join("; "));
  });

  it("strip to single venue then multi-filter drops row", () => {
    installPlugin();
    const matches = { OB: { ob1: pmOb }, RAY: { ray1: pmRay } };
    const bets = makeBets({ OB: { 0: rawOb }, RAY: { 0: rawRay } });
    let list = clusterByGbThenName(matches, []);
    let info = resolveIdsDryRun(list, { matches });
    resolveMatchStructure(info, { matches, timers: {}, bets });
    projectList(info, { matches, bets });
    // 模拟 RAY 闪断：matches 只剩 OB
    const matchesObOnly = { OB: { ob1: pmOb } };
    applyLiveShape(info, { matches: matchesObOnly });
    info = filterMultiPlatform(info);
    assert.equal(info.length, 0);
  });

  it("ended when OB is_live absent and past fallback window", () => {
    installPlugin();
    const now = Date.now();
    const matches = {
      OB: { ob1: { ...pmOb, StartTime: now - 60 * 60 * 1000 } }, // 无 IsLive
      RAY: { ray1: { ...pmRay, StartTime: now - 60 * 60 * 1000 } },
    };
    const bets = makeBets({ OB: { 0: rawOb }, RAY: { 0: rawRay } });
    let list = clusterByGbThenName(matches, []);
    let info = resolveIdsDryRun(list, { matches });
    info[0].StartTime = now - 60 * 60 * 1000;
    resolveMatchStructure(info, { matches, timers: {}, bets });
    assert.equal(info[0].Round, 0);
    projectList(info, { matches, bets });
    applyLiveShape(info, { matches });
    info = filterMultiPlatform(info);
    const ended = filterActiveClientMatches(info, {
      platformMatches: matches,
      timersByProvider: {},
      now,
    });
    assert.ok(ended.endedCount >= 1);
  });

  it("uses match:id merge key prefix", () => {
    installPlugin();
    const list = clusterByGbThenName({
      OB: { ob1: pmOb },
      RAY: { ray1: pmRay },
    });
    assert.ok(String(list[0].MergeKey).startsWith("match:id:"));
  });
});
