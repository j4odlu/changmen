// [changmen 扩展] 与用户页 shared/pmSportDisplay.ts 保持相同的 PM 状态展示规则。
/** [changmen 扩展] 标题仅展示整场状态；缺值不按登记时间推断开赛。 */
export function formatPmMatchStatus(snapshot) {
  if (!snapshot)
    return { label: "状态待更新", kind: "unknown" };
  const status = String(snapshot?.status ?? "").trim().toLowerCase();
  if (status === "postponed")
    return { label: "延期", kind: "postponed" };
  if (status === "canceled" || status === "cancelled")
    return { label: "已取消", kind: "canceled" };
  if (snapshot?.ended || status === "finished" || status === "final" || status === "f/ot")
    return { label: ["已结束", formatPmMapScore(snapshot, true)].filter(Boolean).join(" · "), kind: "finished" };
  if (status === "suspended")
    return { label: "暂停", kind: "suspended" };
  if (status === "delayed")
    return { label: "延迟", kind: "delayed" };
  if (status === "forfeit")
    return { label: "弃权", kind: "forfeit" };
  if (status === "notnecessary")
    return { label: "无需进行", kind: "notnecessary" };
  if (snapshot?.live || status === "running" || status === "inprogress")
    return { label: ["进行中", formatPmMapPeriod(snapshot), formatPmMapScore(snapshot), formatPmElapsed(snapshot.elapsed)].filter(Boolean).join(" · "), kind: "live" };
  if (status === "not_started" || status === "scheduled")
    return { label: "未开赛", kind: "pending" };
  return { label: "状态待更新", kind: "unknown" };
}

function formatPmMapPeriod(snapshot) {
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

function formatPmMapScore(snapshot, finished = false) {
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

function formatPmElapsed(raw) {
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
