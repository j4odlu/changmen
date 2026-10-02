import { describe, expect, it } from "vitest";
import {
  buildLegSections,
  buildLogSegments,
  buildOrderSections,
  buildPlatformSections,
  computeLogWindow,
  extractLogAccountLabel,
  extractLogOrderId,
  extractLogProvider,
  extractLogTarget,
  filterRelevantLogs,
  groupMetaLabel,
  linkTypeLabel,
  summarizeUserLog,
  toAdminOrderLogPayload,
} from "./user_log_lookup.js";

describe("user_log_lookup", () => {
  it("never attaches a conflicting explicit Link result to the previous check", () => {
    const orders = [{ orderId: "o1", link: 123, provider: "OB", match: "m", bet: "b", createAt: 1000 }];
    const logs = [
      { id: 1, kind: "check", linkId: 123, provider: "OB", createAt: 1000 },
      { id: 2, kind: "bet", linkId: 456, provider: "OB", createAt: 1100 },
    ];
    const result = filterRelevantLogs(orders, logs);
    expect(result.relevant.map(log => log.id)).toEqual([1]);
    expect(result.unrelated.map(log => log.id)).toEqual([2]);
  });

  it("caps legacy time-window expansion at one day", () => {
    const window = computeLogWindow([{ create_at: 100_000_000 }], Number.MAX_SAFE_INTEGER);
    expect(window.toMs - window.fromMs).toBe(2 * 86_400_000);
  });
  it("linkTypeLabel and groupMetaLabel", () => {
    expect(linkTypeLabel(1_781_802_360_547)).toBe("套利");
    expect(linkTypeLabel(-1)).toBe("单边");
    expect(linkTypeLabel(12345)).toBe("hash");
    expect(groupMetaLabel(1_781_802_360_547, 1)).toBe("单笔");
    expect(groupMetaLabel(1_781_802_360_547, 2)).toBe("套利 2 笔");
  });

  it("computeLogWindow spans orders and arb link timestamp", () => {
    const linkTs = 1_781_802_360_547;
    const orders = [
      { create_at: linkTs + 900, link: linkTs },
      { create_at: linkTs + 1400, link: linkTs },
    ];
    const w = computeLogWindow(orders, 60_000);
    expect(w.fromMs).toBe(linkTs - 60_000);
    expect(w.toMs).toBe(linkTs + 1400 + 60_000);
  });

  it("computeLogWindow also uses absolute single-leg link timestamp", () => {
    const linkTs = 1_781_802_360_547;
    const orders = [
      { create_at: linkTs + 90_000, link: -linkTs },
    ];
    const w = computeLogWindow(orders, 30_000);
    expect(w.fromMs).toBe(linkTs - 30_000);
    expect(w.toMs).toBe(linkTs + 90_000 + 30_000);
  });

  it("summarizeUserLog extracts bet failure message", () => {
    const row = {
      id: 1,
      create_at: 1,
      title: "[RAY](雷,6) 下注 => false / 耗时:869ms",
      data: JSON.stringify({
        result: {
          provider: "RAY",
          success: false,
          message: "赔率下降至1.87",
        },
      }),
    };
    const s = summarizeUserLog(row);
    expect(s.kind).toBe("bet");
    expect(s.provider).toBe("RAY");
    expect(s.summary).toContain("失败");
    expect(s.summary).toContain("赔率下降至1.87");
  });

  it("summarizeUserLog exposes request amount and odds", () => {
    const s = summarizeUserLog({
      id: 2,
      create_at: 10,
      title: "[OB](星空,4) 下注 => true / 耗时:134ms",
      data: JSON.stringify({
        result: {
          provider: "OB",
          success: true,
          message: "买入成功",
          request: {
            "b[0]": "mch=m1&mkt=b1&oid=o1&odd=2.111&a=100&bt=1",
          },
        },
      }),
    });
    expect(s.requestAmount).toBe(100);
    expect(s.requestOdds).toBe(2.111);
    expect(s.summary).toContain("金额100");
  });

  it("filterRelevantLogs removes other matches and keeps bet after related check", () => {
    const orders = [
      {
        orderId: "ob-order",
        provider: "OB",
        match: "CGN Esports vs Barça eSports",
        bet: "[地图3]单局 - 获胜",
        item: "Barça eSports",
        odds: 2.111,
        betMoney: 100,
        createAt: 10_000,
      },
    ];
    const logs = [
      summarizeUserLog({
        id: 1,
        create_at: 9_000,
        title: "[OB](星空,4) 请求盘口数据 => false",
        data: JSON.stringify({
          options: {
            type: "OB",
            match: "Beşiktaş Esports vs AlQadsiah Esports",
            bet: "[地图3] 获胜",
            target: "Away",
            odds: 1.65,
            betMoney: 100,
          },
          checkError: "盘口已暂停",
        }),
      }),
      summarizeUserLog({
        id: 2,
        create_at: 9_900,
        title: "[OB](星空,4) 请求盘口数据 => true",
        data: JSON.stringify({
          options: {
            type: "OB",
            match: "CGN Esports vs Barça eSports",
            bet: "[地图3] 获胜",
            target: "Away",
            odds: 2.111,
            betMoney: 100,
          },
        }),
      }),
      summarizeUserLog({
        id: 3,
        create_at: 10_050,
        title: "[OB](星空,4) 下注 => true / 耗时:134ms",
        data: JSON.stringify({
          result: {
            provider: "OB",
            success: true,
            message: "买入成功",
            request: {
              "b[0]": "mch=m1&mkt=b1&oid=o1&odd=2.111&a=100&bt=1",
            },
          },
        }),
      }),
    ];
    const filtered = filterRelevantLogs(orders, logs);
    expect(filtered.relevant.map(l => l.id)).toEqual([2, 3]);
    expect(filtered.relevant[1].matchedOrderId).toBe("ob-order");
    expect(filtered.unrelated.map(l => l.id)).toEqual([1]);
  });

  it("keeps makeup queue as a standalone orchestration segment", () => {
    const segments = buildLogSegments([
      { id: 1, createAt: 100, kind: "check", provider: "Polymarket", title: "check" },
      { id: 2, createAt: 110, kind: "bet", provider: "Polymarket", title: "bet" },
      { id: 3, createAt: 120, kind: "makeup_queue", provider: null, title: "补单入队" },
      { id: 4, createAt: 200, kind: "check", provider: "RAY", title: "check" },
    ]);
    expect(segments.map(segment => segment.logs.map(log => log.kind))).toEqual([
      ["check", "bet"],
      ["makeup_queue"],
      ["check"],
    ]);
  });

  it("summarizeUserLog exposes structured post-accept reject timing", () => {
    const log = summarizeUserLog({
      id: 7,
      create_at: 31_000,
      title: "[RAY](雷竞技,6) 拒单检测 => 确认拒单",
      data: JSON.stringify({
        diagnosticVersion: 2,
        orderId: "ray-1",
        target: "Away",
        match: "A vs B",
        bet: "map1 获胜者",
        odds: 1.94,
        betMoney: 300,
        placedAt: 1_000,
        observedAt: 31_000,
        rejectDelayMs: 30_000,
        settlement: "unfilled",
        observedStatus: "reject",
        rejectReason: "场馆取消",
      }),
    });

    expect(log.kind).toBe("reject");
    expect(log.orderId).toBe("ray-1");
    expect(log.rejectDelayMs).toBe(30_000);
    expect(log.settlement).toBe("unfilled");
    expect(log.summary).toContain("确认拒单");
    expect(log.summary).toContain("间隔30秒");
    expect(log.summary).toContain("场馆取消");
  });

  it("keeps interleaved bet results with their own provider check", () => {
    const orders = [
      {
        orderId: "ray-order",
        provider: "RAY",
        match: "Apogee Esports vs ASTRAL",
        bet: "map2 获胜者",
        item: "ASTRAL",
        odds: 1.94,
        betMoney: 300,
        createAt: 1_000,
      },
    ];
    const logs = [
      {
        id: 1,
        kind: "check",
        provider: "Polymarket",
        accountLabel: "Polymarket · polymarket / pm1",
        target: "Home",
        match: "Apogee Esports vs ASTRAL",
        bet: "map2 获胜者",
        createAt: 900,
        summary: "Polymarket 预检 Home@2.272",
      },
      {
        id: 2,
        kind: "check",
        provider: "RAY",
        accountLabel: "RAY · 雷竞技 / ray1",
        target: "Away",
        match: "Apogee Esports vs ASTRAL",
        bet: "map2 获胜者",
        odds: 1.94,
        betMoney: 300,
        createAt: 1_000,
        summary: "RAY 预检 Away@1.94",
      },
      {
        id: 3,
        kind: "bet",
        provider: "RAY",
        accountLabel: "RAY · 雷竞技 / ray1",
        success: true,
        createAt: 1_100,
        summary: "RAY 下注成功",
      },
      {
        id: 4,
        kind: "bet",
        provider: "Polymarket",
        accountLabel: "Polymarket · polymarket / pm1",
        success: false,
        createAt: 1_200,
        summary: "Polymarket FOK 深度不足",
      },
    ];

    const filtered = filterRelevantLogs(orders, logs);
    expect(filtered.relevant.map(l => l.id)).toEqual([1, 2, 3, 4]);
    expect(filtered.relevant.find(l => l.id === 1)?.matchedOrderId).toBeNull();
    expect(filtered.relevant.find(l => l.id === 4)?.matchedOrderId).toBeNull();
    expect(filtered.relevant.find(l => l.id === 3)?.matchedOrderId).toBe("ray-order");
  });

  it("keeps the full 758786-style chain when venue team aliases differ", () => {
    const link = 1_790_274_758_786;
    const orders = [{
      orderId: "pm-filled",
      link,
      provider: "Polymarket",
      match: "Counter-Strike: Phantom vs Iberian Soul",
      bet: "Map 1 Winner",
      item: "Phantom",
      createAt: 1_000,
    }];
    const logs = [
      { id: 1, kind: "check", provider: "RAY", target: "Away", match: "Phantom Esports vs Gentle Mates", bet: "Map 1 Winner", createAt: 900, summary: "RAY 初始预检" },
      { id: 2, kind: "check", provider: "Polymarket", target: "Home", match: "Phantom Esports vs Gentle Mates", bet: "Map 1 Winner", createAt: 950, summary: "PM 初始预检" },
      { id: 3, kind: "bet", provider: "Polymarket", orderId: "pm-filled", success: true, createAt: 1_100, summary: "PM 成交" },
      { id: 4, kind: "bet", provider: "RAY", success: false, createAt: 1_150, summary: "RAY 封盘" },
      { id: 5, kind: "check", provider: "RAY", target: "Away", match: "Phantom Esports vs Gentle Mates", bet: "Map 1 Winner", checkError: "已封盘", createAt: 1_250, summary: "RAY 即时重试" },
      { id: 6, kind: "reject", provider: "Polymarket", linkId: link, orderId: "pm-filled", settlement: "filled", createAt: 12_000, summary: "PM 最终成交" },
    ];

    const filtered = filterRelevantLogs(orders, logs);
    expect(filtered.relevant.map(log => log.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(filtered.relevant.find(log => log.id === 1)?.matchedOrderId).toBeNull();
    expect(filtered.relevant.find(log => log.id === 4)?.matchedOrderId).toBeNull();
    expect(filtered.relevant.find(log => log.id === 3)?.matchedOrderId).toBe("pm-filled");
  });

  it("does not mix an earlier arb round from the same match into the current plan", () => {
    const orders = [{
      orderId: "current",
      link: 1_790_266_881_397,
      provider: "Polymarket",
      match: "Turma do Pagode vs Keyd Stars",
      bet: "全场胜负",
      item: "Turma do Pagode",
      odds: 2.272,
      betMoney: 62.76,
      createAt: 200_000,
    }];
    const logs = [
      { id: 1, kind: "check", provider: "Polymarket", target: "Home", match: "Turma do Pagode vs Keyd Stars", bet: "全场胜负", odds: 2.222, betMoney: 9.78, createAt: 20_000, summary: "较早的另一轮" },
      { id: 2, kind: "check", provider: "Polymarket", target: "Home", match: "Turma do Pagode vs Keyd Stars", bet: "全场胜负", odds: 2.272, betMoney: 9.06, createAt: 199_000, summary: "当前轮" },
      { id: 3, kind: "bet", provider: "Polymarket", orderId: "current", success: true, createAt: 200_100, summary: "当前轮成交" },
    ];

    const filtered = filterRelevantLogs(orders, logs);
    expect(filtered.relevant.map(log => log.id)).toEqual([2, 3]);
    expect(filtered.unrelated.map(log => log.id)).toEqual([1]);
  });

  it("treats an explicit different linkId as definitive even for the same match and time", () => {
    const currentLink = 1_790_266_881_397;
    const otherLink = 1_790_266_881_398;
    const orders = [{
      orderId: "current",
      link: currentLink,
      provider: "Polymarket",
      match: "Turma do Pagode vs Keyd Stars",
      bet: "全场胜负",
      createAt: 200_000,
    }];
    const logs = [
      { id: 1, kind: "check", linkId: otherLink, provider: "Polymarket", match: "Turma do Pagode vs Keyd Stars", bet: "全场胜负", createAt: 199_900, summary: "另一 Link" },
      { id: 2, kind: "check", linkId: currentLink, provider: "Polymarket", match: "Turma do Pagode vs Keyd Stars", bet: "全场胜负", createAt: 199_950, summary: "当前 Link" },
    ];

    const filtered = filterRelevantLogs(orders, logs);
    expect(filtered.relevant.map(log => log.id)).toEqual([2]);
    expect(filtered.unrelated.map(log => log.id)).toEqual([1]);
  });

  it("summarizes a makeup queue as an independent Link step", () => {
    const link = 1_790_274_758_786;
    const log = summarizeUserLog({
      id: 7,
      create_at: 2_000,
      title: "补单入队",
      data: JSON.stringify({
        linkId: link,
        attemptType: "makeup_queue",
        target: "Away",
        match: "Phantom Esports vs Gentle Mates",
        bet: "Map 1 Winner",
        betMoney: 140,
        odds: 2.702,
        failedLegOdds: 1.76,
        failedPlatformLabel: "RAY",
      }),
    });
    expect(log.kind).toBe("makeup_queue");
    expect(log.linkId).toBe(link);
    expect(log.failedLegOdds).toBe(1.76);

    const filtered = filterRelevantLogs([
      { orderId: "pm-filled", link, provider: "Polymarket", createAt: 1_000 },
    ], [log]);
    expect(filtered.relevant[0]?.matchedOrderId).toBeNull();
  });

  it("summarizes a canceled makeup queue as an independent Link step", () => {
    const link = 1_790_274_758_786;
    const log = summarizeUserLog({
      id: 8,
      create_at: 2_100,
      title: "补单取消",
      data: JSON.stringify({
        linkId: link,
        betId: 99,
        attemptType: "makeup_cancel",
        target: "Away",
        match: "Phantom Esports vs Gentle Mates",
        bet: "Map 1 Winner",
        failedPlatformLabel: "Polymarket",
        reason: "RAY Home 确认拒单，已无有效成交锚点",
        observedAt: 2_100,
      }),
    });
    expect(log.kind).toBe("makeup_cancel");
    expect(log.linkId).toBe(link);
    expect(log.target).toBe("Away");
    expect(log.message).toContain("确认拒单");
    expect(buildLogSegments([log])).toHaveLength(1);

    const filtered = filterRelevantLogs([
      { orderId: "ray-reject", link, provider: "RAY", createAt: 1_000 },
    ], [log]);
    expect(filtered.relevant[0]?.matchedOrderId).toBeNull();
  });

  it("buildPlatformSections groups orders and logs by provider", () => {
    const orders = [
      { orderId: "o1", provider: "OB", createAt: 100 },
      { orderId: "o2", provider: "RAY", createAt: 200 },
    ];
    const logs = [
      { provider: "OB", createAt: 50, kind: "check", summary: "ob check" },
      { provider: "RAY", createAt: 60, kind: "bet", summary: "ray bet" },
      { provider: "RAY", createAt: 70, kind: "bet", summary: "ray retry" },
    ];
    const sections = buildPlatformSections(orders, logs);
    expect(sections).toHaveLength(2);
    expect(sections[0].label).toBe("OB");
    expect(sections[0].orders).toHaveLength(1);
    expect(sections[0].logs).toHaveLength(1);
    expect(sections[1].label).toBe("RAY");
    expect(sections[1].logs.map(l => l.createAt)).toEqual([60, 70]);
  });

  it("extractLogProvider reads bracket title", () => {
    expect(extractLogProvider("[PB] - x 拒单", null, "reject")).toBe("PB");
  });

  it("buildOrderSections groups logs per order and orphan attempts", () => {
    const orders = [
      { orderId: "o-ob", provider: "OB", createAt: 100, status: "Win" },
    ];
    const logs = [
      { provider: "OB", createAt: 50, kind: "check", summary: "ob check" },
      { provider: "OB", orderId: "o-ob", createAt: 90, kind: "bet", summary: "ob bet" },
      { provider: "RAY", createAt: 60, kind: "bet", summary: "ray fail" },
      { provider: "RAY", createAt: 70, kind: "bet", summary: "ray retry" },
    ];
    const sections = buildOrderSections(orders, logs);
    expect(sections).toHaveLength(2);
    expect(sections[0].order?.orderId).toBe("o-ob");
    expect(sections[0].logs).toHaveLength(2);
    expect(sections[1].order).toBeNull();
    expect(sections[1].label).toContain("RAY");
    expect(sections[1].logs).toHaveLength(2);
  });

  it("extractLogOrderId reads bet result and reject title", () => {
    expect(
      extractLogOrderId(
        "[OB] 下注 => true",
        { result: { orderId: "abc123" } },
        "bet",
      ),
    ).toBe("abc123");
    expect(extractLogOrderId("[PB] - oid9 拒单检测 => x", null, "reject")).toBe("oid9");
  });

  it("buildLegSections groups arb by home/away with retry attempts", () => {
    const orders = [
      { orderId: "o-ob", provider: "OB", createAt: 100, status: "Win", link: 1_000_000_000_001 },
      { orderId: "o-ray1", provider: "RAY", createAt: 200, status: "Reject", link: 1_000_000_000_001 },
      { orderId: "o-ray2", provider: "RAY", createAt: 400, status: "Win", link: 1_000_000_000_001 },
    ];
    const logs = [
      { provider: "OB", target: "Home", orderId: "o-ob", createAt: 90, kind: "bet", summary: "ob" },
      {
        provider: "RAY",
        target: "Away",
        orderId: "o-ray1",
        createAt: 180,
        kind: "bet",
        summary: "ray1",
      },
      { provider: "RAY", target: "Away", createAt: 250, kind: "reject", summary: "拒单" },
      { provider: "RAY", target: "Away", orderId: "o-ray2", createAt: 380, kind: "bet", summary: "ray2" },
    ];
    const legs = buildLegSections(orders, logs, { linkType: "套利", groupLabel: "套利 3 笔" });
    expect(legs).toHaveLength(2);
    expect(legs[0].side).toBe("Home");
    expect(legs[0].label).toBe("主队");
    expect(legs[0].attempts).toHaveLength(1);
    expect(legs[1].side).toBe("Away");
    expect(legs[1].label).toBe("客队");
    expect(legs[1].attempts).toHaveLength(2);
    expect(legs[1].attempts[0].order?.orderId).toBe("o-ray1");
    expect(legs[1].attempts[1].order?.orderId).toBe("o-ray2");
    expect(legs[0].attempts[0].logSegments?.length).toBeGreaterThan(0);
  });

  it("keeps a failed cross-provider attempt separate and assigns order side from matching provider", () => {
    const link = 1_790_251_410_568;
    const orders = [
      {
        orderId: "ray-away",
        provider: "RAY",
        item: "ASTRAL",
        odds: 1.94,
        betMoney: 300,
        createAt: 1_000,
        status: "Reject",
        link,
      },
      {
        orderId: "ray-home-makeup",
        provider: "RAY",
        item: "Apogee Esports",
        odds: 1.86,
        betMoney: 313,
        createAt: 38_000,
        status: "Lose",
        link,
      },
    ];
    const logs = [
      {
        id: 1,
        provider: "Polymarket",
        target: "Home",
        createAt: 900,
        kind: "check",
        summary: "PM Home@2.272",
      },
      {
        id: 2,
        provider: "Polymarket",
        createAt: 1_200,
        kind: "bet",
        success: false,
        message: "FOK 深度不足",
        summary: "PM 下注失败",
      },
      {
        id: 3,
        provider: "RAY",
        target: "Away",
        matchedOrderId: "ray-away",
        createAt: 1_000,
        kind: "check",
        summary: "RAY Away@1.94",
      },
      {
        id: 4,
        provider: "RAY",
        target: "Home",
        matchedOrderId: "ray-home-makeup",
        loseOrder: true,
        createAt: 38_000,
        kind: "check",
        summary: "RAY Home@1.86",
      },
    ];

    const legs = buildLegSections(orders, logs, { linkType: "套利", groupLabel: "套利 2 笔" });
    const home = legs.find(l => l.side === "Home");
    const away = legs.find(l => l.side === "Away");
    expect(home.attempts).toHaveLength(2);
    expect(home.attempts[0].order).toBeNull();
    expect(home.attempts[0].logs.map(l => l.id)).toEqual([1, 2]);
    expect(home.attempts[1].order?.orderId).toBe("ray-home-makeup");
    expect(away.attempts).toHaveLength(1);
    expect(away.attempts[0].order?.orderId).toBe("ray-away");
    expect(away.attempts[0].logs.map(l => l.id)).toEqual([3]);
  });

  it("extractLogTarget reads check options", () => {
    expect(
      extractLogTarget({ options: { target: "Away" } }, "check", ""),
    ).toBe("Away");
    expect(extractLogTarget(null, "bet", "RAY 预检 xxx Away@2.1 金额100")).toBe("Away");
  });

  it("extractLogAccountLabel parses title bracket", () => {
    const acct = extractLogAccountLabel("[OB](星空,4) 请求盘口数据 => true");
    expect(acct?.label).toBe("OB · 星空 / 4");
    expect(acct?.provider).toBe("OB");
  });

  it("buildLogSegments splits on each check (makeup rounds)", () => {
    const logs = [
      {
        id: 1,
        kind: "check",
        createAt: 100,
        title: "[OB](星空,4) 请求盘口",
        provider: "OB",
        loseOrder: true,
        accountLabel: "OB · 星空 / 4",
      },
      { id: 2, kind: "bet", createAt: 110, title: "[OB](星空,4) 下注 => false", provider: "OB" },
      {
        id: 3,
        kind: "check",
        createAt: 200,
        title: "[OB](开云,1) 请求盘口",
        provider: "OB",
        loseOrder: true,
        accountLabel: "OB · 开云 / 1",
      },
      { id: 4, kind: "bet", createAt: 210, title: "[OB](开云,1) 下注 => true", provider: "OB" },
    ];
    const segs = buildLogSegments(logs);
    expect(segs).toHaveLength(2);
    expect(segs[0].accountLabel).toContain("星空");
    expect(segs[0].isMakeUp).toBe(true);
    expect(segs[0].logs).toHaveLength(2);
    expect(segs[1].accountLabel).toContain("开云");
    expect(segs[1].logs).toHaveLength(2);
  });

  it("toAdminOrderLogPayload strips logsRaw and includes legSections", () => {
    const payload = toAdminOrderLogPayload({
      ok: true,
      user: { id: "u1", userName: "gb12" },
      anchor: { type: "link", value: 1 },
      link: 1,
      linkType: "套利",
      groupLabel: "套利 2 笔",
      logWindow: { fromMs: 1, toMs: 2 },
      orders: [
        { orderId: "1", provider: "OB", createAt: 1, link: 1_000_000_000_001 },
        { orderId: "2", provider: "RAY", createAt: 2, link: 1_000_000_000_001 },
      ],
      logs: [{ provider: "OB", target: "Home", createAt: 1, kind: "check", summary: "Home@2" }],
      logsRaw: [{ id: 9 }],
    });
    expect(payload.ok).toBe(true);
    expect(payload.logsRaw).toBeUndefined();
    expect(payload.legSections).toHaveLength(2);
    expect(payload.legSections[0].label).toBe("主队");
  });
});
