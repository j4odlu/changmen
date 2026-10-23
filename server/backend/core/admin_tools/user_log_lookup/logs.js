export function parseLogData(raw) {
  if (raw == null || raw === "")
    return null;
  if (typeof raw === "object")
    return raw;
  try {
    return JSON.parse(String(raw));
  }
  catch {
    return { raw: String(raw) };
  }
}

export function classifyLogTitle(title) {
  const t = String(title || "");
  if (t.includes("请求盘口数据"))
    return "check";
  if (t.includes("下注 =>"))
    return "bet";
  if (t.includes("拒单"))
    return "reject";
  if (t.includes("补单入队"))
    return "makeup_queue";
  if (t.includes("补单取消"))
    return "makeup_cancel";
  return "other";
}

/** 从 title / data 推断平台（如 [RAY](...)） */
export function extractLogProvider(title, parsed, kind) {
  const bracket = String(title || "").match(/^\[([^\]]+)\]/);
  if (bracket?.[1])
    return bracket[1];
  if (kind === "check" && parsed?.options?.type)
    return String(parsed.options.type);
  if (kind === "bet" && parsed?.result?.provider)
    return String(parsed.result.provider);
  if (parsed?.provider)
    return String(parsed.provider);
  return null;
}

/** 从日志推断关联 order_id（下注结果 / PB 拒单轮询） */
export function extractLogOrderId(title, parsed, kind) {
  if (kind === "bet" && parsed?.result?.orderId) {
    return String(parsed.result.orderId);
  }
  if (kind === "reject") {
    if (parsed?.orderId)
      return String(parsed.orderId);
    const m = String(title || "").match(/-\s*(\S+)\s+拒单/);
    if (m?.[1])
      return m[1];
  }
  return null;
}

/** 从预检日志 / 摘要解析 Home|Away */
export function extractLogTarget(parsed, kind, summary) {
  if (kind === "check" && parsed?.options?.target) {
    const t = String(parsed.options.target);
    if (t === "Home" || t === "Away")
      return t;
  }
  const m = String(summary || "").match(/\s(Home|Away)@/);
  return m?.[1] || null;
}

function parseObRequestLine(request) {
  if (!request || typeof request !== "object")
    return {};
  const line = Object.keys(request)
    .filter(k => /^b\[\d+\]$/.test(k))
    .map(k => request[k])
    .find(Boolean);
  if (!line)
    return {};
  const params = new URLSearchParams(String(line));
  const odds = Number(params.get("odd")) || undefined;
  const betMoney = Number(params.get("a")) || undefined;
  const itemId = params.get("oid") || undefined;
  return { odds, betMoney, itemId };
}

/** 从 Client_SaveUserLog title 解析账号展示，如 [OB](星空,4) → OB · 星空 / 4 */
export function extractLogAccountLabel(title) {
  const m = String(title || "").match(/^\[([^\]]+)\]\(([^,]+),([^)]+)\)/);
  if (!m)
    return null;
  const provider = m[1];
  const platformName = String(m[2]).trim();
  const playerName = String(m[3]).trim();
  return {
    provider,
    platformName,
    playerName,
    label: `${provider} · ${platformName} / ${playerName}`,
  };
}

/**
 * 按预检日志切分轮次（对齐 A8 主循环：每轮 1 次 check + 下注尝试）
 */
export function buildLogSegments(logs) {
  const sorted = [...(logs || [])].sort((a, b) => a.createAt - b.createAt);
  if (!sorted.length)
    return [];

  const segments = [];
  let current = null;

  const flush = () => {
    if (current?.logs?.length) {
      segments.push(current);
      current = null;
    }
  };

  for (const log of sorted) {
    // 入队是独立的编排事件，不能并入前一条“预检 → 下单”尝试；否则前一腿
    // 的真实失败会被前端误标为“仅入队”，诊断汇总也会漏算下单失败。
    if (log.kind === "makeup_queue" || log.kind === "makeup_cancel") {
      flush();
      current = {
        key: `seg-${log.id ?? log.createAt}`,
        accountLabel: null,
        provider: null,
        isMakeUp: false,
        logs: [log],
      };
      flush();
    }
    else if (log.kind === "check") {
      flush();
      const parsed = extractLogAccountLabel(log.title);
      current = {
        key: `seg-${log.id ?? log.createAt}`,
        accountLabel: log.accountLabel || parsed?.label || null,
        provider: log.provider || parsed?.provider || null,
        isMakeUp: Boolean(log.loseOrder),
        logs: [log],
      };
    }
    else if (current) {
      current.logs.push(log);
    }
    else {
      flush();
      const parsed = extractLogAccountLabel(log.title);
      current = {
        key: `seg-${log.id ?? log.createAt}`,
        accountLabel: log.accountLabel || parsed?.label || null,
        provider: log.provider || parsed?.provider || null,
        isMakeUp: Boolean(log.loseOrder),
        logs: [log],
      };
    }
  }
  flush();
  return segments;
}

/** 从 saveUserLog 行提取可读摘要 */
export function summarizeUserLog(row) {
  const title = String(row?.title || "");
  const kind = classifyLogTitle(title);
  const parsed = parseLogData(row?.data);
  const provider = extractLogProvider(title, parsed, kind);
  const orderId = extractLogOrderId(title, parsed, kind);
  const target = extractLogTarget(parsed, kind, title);
  const acct = extractLogAccountLabel(title);
  const out = {
    id: row?.id,
    createAt: Number(row?.create_at) || 0,
    title,
    kind,
    provider,
    orderId: orderId || null,
    target: target || null,
    accountLabel: null,
    loseOrder: false,
    match: null,
    bet: null,
    item: null,
    odds: null,
    newOdds: null,
    betMoney: null,
    planBetMoney: null,
    stakeExchange: null,
    stakeRate: null,
    stakeCurrency: null,
    itemId: null,
    matchId: null,
    betId: null,
    success: null,
    message: null,
    checkError: null,
    requestAmount: null,
    requestOdds: null,
    related: true,
    relationScore: 0,
    relationReason: "",
    matchedOrderId: null,
    linkId: null,
    attemptType: null,
    failedLegOdds: null,
    failedPlatformLabel: null,
    placedAt: null,
    observedAt: null,
    rejectDelayMs: null,
    settlement: null,
    observedStatus: null,
    rejectReason: null,
    summary: title,
  };

  if (acct)
    out.accountLabel = acct.label;

  if (kind === "check" && parsed?.options) {
    const o = parsed.options;
    out.linkId = Number(o.linkId) || null;
    out.attemptType = o.attemptType || null;
    out.target = out.target || (o.target === "Home" || o.target === "Away" ? o.target : null);
    out.loseOrder = Boolean(o.loseOrder);
    out.match = o.match || null;
    out.bet = o.bet || null;
    out.odds = Number(o.odds) || null;
    out.newOdds = Number(o.newOdds) || null;
    out.betMoney = Number(o.betMoney) || null;
    out.planBetMoney = Number(o.planBetMoney) || null;
    out.stakeExchange = Number(o.stakeExchange) || null;
    out.stakeRate = Number(o.stakeRate) || null;
    out.stakeCurrency = o.stakeCurrency || null;
    out.itemId = o.itemId || null;
    out.matchId = o.matchId || null;
    out.betId = o.betId || null;
    out.checkError = parsed.checkError || null;
    const req = parseObRequestLine(parsed.data);
    out.requestAmount = req.betMoney ?? null;
    out.requestOdds = req.odds ?? null;
    if (req.itemId)
      out.itemId = out.itemId || req.itemId;
    out.summary = `${o.type} 预检 ${o.match || ""} ${o.bet || ""} ${o.target}@${o.odds} 金额${o.betMoney}`;
    if (parsed.checkError)
      out.summary += ` · ${parsed.checkError}`;
    else if (parsed.response?.data)
      out.summary += ` · ${parsed.response.data}`;
  }
  else if (kind === "bet" && parsed?.result) {
    const r = parsed.result;
    out.linkId = Number(r.link) || null;
    out.attemptType = r.diagnosticAttempt || null;
    const req = parseObRequestLine(r.request);
    out.success = Boolean(r.success);
    out.message = r.message || null;
    out.requestAmount = req.betMoney ?? null;
    out.requestOdds = req.odds ?? null;
    out.betMoney = req.betMoney ?? null;
    out.odds = req.odds ?? null;
    out.itemId = req.itemId ?? null;
    out.summary = [
      `${r.provider} 下注 ${r.success ? "成功" : "失败"}`,
      req.odds ? `赔率${req.odds}` : "",
      req.betMoney ? `金额${req.betMoney}` : "",
      r.message || "",
    ].filter(Boolean).join(" · ");
  }
  else if (kind === "reject") {
    out.linkId = Number(parsed?.linkId) || null;
    out.attemptType = parsed?.attemptType || null;
    out.message = parsed?.rejectReason || title;
    out.target = parsed?.target === "Home" || parsed?.target === "Away"
      ? parsed.target
      : out.target;
    out.match = parsed?.match || null;
    out.bet = parsed?.bet || null;
    out.odds = Number(parsed?.odds) || null;
    out.betMoney = Number(parsed?.betMoney) || null;
    out.loseOrder = Boolean(parsed?.loseOrder);
    out.placedAt = Number(parsed?.placedAt) || null;
    out.observedAt = Number(parsed?.observedAt) || null;
    out.rejectDelayMs = Number(parsed?.rejectDelayMs) || null;
    out.settlement = parsed?.settlement || null;
    out.observedStatus = parsed?.observedStatus || null;
    out.rejectReason = parsed?.rejectReason || null;
    if (parsed?.diagnosticVersion) {
      const state = parsed.settlement === "unfilled"
        ? "确认拒单"
        : parsed.settlement === "timeout"
          ? "仍待确认"
          : "确认成交";
      out.summary = `${provider || "场馆"} 拒单检测 · ${state}`;
      if (out.rejectDelayMs)
        out.summary += ` · 间隔${Math.round(out.rejectDelayMs / 100) / 10}秒`;
      if (out.rejectReason)
        out.summary += ` · ${out.rejectReason}`;
    }
  }
  else if (kind === "makeup_queue") {
    out.linkId = Number(parsed?.linkId) || null;
    out.attemptType = "makeup_queue";
    out.target = parsed?.target === "Home" || parsed?.target === "Away"
      ? parsed.target
      : null;
    out.match = parsed?.match || null;
    out.bet = parsed?.bet || null;
    out.betMoney = Number(parsed?.betMoney) || null;
    out.odds = Number(parsed?.odds) || null;
    out.failedLegOdds = Number(parsed?.failedLegOdds) || null;
    out.failedPlatformLabel = parsed?.failedPlatformLabel || null;
    out.observedAt = Number(parsed?.observedAt) || out.createAt;
    out.summary = `补单入队 · ${out.target || "未知方向"} · 锚腿 ${out.betMoney || "—"}@${out.odds || "—"}`;
    if (out.failedPlatformLabel)
      out.summary += ` · 失败腿 ${out.failedPlatformLabel}@${out.failedLegOdds || "—"}`;
  }
  else if (kind === "makeup_cancel") {
    out.linkId = Number(parsed?.linkId) || null;
    out.attemptType = "makeup_cancel";
    out.target = parsed?.target === "Home" || parsed?.target === "Away"
      ? parsed.target
      : null;
    out.match = parsed?.match || null;
    out.bet = parsed?.bet || null;
    out.betId = parsed?.betId || null;
    out.failedPlatformLabel = parsed?.failedPlatformLabel || null;
    out.observedAt = Number(parsed?.observedAt) || out.createAt;
    out.message = parsed?.reason || "锚腿确认拒单，补单队列已撤销";
    out.summary = `补单取消 · ${out.target || "未知方向"} · ${out.message}`;
  }

  return out;
}
