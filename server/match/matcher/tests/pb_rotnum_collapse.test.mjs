import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  applyPlatformBindings,
  clusterByGbThenName,
} from "../compose/cluster/merge_clusters.js";
import { collectPlatformEntries } from "../compose/normalize/platform_entry.ts";
import {
  collapsePbEntriesByRotNum,
  isPbRotGroupCollision,
  listPbRotNumSiblings,
  pickPrimaryPbEntry,
} from "../compose/normalize/pb_rotnum_collapse.js";
import { collectPeriods } from "../compose/structure/resolve_structure.js";
import { sourceIdsToBackfill } from "../ops/backfill_platform_match_ids.js";
import { installPlugin, pmOb, pmPb } from "./fixtures.mjs";

const LIVE_ID = "1633928872";
const PRE_ID = "1633895060";
const ROT = "31832";

function pbLive(extra = {}) {
  return { ...pmPb, SourceMatchID: LIVE_ID, RotNum: ROT, ...extra };
}

function pbPrematch(extra = {}) {
  return { ...pmPb, SourceMatchID: PRE_ID, RotNum: ROT, ...extra };
}

function pbBets() {
  return {
    [`PB:${LIVE_ID}`]: [{ Map: 0, SourceBetID: "l0", SourceHomeID: "h", SourceAwayID: "a" }],
    [`PB:${PRE_ID}`]: [
      { Map: 2, SourceBetID: "p2", SourceHomeID: "h", SourceAwayID: "a" },
      { Map: 3, SourceBetID: "p3", SourceHomeID: "h", SourceAwayID: "a" },
    ],
  };
}

function dualMatches(extraPb = {}) {
  return {
    OB: { ob1: pmOb },
    PB: {
      [LIVE_ID]: pbLive(extraPb.live),
      [PRE_ID]: pbPrematch(extraPb.pre),
    },
  };
}

/** A8 `mHe`：不上报 RotNum，只标 IsLive */
function dualMatchesA8(extraPb = {}) {
  return {
    OB: { ob1: pmOb },
    PB: {
      [LIVE_ID]: {
        ...pmPb,
        SourceMatchID: LIVE_ID,
        IsLive: 1,
        ...(extraPb.live || {}),
      },
      [PRE_ID]: {
        ...pmPb,
        SourceMatchID: PRE_ID,
        IsLive: 0,
        ...(extraPb.pre || {}),
      },
    },
  };
}

const collapseOpts = { pbRotnumCollapse: true, bets: pbBets() };

describe("PB rotNum collapse (Phase A)", () => {
  it("same rot two events → one Matchs.PB (live / map0)", () => {
    installPlugin();
    const list = clusterByGbThenName(dualMatches(), [], collapseOpts);
    assert.equal(list.length, 1);
    assert.equal(list[0].Matchs.OB, "ob1");
    assert.equal(list[0].Matchs.PB, LIVE_ID);
    assert.deepEqual(list[0]._pbSiblingSourceMatchIds, [PRE_ID]);
  });

  it("no rotNum does not collapse two unstarted books", () => {
    installPlugin();
    const entries = collectPlatformEntries({
      PB: {
        a: { ...pmPb, SourceMatchID: "a" },
        b: { ...pmPb, SourceMatchID: "b" },
      },
    });
    const { entries: out, collapsedGroups } = collapsePbEntriesByRotNum(entries, {
      enabled: true,
    });
    assert.equal(collapsedGroups, 0);
    assert.equal(out.length, 2);
  });

  it("A8 no rotNum: live + leftover prematch → Matchs.PB is live event", () => {
    installPlugin();
    const matches = dualMatchesA8();
    const list = clusterByGbThenName(matches, [], collapseOpts);
    assert.equal(list.length, 1);
    assert.equal(list[0].Matchs.OB, "ob1");
    assert.equal(list[0].Matchs.PB, LIVE_ID);
    assert.equal(list[0]._pbSiblingSourceMatchIds, undefined);
    assert.deepEqual(collectPeriods(list[0], pbBets(), 0, matches), [0]);
  });

  it("A8 no rotNum: IsLive alone (no bets) still prefers live", () => {
    installPlugin();
    const list = clusterByGbThenName(dualMatchesA8(), [], { pbRotnumCollapse: true, bets: {} });
    assert.equal(list.length, 1);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
  });

  it("A8 no rotNum: two live-like books do not collapse", () => {
    installPlugin();
    const entries = collectPlatformEntries({
      PB: {
        a: { ...pmPb, SourceMatchID: "a", IsLive: 1 },
        b: { ...pmPb, SourceMatchID: "b", IsLive: 1 },
      },
    });
    const { entries: out, collapsedGroups } = collapsePbEntriesByRotNum(entries, {
      enabled: true,
    });
    assert.equal(collapsedGroups, 0);
    assert.equal(out.length, 2);
  });

  it("A8 no rotNum: sticky prematch promotes to live", () => {
    installPlugin();
    const list = clusterByGbThenName(
      dualMatchesA8(),
      [{
        id: 1730,
        merge_key: "manual:seed",
        matchs: { OB: "ob1", PB: PRE_ID },
      }],
      collapseOpts,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].ID, 1730);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
  });

  it("A8 no rotNum: live startMs drift still clusters with OB", () => {
    installPlugin();
    const t0 = pmOb.StartTime;
    const list = clusterByGbThenName(
      dualMatchesA8({
        live: { StartTime: t0 + 90 * 60 * 1000 },
        pre: { StartTime: t0 },
      }),
      [],
      collapseOpts,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
    assert.equal(list[0].Matchs.OB, "ob1");
  });

  it("sticky existing matchs.PB keeps live when already bound", () => {
    installPlugin();
    const list = clusterByGbThenName(
      dualMatches(),
      [{
        id: 1730,
        merge_key: "manual:seed",
        matchs: { OB: "ob1", PB: LIVE_ID },
      }],
      collapseOpts,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].ID, 1730);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
  });

  it("promotes unstarted-maps sticky to live map0", () => {
    installPlugin();
    const list = clusterByGbThenName(
      dualMatches(),
      [{
        id: 1730,
        merge_key: "manual:seed",
        matchs: { OB: "ob1", PB: PRE_ID },
      }],
      collapseOpts,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].ID, 1730);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
  });

  it("collision same rot different teams does not merge", () => {
    installPlugin();
    const entries = collectPlatformEntries({
      PB: {
        x: { ...pmPb, SourceMatchID: "x", RotNum: ROT, Home: "Alpha", Away: "Beta", HomeID: "", AwayID: "" },
        y: { ...pmPb, SourceMatchID: "y", RotNum: ROT, Home: "Gamma", Away: "Delta", HomeID: "", AwayID: "" },
      },
    });
    const { entries: out, skippedCollisions, collapsedGroups } = collapsePbEntriesByRotNum(entries, {
      enabled: true,
    });
    assert.equal(skippedCollisions, 1);
    assert.equal(collapsedGroups, 0);
    assert.equal(out.length, 2);
  });

  it("partial gb + different names is collision (not merge)", () => {
    installPlugin();
    const entries = collectPlatformEntries({
      PB: {
        // 有 gb（pb-nip / pb-k27 → plugin）
        a: { ...pmPb, SourceMatchID: "a", RotNum: ROT, Home: "Ninjas in Pyjamas", Away: "K27" },
        // 无 HomeID → 无 gb，队名不同
        b: {
          ...pmPb,
          SourceMatchID: "b",
          RotNum: ROT,
          Home: "Spirit",
          Away: "Aurora",
          HomeID: "",
          AwayID: "",
        },
      },
    });
    assert.equal(isPbRotGroupCollision(entries), true);
    const { skippedCollisions, collapsedGroups, entries: out } = collapsePbEntriesByRotNum(entries, {
      enabled: true,
    });
    assert.equal(skippedCollisions, 1);
    assert.equal(collapsedGroups, 0);
    assert.equal(out.filter(e => e.platform === "PB").length, 2);
  });

  it("listPbRotNumSiblings rejects empty-name counterpart", () => {
    const matches = {
      PB: {
        [LIVE_ID]: pbLive(),
        ghost: {
          ...pmPb,
          SourceMatchID: "ghost",
          RotNum: ROT,
          Home: "",
          Away: "",
          HomeID: "",
          AwayID: "",
        },
      },
    };
    assert.deepEqual(listPbRotNumSiblings(matches, LIVE_ID), []);
  });

  it("applyPlatformBindings sticky is only existing Matchs.PB", () => {
    installPlugin();
    const matches = dualMatches();
    // sticky=PRE（未开图），应升到 LIVE
    const row = {
      ID: 11,
      Matchs: { OB: "ob1", PB: PRE_ID },
      MergeKey: "x",
      Bets: [],
      Reverse: [],
    };
    const { list } = applyPlatformBindings(
      [row],
      new Map([[11, [
        { platform: "PB", source_match_id: PRE_ID },
        { platform: "PB", source_match_id: LIVE_ID },
        { platform: "OB", source_match_id: "ob1" },
      ]]]),
      matches,
      { bets: pbBets(), pbRotnumCollapse: true },
    );
    assert.equal(list[0].Matchs.PB, LIVE_ID);
  });

  it("flag off leaves both PB entries (cluster keeps one slot still)", () => {
    installPlugin();
    const collected = collectPlatformEntries(dualMatches());
    const { entries, collapsedGroups } = collapsePbEntriesByRotNum(collected, {
      bets: pbBets(),
      enabled: false,
    });
    assert.equal(collapsedGroups, 0);
    assert.equal(entries.filter(e => e.platform === "PB").length, 2);

    const list = clusterByGbThenName(dualMatches(), [], {
      pbRotnumCollapse: false,
      bets: pbBets(),
    });
    assert.equal(list.length, 1);
    assert.ok(["OB", "PB"].every(p => list[0].Matchs[p]));
  });

  it("applyPlatformBindings elects live among two PB bindings", () => {
    installPlugin();
    const matches = dualMatches();
    const row = {
      ID: 9,
      Matchs: { OB: "ob1", PB: PRE_ID },
      MergeKey: "x",
      Bets: [],
      Reverse: [],
    };
    const { list } = applyPlatformBindings(
      [row],
      new Map([[9, [
        { platform: "PB", source_match_id: PRE_ID },
        { platform: "PB", source_match_id: LIVE_ID },
        { platform: "OB", source_match_id: "ob1" },
      ]]]),
      matches,
      { bets: pbBets(), pbRotnumCollapse: true },
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
  });

  it("listPbRotNumSiblings / backfill ids include sibling", () => {
    const matches = dualMatches();
    assert.deepEqual(listPbRotNumSiblings(matches, LIVE_ID), [PRE_ID]);
    const ids = sourceIdsToBackfill({ Matchs: { OB: "ob1", PB: LIVE_ID } }, matches);
    assert.deepEqual(
      ids.map(x => `${x.plat}:${x.srcId}`).sort(),
      [`OB:ob1`, `PB:${LIVE_ID}`, `PB:${PRE_ID}`].sort(),
    );
  });

  it("keeps series startMs so live event still clusters with OB", () => {
    installPlugin();
    const t0 = pmOb.StartTime;
    const matches = {
      OB: { ob1: pmOb },
      PB: {
        [LIVE_ID]: pbLive({ StartTime: t0 + 90 * 60 * 1000 }),
        [PRE_ID]: pbPrematch({ StartTime: t0 }),
      },
    };
    const list = clusterByGbThenName(matches, [], collapseOpts);
    assert.equal(list.length, 1);
    assert.equal(list[0].Matchs.PB, LIVE_ID);
    assert.equal(list[0].Matchs.OB, "ob1");
  });

  it("same gb pair with different names still collapses", () => {
    installPlugin();
    const entries = collectPlatformEntries({
      PB: {
        [LIVE_ID]: pbLive({ Home: "Ninjas in Pyjamas", Away: "K27" }),
        [PRE_ID]: pbPrematch({ Home: "NiP", Away: "K27" }),
      },
    });
    const { collapsedGroups, entries: out } = collapsePbEntriesByRotNum(entries, {
      bets: pbBets(),
      enabled: true,
    });
    assert.equal(collapsedGroups, 1);
    assert.equal(out.filter(e => e.platform === "PB").length, 1);
  });

  it("pickPrimary prefers sticky when not unstarted-only", () => {
    const entries = collectPlatformEntries({
      PB: { [LIVE_ID]: pbLive(), [PRE_ID]: pbPrematch() },
    });
    const primary = pickPrimaryPbEntry(entries, {
      bets: pbBets(),
      stickySourceMatchIds: new Set([LIVE_ID]),
    });
    assert.equal(primary.sourceMatchId, LIVE_ID);
  });
});
