import type { PmSportSnapshot } from "@/types/esport";

export type PmSportDisplayPart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

export interface PmMatchStatusDisplay {
  label: string;
  kind: "pending" | "live" | "finished" | "postponed" | "canceled" | "unknown";
}

/** [changmen 扩展] 标题仅展示整场状态；缺值不按登记时间推断开赛。 */
export function formatPmMatchStatus(snapshot: PmSportSnapshot | undefined): PmMatchStatusDisplay {
  if (!snapshot)
    return { label: "状态待更新", kind: "unknown" };
  const status = String(snapshot?.status ?? "").trim().toLowerCase();
  if (status === "postponed")
    return { label: "延期", kind: "postponed" };
  if (status === "canceled" || status === "cancelled")
    return { label: "已取消", kind: "canceled" };
  if (snapshot?.ended || status === "finished" || status === "final")
    return { label: ["已结束", formatPmMapScore(snapshot, true)].filter(Boolean).join(" · "), kind: "finished" };
  if (snapshot?.live || status === "running" || status === "inprogress")
    return { label: ["进行中", formatPmMapPeriod(snapshot), formatPmMapScore(snapshot), formatElapsed(snapshot.elapsed)].filter(Boolean).join(" · "), kind: "live" };
  if (status === "not_started" || status === "scheduled")
    return { label: "未开赛", kind: "pending" };
  return { label: "状态待更新", kind: "unknown" };
}

function formatPmMapPeriod(snapshot: PmSportSnapshot): string {
  const period = String(snapshot.period ?? "").trim();
  const match = /^(\d+)\/(\d+)$/.exec(period);
  if (match && Number(match[1]) > 0 && Number(match[1]) <= Number(match[2]))
    return `地图${period}`;
  const map = snapshot.currentMap;
  if (typeof map === "number" && Number.isInteger(map) && map > 0) {
    const bo = snapshot.bo;
    return typeof bo === "number" && Number.isInteger(bo) && bo >= map
      ? `地图${map}/${bo}` : `地图${map}`;
  }
  return period ? `阶段${period}` : "";
}

function formatPmMapScore(snapshot: PmSportSnapshot, finished = false): string {
  // [changmen 扩展] 旧采集快照缺 score 时会填 0-0，必须确认原始比分存在。
  const raw = String(snapshot.scoreRaw ?? "").trim();
  const mapPart = raw.includes("|") ? raw.split("|")[1]?.trim() : raw;
  const score = snapshot.mapScore;
  if (!mapPart || !/^\d+\s*-\s*\d+$/.test(mapPart) || !score
    || !Number.isInteger(score.home) || score.home < 0
    || !Number.isInteger(score.away) || score.away < 0)
    return "";
  return `${finished ? "最终大比分" : "大比分"}${score.home}–${score.away}`;
}

function formatElapsed(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
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

export function formatResolutionSourceLabel(raw: string | undefined): string {
  const s = String(raw ?? "").trim();
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

export function normalizeResolutionSourceHref(raw: string | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s)
    return "";
  try {
    return new URL(s).href;
  }
  catch {
    return `https://${s.replace(/^https?:\/\//i, "")}`;
  }
}

function buildStatusLabel(snapshot: PmSportSnapshot): string {
  const ms = snapshot.mapScore || { home: 0, away: 0 };
  const scoreText = `${ms.home}-${ms.away}`;
  const st = String(snapshot.status || "").toLowerCase();

  if (snapshot.ended || st === "finished" || st === "final")
    return `已结束 · ${scoreText}`;
  if (st === "postponed")
    return "延期";
  if (st === "canceled" || st === "cancelled")
    return "取消";
  if (st === "not_started" || st === "scheduled")
    return "未开始";
  if (snapshot.live || st === "running" || st === "inprogress") {
    const periodText = snapshot.period ? String(snapshot.period) : "";
    return periodText ? `进行中 · ${periodText} · ${scoreText}` : `进行中 · ${scoreText}`;
  }
  if (snapshot.status)
    return `${snapshot.status} · ${scoreText}`;
  return scoreText;
}

function partsFromLabel(snapshot: PmSportSnapshot): PmSportDisplayPart[] {
  const label = String(snapshot.label ?? "").trim();
  if (!label)
    return [];

  const src = String(snapshot.resolutionSource ?? "").trim();
  if (!src)
    return [{ kind: "text", text: label }];

  const srcLabel = formatResolutionSourceLabel(src);
  const href = normalizeResolutionSourceHref(src);
  return label.split(" · ").map((segment) => {
    const text = segment.trim();
    if (!text)
      return null;
    if (text === srcLabel || text.startsWith("来源 "))
      return { kind: "link" as const, text, href };
    return { kind: "text" as const, text };
  }).filter((part): part is PmSportDisplayPart => part != null);
}

function partsFromSnapshot(snapshot: PmSportSnapshot): PmSportDisplayPart[] {
  const parts: PmSportDisplayPart[] = [];
  const statusPart = buildStatusLabel(snapshot);
  if (statusPart)
    parts.push({ kind: "text", text: statusPart });

  const elapsed = formatElapsed(snapshot.elapsed);
  if (elapsed)
    parts.push({ kind: "text", text: elapsed });

  const src = String(snapshot.resolutionSource ?? "").trim();
  if (src) {
    parts.push({
      kind: "link",
      text: formatResolutionSourceLabel(src),
      href: normalizeResolutionSourceHref(src),
    });
  }
  return parts;
}

/** 与 server parse_sport 对齐；仅 PM 直接字段（大比分 + period + 来源） */
export function buildPmSportDisplayParts(snapshot: PmSportSnapshot | undefined): PmSportDisplayPart[] {
  if (!snapshot)
    return [];

  const structured = partsFromSnapshot(snapshot);
  if (structured.length)
    return structured;

  return partsFromLabel(snapshot);
}
