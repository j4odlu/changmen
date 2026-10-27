import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { setTeamPlugin } from "@changmen/match-identity/teams/team_key.js";
import { clusterByGbThenName } from "../compose/cluster/merge_clusters.js";
import {
  GB_K27,
  GB_NIP,
  installPlugin,
  pmIa,
  pmOb,
  pmPm,
  pmRay,
} from "./fixtures.mjs";

const T0 = 1_800_000_000_000;

function pluginWithNameLookup(extraIdMap = {}, nameToGb = {}) {
  const idMap = {
    "OB:ob-nip": GB_NIP,
    "OB:ob-k27": GB_K27,
    "RAY:ray-nip": GB_NIP,
    "RAY:ray-k27": GB_K27,
    ...extraIdMap,
  };
  setTeamPlugin({
    lookupById: (p, id) => idMap[`${p}:${id}`] || null,
    lookupByName: () => null,
    lookupGbTeamIdByNormalizedNameForGame: (_game, normalized) => nameToGb[normalized] || null,
    lookupGbTeamIdByNormalizedName: normalized => nameToGb[normalized] || null,
    lookupCanonicalName: gb => ({ [GB_NIP]: "Ninjas in Pyjamas", [GB_K27]: "K27" }[gb] || null),
    lookupGameForGbTeamId: () => "cs2",
  });
}

describe("reconcileByName", () => {
  it("T1: id(OB+RAY) + name(PM+IA no gb) → 1 cluster of 4", () => {
    installPlugin();
    // PM/IA 无 HomeID → 进不了 id，靠队名成场；再与 id 场并
    const list = clusterByGbThenName({
      OB: { ob1: { ...pmOb, Home: "WW Team", Away: "Just Players", StartTime: T0 } },
      RAY: { ray1: { ...pmRay, Home: "WW Team", Away: "Just Players", StartTime: T0 + 60_000 } },
      Polymarket: {
        pm1: {
          ...pmPm,
          Home: "WW Team",
          Away: "Just Players",
          HomeID: "",
          AwayID: "",
          StartTime: T0 + 120_000,
        },
      },
      IA: {
        ia1: {
          ...pmIa,
          Home: "WW Team",
          Away: "Just Players",
          HomeID: "",
          AwayID: "",
          StartTime: T0 + 180_000,
        },
      },
    });
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0].Matchs).sort(), ["IA", "OB", "Polymarket", "RAY"]);
    assert.equal(list[0]._clusterBasis, "reconciled");
    assert.match(String(list[0].MergeKey), /^match:id:/);
  });

  it("T8: English id cluster + Chinese name cluster → merge via name→gb", () => {
    pluginWithNameLookup({}, {
      "ninjas in pyjamas": GB_NIP,
      nip: GB_NIP,
      "忍者": GB_NIP,
      k27: GB_K27,
      "凯二七": GB_K27,
    });
    const list = clusterByGbThenName({
      OB: { ob1: { ...pmOb, StartTime: T0 } },
      RAY: { ray1: { ...pmRay, StartTime: T0 } },
      Polymarket: {
        pm1: {
          SourceMatchID: "pm1",
          Home: "忍者",
          Away: "凯二七",
          HomeID: "",
          AwayID: "",
          SourceGameID: "3",
          StartTime: T0 + 60_000,
          BO: 3,
        },
      },
      IA: {
        ia1: {
          SourceMatchID: "ia1",
          Home: "忍者",
          Away: "凯二七",
          HomeID: "",
          AwayID: "",
          SourceGameID: "3",
          StartTime: T0 + 90_000,
          BO: 3,
        },
      },
    });
    assert.equal(list.length, 1);
    assert.equal(Object.keys(list[0].Matchs).length, 4);
    assert.equal(list[0]._clusterBasis, "reconciled");
  });

  it("T9: same names 40min apart → stay 2 clusters", () => {
    installPlugin();
    const list = clusterByGbThenName({
      OB: {
        ob1: {
          ...pmOb,
          HomeID: "",
          AwayID: "",
          Home: "Alpha Squad",
          Away: "Beta Force",
          StartTime: T0,
        },
      },
      RAY: {
        ray1: {
          ...pmRay,
          HomeID: "",
          AwayID: "",
          Home: "Alpha Squad",
          Away: "Beta Force",
          StartTime: T0 + 5 * 60_000,
        },
      },
      IA: {
        ia1: {
          ...pmIa,
          HomeID: "",
          AwayID: "",
          Home: "Alpha Squad",
          Away: "Beta Force",
          StartTime: T0 + 40 * 60_000,
        },
      },
      Polymarket: {
        pm1: {
          ...pmPm,
          HomeID: "",
          AwayID: "",
          Home: "Alpha Squad",
          Away: "Beta Force",
          StartTime: T0 + 42 * 60_000,
        },
      },
    });
    // name 阶段：T0 一组、T0+40 一组；并场窗 30min → 仍两场
    assert.equal(list.length, 2);
  });

  it("T10: BO 1 vs BO 3 within 10min → do not merge", () => {
    installPlugin();
    const list = clusterByGbThenName({
      OB: { ob1: { ...pmOb, BO: 1, StartTime: T0 } },
      RAY: { ray1: { ...pmRay, BO: 1, StartTime: T0 } },
      Polymarket: {
        pm1: {
          ...pmPm,
          HomeID: "",
          AwayID: "",
          Home: "Ninjas in Pyjamas",
          Away: "K27",
          BO: 3,
          StartTime: T0 + 5 * 60_000,
        },
      },
      IA: {
        ia1: {
          ...pmIa,
          HomeID: "",
          AwayID: "",
          Home: "Ninjas in Pyjamas",
          Away: "K27",
          BO: 3,
          StartTime: T0 + 6 * 60_000,
        },
      },
    });
    assert.equal(list.length, 2);
  });

  it("T13: seed cluster not merged with name cluster", () => {
    installPlugin();
    const list = clusterByGbThenName(
      {
        OB: { ob1: pmOb },
        RAY: { ray1: pmRay },
        Polymarket: {
          pm1: {
            ...pmPm,
            HomeID: "",
            AwayID: "",
            Home: "Ninjas in Pyjamas",
            Away: "K27",
          },
        },
        IA: {
          ia1: {
            ...pmIa,
            HomeID: "",
            AwayID: "",
            Home: "Ninjas in Pyjamas",
            Away: "K27",
          },
        },
      },
      [{
        id: 99,
        merge_key: "manual:seed",
        matchs: { OB: "ob1", RAY: "ray1" },
        home_gb_team_id: GB_NIP,
        away_gb_team_id: GB_K27,
      }],
    );
    // seed 占住 OB+RAY；PM+IA name 场；seed 不参与 4b
    assert.equal(list.length, 2);
    const bases = list.map(r => r._clusterBasis).sort();
    assert.deepEqual(bases, ["name", "seed"]);
  });
});
