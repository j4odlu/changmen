/**
 * Polymarket Sports WS 消息解析（纯函数；赛程线权威在本包，与电竞 discovery 无关）
 * 只消费 PM 直接字段：score / period / status；不推断每图胜者或图内小分。
 */

/** @param {string | undefined} period */
export function parsePeriodToCurrentMap(period) {
  if (!period)
    return null;
  const head = String(period).split("/")[0];
  const n = Number.parseInt(head, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {string | undefined} score 例如 "000-000|1-0|Bo3" */
export function parseEsportsScore(score) {
  const raw = String(score || "").trim();
  if (!raw)
    return { mapScore: { home: 0, away: 0 }, bo: null };

  const parts = raw.split("|");
  const mapPart = parts[1] || "0-0";
  const boPart = parts[2] || "";
  const mapNums = mapPart.split("-").map(v => Number.parseInt(v, 10));
  const home = Number.isFinite(mapNums[0]) ? mapNums[0] : 0;
  const away = Number.isFinite(mapNums[1]) ? mapNums[1] : 0;
  const boMatch = /bo\s*(\d+)/i.exec(boPart);
  const bo = boMatch ? Number.parseInt(boMatch[1], 10) : null;

  return {
    mapScore: { home, away },
    bo: Number.isFinite(bo) && bo > 0 ? bo : null,
  };
}

/** @param {string | null | undefined} raw */
export function formatElapsed(raw) {
  const s = String(raw || "").trim();
  if (!s)
    return "";
  if (/^\d+$/.test(s)) {
    const sec = Number(s);
    if (!Number.isFinite(sec) || sec < 0)
      return "";
    const m = Math.floor(sec / 60);
    const ss = sec % 60;
    return `已进行${m}:${String(ss).padStart(2, "0")}`;
  }
  return `已进行${s}`;
}

/**
 * 按 Title canonical 主客对齐 pm_sport（与 matcher swapBetSource 同语义）。
 * @param {object | null | undefined} snapshot
 * @param {boolean} [reversed]
 */
export function alignPmSportSnapshot(snapshot, reversed = false) {
  if (!snapshot || typeof snapshot !== "object" || !reversed)
    return snapshot;

  const prevHomeTeam = snapshot.homeTeam;
  const prevAwayTeam = snapshot.awayTeam;
  const mapScore = snapshot.mapScore
    ? { home: snapshot.mapScore.away, away: snapshot.mapScore.home }
    : snapshot.mapScore;

  const aligned = {
    ...snapshot,
    homeTeam: prevAwayTeam,
    awayTeam: prevHomeTeam,
    mapScore,
  };
  aligned.label = buildPmSportDisplayLine(aligned);
  return aligned;
}

/** @param {string | null | undefined} raw */
export function formatResolutionSource(raw) {
  const s = String(raw || "").trim();
  if (!s)
    return "";
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./i, "");
    const path = u.pathname.replace(/\/$/, "");
    if (path && path !== "/")
      return `来源 ${host}${path}`;
    return `来源 ${host}`;
  }
  catch {
    return `来源 ${s.replace(/^https?:\/\//i, "").replace(/^www\./i, "")}`;
  }
}

export function buildPmSportLabel({ status, ended, live, period, mapScore }) {
  const ms = mapScore || { home: 0, away: 0 };
  const scoreText = `${ms.home}-${ms.away}`;
  const st = String(status || "").toLowerCase();

  if (ended || st === "finished" || st === "final")
    return `已结束 · ${scoreText}`;
  if (st === "postponed")
    return "延期";
  if (st === "canceled" || st === "cancelled")
    return "取消";
  if (st === "not_started" || st === "scheduled")
    return "未开始";
  if (live || st === "running" || st === "inprogress") {
    const periodText = period ? String(period) : "";
    return periodText ? `进行中 · ${periodText} · ${scoreText}` : `进行中 · ${scoreText}`;
  }
  if (status)
    return `${status} · ${scoreText}`;
  return scoreText;
}

/** 单行展示：状态 + 已进行 + 来源（仅 PM 直接字段） */
export function buildPmSportDisplayLine(snapshot) {
  if (!snapshot)
    return "";
  const parts = [];
  const statusPart = buildPmSportLabel({
    status: snapshot.status,
    ended: snapshot.ended,
    live: snapshot.live,
    period: snapshot.period,
    mapScore: snapshot.mapScore,
  });
  if (statusPart)
    parts.push(statusPart);

  const elapsed = formatElapsed(snapshot.elapsed);
  if (elapsed)
    parts.push(elapsed);

  const source = formatResolutionSource(snapshot.resolutionSource);
  if (source)
    parts.push(source);

  return parts.join(" · ");
}

/**
 * @param {object} msg Sports WS / Gamma 消息
 * @param {{ resolutionSource?: string } | null} prev
 */
export function buildPmSportSnapshot(msg, prev = null) {
  const parsed = parseEsportsScore(msg.score);
  const currentMap = parsePeriodToCurrentMap(msg.period);
  const homeTeam = String(msg.homeTeam || "").trim();
  const awayTeam = String(msg.awayTeam || "").trim();
  const status = String(msg.status || "").trim();
  const ended = msg.ended === true || status.toLowerCase() === "finished" || status === "Final";
  const live = msg.live === true;
  const resolutionSource = msg.resolutionSource
    ? String(msg.resolutionSource)
    : (prev?.resolutionSource ? String(prev.resolutionSource) : undefined);
  const eventIdRaw = msg.eventId != null
    ? String(msg.eventId)
    : (msg.event_id != null
      ? String(msg.event_id)
      : (msg.id != null
        ? String(msg.id)
        : (prev?.eventId != null ? String(prev.eventId) : undefined)));
  const snapshot = {
    gameId: msg.gameId != null ? Number(msg.gameId) : undefined,
    slug: msg.slug ? String(msg.slug) : (prev?.slug ? String(prev.slug) : undefined),
    eventId: eventIdRaw || undefined,
    leagueAbbreviation: msg.leagueAbbreviation ? String(msg.leagueAbbreviation) : undefined,
    homeTeam,
    awayTeam,
    status,
    live,
    ended,
    period: msg.period ? String(msg.period) : undefined,
    currentMap,
    bo: parsed.bo ?? undefined,
    scoreRaw: msg.score ? String(msg.score) : undefined,
    mapScore: parsed.mapScore,
    elapsed: msg.elapsed != null ? String(msg.elapsed) : undefined,
    finishedTimestamp: msg.finished_timestamp ? String(msg.finished_timestamp) : undefined,
    resolutionSource,
    updatedAt: Date.now(),
  };
  snapshot.label = buildPmSportDisplayLine(snapshot);
  return snapshot;
}
