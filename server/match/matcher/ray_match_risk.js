import { readJsonFile, writeJsonFile } from "@changmen/storage/json_file_store.js";

const FILE = "ray_match_risks";
let closed;

function closedKeys() {
  if (!closed) {
    const saved = readJsonFile(FILE, []);
    closed = new Set(Array.isArray(saved) ? saved.filter(key => typeof key === "string") : []);
  }
  return closed;
}

function remember(keys) {
  const current = closedKeys();
  const next = new Set([...current, ...keys]);
  if (next.size === current.size) return;
  // 先持久化再发布内存状态；失败可由下一轮原有采集重试。
  writeJsonFile(FILE, [...next]);
  closed = next;
}

function startTime(value) {
  let raw = String(value ?? "").trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) raw += "+08:00";
  return Date.parse(raw);
}

/** [changmen 扩展] 只读 RAY 原始赛果，不依赖下注盘口白名单或 PM 比分推断。 */
export function hasRayPrematchAnomaly(matchId, payload, now = Date.now()) {
  if (!/^\d+$/.test(String(matchId)) || !payload || typeof payload !== "object"
    || String(payload.id ?? "") !== String(matchId)) return false;
  const boMatch = /^(?:bo)?(3|5|7)$/i.exec(String(payload.round ?? "").trim());
  if (!boMatch || Number(payload.status) !== 1 || !(startTime(payload.start_time) > now)) return false;
  const bo = Number(boMatch[1]);
  const teams = payload.team;
  if (!Array.isArray(teams) || teams.length !== 2 || teams.some(team => !team)
    || !Array.isArray(payload.odds)) return false;
  const teamIds = new Set(teams.map(team => String(team.team_id ?? "")));
  if (teamIds.size !== 2 || teamIds.has("") || !teams.some(team => Number(team.pos) === 1)
    || !teams.some(team => Number(team.pos) === 2)) return false;
  for (let map = 1; map <= bo; map++) {
    const rows = payload.odds.filter(row => row && row.group_name === "获胜者"
      && new RegExp(`^(?:map|r)?${map}$`, "i").test(String(row.match_stage)));
    if (rows.length !== 2 || !rows[0].odds_group_id
      || String(rows[0].odds_group_id) !== String(rows[1].odds_group_id)
      || rows.some(row => !teamIds.has(String(row.team_id)))
      || String(rows[0].team_id) === String(rows[1].team_id)
      || !rows[0].odds_id || !rows[1].odds_id
      || String(rows[0].odds_id) === String(rows[1].odds_id)) return false;
    if (map < bo) {
      if (rows.some(row => !(row.win === -1 || row.win === "-1") || ![1, 2, 3].includes(Number(row.status)))) return false;
    }
    else if (rows.some(row => Number(row.status) !== 5)
      || !rows.some(row => row.win === 1 || row.win === "1")
      || !rows.some(row => row.win === 0 || row.win === "0")) return false;
  }
  return true;
}

export function observeRayMatchResult(matchId, payload, now = Date.now()) {
  if (hasRayPrematchAnomaly(matchId, payload, now)) remember([`RAY:${matchId}`]);
}

/** 整场过滤，保留合场记录和历史订单；关联来源变化不自动解除已经命中的异常。 */
export function filterRayRiskMatches(matches) {
  const keysFor = row => [
    ...(Number.isSafeInteger(Number(row.ID)) && Number(row.ID) > 0 ? [`match:${row.ID}`] : []),
    ...Object.entries(row.Matchs || {}).filter(([, id]) => id != null && String(id) !== "")
      .map(([provider, id]) => `${provider}:${id}`),
  ];
  // 同一批列表中相互关联的行也必须一起排除，不依赖返回顺序。
  const blocked = new Set(closedKeys());
  let previousSize;
  do {
    previousSize = blocked.size;
    for (const row of matches) {
      const keys = keysFor(row);
      if (keys.some(key => blocked.has(key))) for (const key of keys) blocked.add(key);
    }
  } while (blocked.size !== previousSize);
  remember(blocked);
  return matches.filter(row => !keysFor(row).some(key => blocked.has(key)));
}
