import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pickPodPmAutoTicket,
  podPmAutoSkipReason,
  podPmFollowPlaceBlock,
  type PodPmFollowPlaceTicket,
} from "@/runtime/podPmFollowPlace";

function ticket(over: Partial<PodPmFollowPlaceTicket> = {}): PodPmFollowPlaceTicket {
  return {
    id: "1",
    stake: 50,
    fixtureStatus: "matched",
    fixtureBasis: "confirmed",
    pmMatchId: "pm-match",
    market: {
      status: "matched",
      venue: "Polymarket",
      locked: false,
      oid: "pm-token-over",
      betId: "pm-condition",
      quote: 1.95,
      marketCode: "totals",
      boardSide: "over",
      boardLine: 2.5,
      fromLive: true,
    },
    quote: { status: "ok", quote: 1.95, minObOdds: 1.9, maxObOdds: 2.18, evPercent: 5.4 },
    ...over,
  };
}

describe("podPmFollowPlace", () => {
  it("blocks tickets that are not PM-ready without touching OB rules", () => {
    expect(podPmFollowPlaceBlock(ticket({ fixtureStatus: "none" }))).toBe("场未对上");
    expect(podPmFollowPlaceBlock(ticket({
      market: { status: "none", venue: "Polymarket", locked: false, oid: "x", betId: "cond", quote: 1.9, marketCode: "totals", boardSide: "over", boardLine: 2.5, fromLive: true },
    }))).toBe("盘未对上");
    expect(podPmFollowPlaceBlock(ticket({
      market: { status: "matched", venue: "OB", locked: false, oid: "x", betId: "cond", quote: 1.9, marketCode: "totals", boardSide: "over", boardLine: 2.5, fromLive: true },
    }))).toBe("无 PM 盘");
    expect(podPmFollowPlaceBlock(ticket({
      market: { status: "matched", venue: "Polymarket", locked: false, oid: "", betId: "cond", quote: 1.9, marketCode: "totals", boardSide: "over", boardLine: 2.5, fromLive: true },
    }))).toBe("无 PM token");
    expect(podPmFollowPlaceBlock(ticket({
      market: { status: "matched", venue: "Polymarket", locked: false, oid: "pm-token-over", betId: "", quote: 1.9, marketCode: "totals", boardSide: "over", boardLine: 2.5, fromLive: true },
    }))).toBe("无 PM condition_id");
    expect(podPmFollowPlaceBlock(ticket({
      market: { status: "matched", venue: "Polymarket", locked: false, oid: "same", betId: "same", quote: 1.9, marketCode: "totals", boardSide: "over", boardLine: 2.5, fromLive: true },
    }))).toBe("PM condition_id 异常");
    expect(podPmFollowPlaceBlock(ticket({
      market: { status: "matched", venue: "Polymarket", locked: false, oid: "draw-token", betId: "draw-cond", quote: 3.2, marketCode: "moneyline", boardSide: "draw", boardLine: null, fromLive: true },
    }))).toBe("PM 暂不支持平局");
    expect(podPmFollowPlaceBlock(ticket({ quote: { status: "short", quote: 1.8, minObOdds: 1.9, maxObOdds: 2.18, evPercent: -2 } }))).toBe("PM 价不够");
    expect(podPmFollowPlaceBlock(ticket({ quote: { status: "spike", quote: 2.4, minObOdds: 1.9, maxObOdds: 2.18, evPercent: 30 } }))).toBe("EV 异常");
    expect(podPmFollowPlaceBlock(ticket({ stake: 0 }))).toBe("PM金额未设");
    expect(podPmFollowPlaceBlock(ticket())).toBe("请选择 PM 账号");
    expect(podPmFollowPlaceBlock(ticket({ accountIds: [7] }))).toBeNull();
  });

  it("picks PM auto tickets only when auto-safe", () => {
    const ready = ticket({ id: "a", accountIds: [7] });
    const blocked = ticket({ id: "b", stake: 0, accountIds: [7] });
    const high = ticket({
      id: "high",
      accountIds: [7],
      quote: { status: "ok", quote: 2.05, minObOdds: 1.9, maxObOdds: 2.18, evPercent: 11 },
    });
    expect(pickPodPmAutoTicket([blocked, ready], [])?.id).toBe("a");
    expect(pickPodPmAutoTicket([ready, high], [])?.id).toBe("high");
    expect(pickPodPmAutoTicket([ready], ["a"])).toBeNull();
    expect(podPmAutoSkipReason(ready, [], [{
      obMid: "pm-match",
      marketCode: "totals",
      boardSide: "over",
    }])).toBe("同向拦截加仓(over)");
    expect(podPmAutoSkipReason(ticket({
      id: "under",
      accountIds: [7],
      market: {
        status: "matched",
        venue: "Polymarket",
        locked: false,
        oid: "pm-token-under",
        betId: "pm-condition",
        quote: 1.95,
        marketCode: "totals",
        boardSide: "under",
        boardLine: 2.5,
        fromLive: true,
      },
    }), [], [{
      obMid: "pm-match",
      marketCode: "totals",
      boardSide: "over",
    }])).toBe("拦截反向对冲(over ↔ under)");
    expect(podPmAutoSkipReason(ticket({ id: "guess", fixtureBasis: "guess", accountIds: [7] }))).toBe("身份未确认");
    expect(podPmAutoSkipReason(ticket({
      id: "http",
      accountIds: [7],
      market: {
        status: "matched",
        venue: "Polymarket",
        locked: false,
        oid: "pm-token-over",
        betId: "pm-condition",
        quote: 1.95,
        marketCode: "totals",
        boardSide: "over",
        boardLine: 2.5,
        fromLive: false,
      },
    }))).toBe("等实时价");
    expect(pickPodPmAutoTicket([ticket({ id: "cap", accountIds: [7] })], [], [], {
      todayProfit: -200,
      openStake: 0,
      maxDailyLoss: 200,
    })).toBeNull();
    expect(pickPodPmAutoTicket([ticket({ id: "acct" })], [])).toBeNull();
  });

  it("keeps PM POD stake in RMB until account check converts venue currency", () => {
    const source = readFileSync(join(process.cwd(), "src/runtime/podPmFollowPlace.ts"), "utf8");
    expect(source).toMatch(/planStakeCny/);
    expect(source).toMatch(/checkBetting\(account, option[,)]/);
    expect(source).not.toMatch(/skipStakeResolve:\s*true/);
  });

  it("stores the PM condition id on the football order marker", () => {
    const source = readFileSync(join(process.cwd(), "src/runtime/podPmFollowPlace.ts"), "utf8");
    expect(source).toMatch(/const conditionId = String\(ticket\.market\.betId/);
    expect(source).toMatch(/obMid: conditionId/);
    expect(source).toMatch(/pmMatchId: matchId/);
    expect(source).not.toMatch(/obMid: matchId/);
  });

  it("persists POD identity fields through PM football orders", () => {
    const storeSource = readFileSync(join(process.cwd(), "src/stores/footballOrderStore.ts"), "utf8");
    const panelSource = readFileSync(join(process.cwd(), "src/components/football/PodFollowPanel.vue"), "utf8");
    expect(storeSource).toMatch(/podClientId:/);
    expect(storeSource).toMatch(/podPmMatchId:/);
    expect(panelSource).toMatch(/pmUnifiedFootballRows/);
    expect(panelSource).toMatch(/PodClientId/);
    expect(panelSource).toMatch(/PodPmMatchId/);
  });

  it("does not skip PM vault sync before user id is ready", () => {
    const source = readFileSync(join(process.cwd(), "src/runtime/podPmFollowPlace.ts"), "utf8");
    expect(source).toMatch(/if \(!user\.userId && user\.isLoggedIn\)/);
    expect(source).toMatch(/await user\.fetchUserInfo\(\)/);
  });
});
