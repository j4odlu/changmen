import type { ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { describe, expect, it } from "vitest";
import { buildManualBetCheckFailureHtml } from "@/stores/betting/manualBetAlert";
import { buildManualBetPromptMessage, defaultManualBetAmount } from "@/stores/betting/manualBet";

describe("defaultManualBetAmount", () => {
  it("prefers valueBetMoney over betMoney", () => {
    expect(defaultManualBetAmount({ valueBetMoney: 80, betMoney: 100 })).toBe(80);
  });

  it("falls back to betMoney when valueBetMoney is 0", () => {
    expect(defaultManualBetAmount({ valueBetMoney: 0, betMoney: 50 })).toBe(50);
  });
});

describe("buildManualBetPromptMessage", () => {
  it("uses bet.getBetName for market label (A8 parity)", () => {
    const match = { title: "A vs B", bets: [] } as unknown as ViewMatch;
    const bet = {
      round: 3,
      name: "[地图3]-单局-获胜",
      homeName: "A",
      awayName: "B",
      getBetName: () => "[地图3] 获胜",
      items: [],
    } as unknown as ViewBet;
    const item = { type: "RAY" } as unknown as ViewBetItem;
    const msg = buildManualBetPromptMessage(match, bet, item, "Home", 1.61);
    expect(msg).toContain("盘口：[地图3] 获胜");
    expect(msg).not.toContain("[地图3]-单局-获胜");
  });
});

describe("buildManualBetCheckFailureHtml", () => {
  const match = { title: "G2 Esports vs TES", bets: [] } as unknown as ViewMatch;
  const bet = {
    homeName: "G2",
    awayName: "TES",
    getBetName: () => "[地图2] 获胜",
    items: [],
  } as unknown as ViewBet;
  const item = { type: "Polymarket" } as unknown as ViewBetItem;

  it("includes match context and reason", () => {
    const html = buildManualBetCheckFailureHtml(
      match,
      bet,
      item,
      "Away",
      1.667,
      14,
      "盘口价高于检测价",
    );
    expect(html).toContain("G2 Esports vs TES");
    expect(html).toContain("Polymarket");
    expect(html).toContain("TES @ 1.667");
    expect(html).toContain("14（输入金额）");
    expect(html).toContain("盘口价高于检测价");
    expect(html).toContain("下单与结果对比");
    expect(html).toContain("尚未提交");
  });

  it("uses fallback reason when checkError empty", () => {
    const html = buildManualBetCheckFailureHtml(match, bet, item, "Away", 1.667, 14, "");
    expect(html).toContain("场馆未返回可用盘口");
  });

  it("compares converted stake with available depth without mixing input currency", () => {
    const html = buildManualBetCheckFailureHtml(match, bet, item, "Away", 1.47, 100,
      "Polymarket FOK 盘口深度不足\n【订单】\n- 金额：14.93 USDC\n【盘口】\n- 最佳卖价：0.68（赔率 1.4706），数量 15.13\n- 可立即成交：10.29 USDC\n1. 0.68 x 15.13 = 10.29 USDC");
    expect(html).toContain("100（输入金额）");
    expect(html).toContain("缺 4.64 USDC");
    expect(html).toContain("满足下限");
    expect(html).toContain("盘口档位 · 1 档");
    expect(html).not.toContain("缺 89.71");
  });

  it("uses buffer requirement and depth at fill price ahead of total book depth", () => {
    const html = buildManualBetCheckFailureHtml(match, bet, item, "Away", 2, 100,
      "Polymarket FOK 盘口深度不足\n- 需要 29.86 USDC（金额 14.93 × 2）\n- 成交价 0.5000 及更优可立即成交约 20.00 USDC\n- 可立即成交：60.00 USDC");
    expect(html).toContain("缺 9.86 USDC");
    expect(html).toContain("需要 ≥ 29.86 USDC");
    expect(html).toContain("14.93 USDC");
  });

  it("preserves unknown results and escapes venue diagnostics", () => {
    const html = buildManualBetCheckFailureHtml(match, bet, item, "Away", 1.667, 14,
      '<img src=x onerror="alert(1)">\n- tokenId：<script>x</script>', "order");
    expect(html).toContain("未返回盘口赔率");
    expect(html).toContain("下单阶段失败");
    expect(html).not.toContain("尚未提交");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("supports PredictFun limit-depth diagnostics", () => {
    const html = buildManualBetCheckFailureHtml(match, bet, { type: "PredictFun" } as ViewBetItem, "Away", 2, 100,
      "Predict.fun FOK 盘口深度不足\n- 需要 14.93 USDT，限价内可立即成交约 8.50 USDT");
    expect(html).toContain("缺 6.43 USDT");
    expect(html).toContain("未返回换算金额");
  });
});
