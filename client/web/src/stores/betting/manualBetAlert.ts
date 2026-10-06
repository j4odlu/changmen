import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { toFixed } from "@changmen/client-core/shared/format";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 多行场馆错误（PM 诊断、盘口对比等） */
function formatStructuredBetAlertInner(message: string): string {
  const lines = message.split(/\r?\n/);
  return lines.map((line, index) => {
    const text = escapeHtml(line);
    if (!line.trim())
      return `<div class="poly-bet-alert__gap"></div>`;
    if (index === 0)
      return `<div class="poly-bet-alert__reason">${text}</div>`;
    if (/^【.+】$/.test(line))
      return `<div class="poly-bet-alert__section">${text}</div>`;
    if (/^\d+\.\s/.test(line))
      return `<div class="poly-bet-alert__ask">${text}</div>`;
    if (line.includes("tokenId"))
      return `<div class="poly-bet-alert__row poly-bet-alert__mono">${text}</div>`;
    return `<div class="poly-bet-alert__row">${text}</div>`;
  }).join("");
}

export function formatStructuredBetAlertHtml(message: string): string {
  return `<div class="poly-bet-alert">${formatStructuredBetAlertInner(message)}</div>`;
}

export function buildManualBetContextLines(
  match: ViewMatch,
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  odds: number,
  amount?: number,
): string[] {
  const team = side === "Home" ? bet.homeName : bet.awayName;
  const oddsText = odds > 0 ? toFixed(odds, 3) : "—";
  const lines = [
    match.title,
    `盘口：${bet.getBetName()}`,
    `平台：${item.type}`,
    `选项：${team} @ ${oddsText}`,
  ];
  if (amount !== undefined && Number.isFinite(amount) && amount > 0)
    lines.push(`金额：${amount}`);
  return lines;
}

function diagnosticNumber(reason: string, pattern: string): number | undefined {
  const match = reason.match(new RegExp(pattern));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

function comparisonRow(label: string, expected: string, actual: string, verdict: string, problem = false): string {
  return `<tr${problem ? ' class="manual-bet-compare__problem"' : ""}><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(expected)}</td><td>${escapeHtml(actual)}</td><td><span class="manual-bet-compare__verdict">${escapeHtml(verdict)}</span></td></tr>`;
}

export function buildManualBetCheckFailureHtml(
  match: ViewMatch,
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  odds: number,
  amount: number,
  checkError: string | undefined,
  stage: "check" | "order" = "check",
): string {
  const reason = String(checkError ?? "").trim() || "场馆未返回可用盘口，请稍后重试";
  // [changmen 扩展] 仅从场馆已返回的诊断提取数值，缺失信息不推定成交或价格。
  const number = "([\\d.]+)";
  const currency = reason.match(/(?:金额：|需要\s*)[\d.]+\s+(USDC|USDT)/)?.[1];
  const stake = diagnosticNumber(reason, `金额：\\s*${number}\\s+(?:USDC|USDT)`)
    ?? diagnosticNumber(reason, `金额\\s+${number}\\s*×`);
  const required = diagnosticNumber(reason, `需要\\s+${number}\\s+(?:USDC|USDT)`) ?? stake;
  // 深度垫使用成交价及更优档位，优先于原始盘口汇总。
  const available = diagnosticNumber(reason, `(?:及更优|限价内)可立即成交约\\s*${number}`)
    ?? diagnosticNumber(reason, `可立即成交：\\s*${number}`);
  const bookOdds = diagnosticNumber(reason, `最佳卖价：[^\\n]*?赔率\\s+${number}`);
  const shortfall = required !== undefined && available !== undefined ? Math.max(0, required - available) : undefined;
  const liquidity = /盘口深度不足|无 asks 卖单|盘口无卖单/.test(reason);
  const money = (value: number) => `${value.toFixed(2)} ${currency ?? "场馆币种"}`;
  const rows = [
    comparisonRow("输入金额", `${amount}（输入金额）`, stake !== undefined ? money(stake) : "未返回换算金额", stake !== undefined ? "币种换算" : "待核对"),
    comparisonRow("赔率", `≥ ${toFixed(odds, 3)}`, bookOdds !== undefined ? toFixed(bookOdds, 4) : "未返回盘口赔率", bookOdds !== undefined ? (bookOdds + 0.0001 >= odds ? "满足下限" : "低于下限") : "待核对", bookOdds !== undefined && bookOdds + 0.0001 < odds),
    comparisonRow("可成交深度", required !== undefined ? `需要 ≥ ${money(required)}` : "满足整笔订单 / 深度垫要求", available !== undefined ? money(available) : "未返回可成交金额", shortfall !== undefined ? (shortfall > 0 ? `缺 ${money(shortfall)}` : "深度充足") : "待核对", shortfall !== undefined && shortfall > 0),
    comparisonRow("订单状态", "提交并确认成交", stage === "check" ? "预检未通过 · 尚未提交" : "下单未成功 · 请核对场馆订单", stage === "check" ? "阻断于预检" : "下单阶段失败", true),
  ].join("");
  const headline = reason.split(/\r?\n/)[0] ?? reason;
  const explanation = liquidity && shortfall !== undefined && shortfall > 0
    ? `当前可成交 ${money(available!)}，要求 ${money(required!)}，缺少 ${money(shortfall)}。`
    : stage === "check" ? "当前订单未通过场馆预检，尚未提交。" : "场馆未返回成功结果，请结合原始诊断核对。";
  const advice = liquidity
    ? "FOK 要求整笔立即成交。可减小金额或等待深度恢复；开启深度垫时，还需满足倍数要求。"
    : "核对下方差异与场馆诊断后，再决定是否重新下单。";
  const asks = reason.split(/\r?\n/).filter(line => /^\s*\d+\.\s/.test(line));
  const book = asks.length ? `<details class="manual-bet-compare__details"><summary>盘口档位 · ${asks.length} 档</summary><pre>${escapeHtml(asks.join("\n"))}</pre></details>` : "";
  return `<div class="manual-bet-compare">
    <div class="manual-bet-compare__context"><span class="manual-bet-compare__platform">${escapeHtml(String(item.type))}</span><strong>${escapeHtml(match.title)}</strong><div>${escapeHtml(bet.getBetName())} · ${escapeHtml(side === "Home" ? bet.homeName : bet.awayName)} @ ${toFixed(odds, 3)}</div></div>
    <div class="manual-bet-compare__failure"><span>${stage === "check" ? "预检失败" : "下单失败"}</span><strong>${escapeHtml(headline)}</strong><p>${escapeHtml(explanation)}</p></div>
    <div class="manual-bet-compare__table"><table><caption>下单与结果对比</caption><thead><tr><th scope="col">核对项</th><th scope="col">下单预期</th><th scope="col">场馆反馈</th><th scope="col">差异 / 结论</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="manual-bet-compare__note">${escapeHtml(advice)}</p>${book}
    <details class="manual-bet-compare__details"><summary>原始诊断 · 含订单标识</summary><pre>${escapeHtml(reason)}</pre></details>
  </div>`;
}

export function buildManualBetOrderFailureHtml(message: string): string {
  return formatStructuredBetAlertHtml(message);
}
