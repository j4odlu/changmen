import { describe, expect, test } from "vitest";
import {
  pickSportSubscribeIds,
  SPORT_OB_MID_CAP,
  SPORT_SUBSCRIBE_HARD_CAP,
} from "@/runtime/sportLiveOdds";
import { ViewBet, ViewBetItem, ViewMatch } from "@/models/match";

function makeMatch(opts: {
  id: number;
  startAt: number;
  pmHome?: string;
  pmAway?: string;
  pfHomeM?: string;
  pfAwayM?: string;
  obMid?: string;
  obHome?: string;
  rayHome?: string;
}): ViewMatch {
  const m = Object.create(ViewMatch.prototype) as ViewMatch;
  m.id = opts.id;
  m.startAt = opts.startAt;
  m.providers = opts.obMid ? { OB: opts.obMid } : {};
  m.bets = [];
  const bet = Object.create(ViewBet.prototype) as ViewBet;
  bet.items = [];
  if (opts.pmHome) {
    const item = Object.create(ViewBetItem.prototype) as ViewBetItem;
    item.type = "Polymarket";
    item.homeId = opts.pmHome;
    item.awayId = opts.pmAway || `${opts.pmHome}-a`;
    item.homeSubscribeId = item.homeId;
    item.awaySubscribeId = item.awayId;
    bet.items.push(item);
  }
  if (opts.pfHomeM) {
    const item = Object.create(ViewBetItem.prototype) as ViewBetItem;
    item.type = "PredictFun";
    item.homeId = "onchain-h";
    item.awayId = "onchain-a";
    item.homeSubscribeId = opts.pfHomeM;
    item.awaySubscribeId = opts.pfAwayM || opts.pfHomeM;
    bet.items.push(item);
  }
  if (opts.obHome) {
    const item = Object.create(ViewBetItem.prototype) as ViewBetItem;
    item.type = "OB";
    item.homeSubscribeId = opts.obHome;
    item.awaySubscribeId = `${opts.obHome}-a`;
    bet.items.push(item);
  }
  if (opts.rayHome) {
    const item = Object.create(ViewBetItem.prototype) as ViewBetItem;
    item.type = "RAY";
    item.homeId = opts.rayHome;
    item.awayId = `${opts.rayHome}-a`;
    item.homeSubscribeId = item.homeId;
    item.awaySubscribeId = item.awayId;
    item.drawSubscribeId = `${opts.rayHome}-d`;
    bet.items.push(item);
  }
  m.bets.push(bet);
  return m;
}

describe("pickSportSubscribeIds", () => {
  test("subscribes every match on the board list", () => {
    const now = 1_700_000_000_000;
    const ok = makeMatch({ id: 1, startAt: now + 30 * 60_000, pmHome: "t1", pmAway: "t2" });
    const old = makeMatch({
      id: 2,
      startAt: now - 7 * 3600_000,
      pmHome: "old1",
      pmAway: "old2",
    });
    const later = makeMatch({
      id: 3,
      startAt: now + 7 * 3600_000,
      pmHome: "later1",
      pmAway: "later2",
    });
    const pick = pickSportSubscribeIds([ok, old, later], 100, now);
    expect(pick.polymarketAssetIds.sort()).toEqual(["later1", "later2", "old1", "old2", "t1", "t2"]);
  });

  test("C8 follows listed overlay matches even outside the OB 2h board window", () => {
    const now = 1_700_000_000_000;
    const later = makeMatch({
      id: 3,
      startAt: now + 5 * 3600_000,
      pmHome: "later1",
      pmAway: "later2",
      obMid: "5650999",
      obHome: "oid-later",
    });
    const pick = pickSportSubscribeIds([later], 100, now);
    expect(pick.polymarketAssetIds.sort()).toEqual(["later1", "later2"]);
    expect(pick.obMids).toEqual(["5650999"]);
    expect(pick.obOids.sort()).toEqual(["oid-later", "oid-later-a"]);
  });

  test("hard cap limits total tokens across PM+PF", () => {
    const now = 1_700_000_000_000;
    const matches = Array.from({ length: 80 }, (_, i) =>
      makeMatch({
        id: i,
        startAt: now + i * 1000,
        pmHome: `pm-h-${i}`,
        pmAway: `pm-a-${i}`,
        pfHomeM: `pf-h-${i}`,
        pfAwayM: `pf-a-${i}`,
      }),
    );
    const pick = pickSportSubscribeIds(matches, SPORT_SUBSCRIBE_HARD_CAP, now);
    const total = pick.polymarketAssetIds.length + pick.predictFunMarketIds.length;
    expect(total).toBe(SPORT_SUBSCRIBE_HARD_CAP);
  });

  test("skips PF single-market dual-outcome (same marketId both sides)", () => {
    const now = 1_700_000_000_000;
    const m = makeMatch({
      id: 1,
      startAt: now,
      pfHomeM: "same-mkt",
      pfAwayM: "same-mkt",
    });
    const pick = pickSportSubscribeIds([m], 100, now);
    expect(pick.predictFunMarketIds).toEqual([]);
  });

  test("collects OB mids for C8 subscribe", () => {
    const now = 1_700_000_000_000;
    const m = makeMatch({
      id: 1,
      startAt: now,
      obMid: "5650335",
      obHome: "oid-h",
    });
    const pick = pickSportSubscribeIds([m], 100, now);
    expect(pick.obMids).toEqual(["5650335"]);
    expect(pick.obOids.sort()).toEqual(["oid-h", "oid-h-a"]);
  });

  test("tracks listed RAY odd ids for the shared SocketCluster feed", () => {
    const now = 1_700_000_000_000;
    const m = makeMatch({ id: 1, startAt: now, rayHome: "ray-h" });
    const pick = pickSportSubscribeIds([m], 100, now);
    expect(pick.rayOddIds.sort()).toEqual(["ray-h", "ray-h-a", "ray-h-d"]);
  });

  test("drops 19-digit OB bag ids from C8 mids", () => {
    const now = 1_700_000_000_000;
    const m = makeMatch({
      id: 1,
      startAt: now,
      obMid: "2097200625505820674",
      obHome: "oid-h",
    });
    const pick = pickSportSubscribeIds([m], 100, now);
    expect(pick.obMids).toEqual([]);
  });

  test("OB list oids fall back to homeId when subscribeId is empty", () => {
    const now = 1_700_000_000_000;
    const m = makeMatch({ id: 1, startAt: now, obMid: "5650335" });
    const item = Object.create(ViewBetItem.prototype) as ViewBetItem;
    item.type = "OB";
    item.homeId = "oid-from-http";
    item.awayId = "oid-away";
    item.homeSubscribeId = "";
    item.awaySubscribeId = "";
    m.bets[0].items.push(item);
    const pick = pickSportSubscribeIds([m], 100, now);
    expect(pick.obOids.sort()).toEqual(["oid-away", "oid-from-http"]);
    expect(pick.obMids).toEqual(["5650335"]);
  });

  test("caps OB C8 mids so subscribe dump cannot freeze the page", () => {
    const now = 1_700_000_000_000;
    const matches = Array.from({ length: 80 }, (_, i) =>
      makeMatch({
        id: i,
        startAt: now + i * 1000,
        obMid: String(5650000 + i),
        obHome: `oid-${i}`,
      }),
    );
    const pick = pickSportSubscribeIds(matches, 100, now, SPORT_OB_MID_CAP);
    expect(pick.obMids).toHaveLength(SPORT_OB_MID_CAP);
  });

  test("prefers in-play OB mids over soon-to-kick upcoming when C8 is capped", () => {
    const now = 1_700_000_000_000;
    const live = [30, 60, 90].map((mins, i) =>
      makeMatch({
        id: 100 + i,
        startAt: now - mins * 60_000,
        obMid: String(5600001 + i),
        obHome: `live-${i}`,
      }),
    );
    const upcoming = Array.from({ length: 20 }, (_, i) =>
      makeMatch({
        id: i,
        startAt: now + (i + 1) * 60_000,
        obMid: String(5700000 + i),
        obHome: `up-${i}`,
      }),
    );
    const pick = pickSportSubscribeIds([...upcoming, ...live], 100, now, 5);
    expect(pick.obMids).toEqual(["5600001", "5600002", "5600003", "5700000", "5700001"]);
  });
});
