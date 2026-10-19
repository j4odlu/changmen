import { shallowReactive } from "vue";
import { rayMatchStage } from "./shared/match_stage";
import type { RayOddsPayload } from "./shared/save_bets";

export const RAY_MATCH_RISK_MESSAGE = "可能存在让局，此局关闭。";
export const RAY_MATCH_RISK_STORAGE_KEY = "changmen:ray-match-risk:v1";
const closed = shallowReactive(new Set<string>());
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(RAY_MATCH_RISK_STORAGE_KEY) || "[]");
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string" && /^(?:match:)?\d+$/.test(id)) closed.add(id);
  }
  catch { /* 无本地存储时仍保留本次会话的关闭状态。 */ }
}

/** [changmen 扩展] 仅保存本客户端观察到的异常；与可展开、live 自动解除的盘口静音状态隔离。 */
export function isRayMatchRiskClosed(match: { id?: number; providers?: Record<string, string | number> }): boolean {
  const id = String(match.providers?.RAY ?? "");
  load();
  const matchKey = Number.isSafeInteger(match.id) && Number(match.id) > 0 ? `match:${match.id}` : "";
  if (matchKey && closed.has(matchKey)) return true;
  if (!id || !closed.has(id)) return false;
  if (matchKey) { closed.add(matchKey); save(); }
  return true;
}

function save(): void {
  try { localStorage.setItem(RAY_MATCH_RISK_STORAGE_KEY, JSON.stringify([...closed])); }
  catch { /* 保存失败不撤销本次已命中的关闭状态。 */ }
}

type RiskPayload = RayOddsPayload & { status?: unknown; round?: unknown; start_time?: unknown };

/** RAY 无时区的登记时间为 UTC+8；不借用可能方向/时间不同的合场字段。 */
function startTime(value: unknown): number {
  let raw = String(value ?? "").trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) raw += "+08:00";
  return Date.parse(raw);
}

export function updateRayMatchRisk(matchId: string, payload: RiskPayload, betRe: RegExp, gameCode?: string | null, now = Date.now()): void {
  if (!/^\d+$/.test(matchId) || String(payload.id ?? "") !== matchId || !gameCode) return;
  const boMatch = /^(?:bo)?(3|5|7)$/i.exec(String(payload.round ?? "").trim());
  if (!boMatch || Number(payload.status) !== 1 || !(startTime(payload.start_time) > now)) return;
  const bo = Number(boMatch[1]);
  const teams = payload.team;
  if (!Array.isArray(teams) || teams.length !== 2 || !Array.isArray(payload.odds)) return;
  const teamIds = new Set(teams.map(team => String(team.team_id ?? "")));
  if (teamIds.size !== 2 || teamIds.has("") || !teams.some(team => team.pos === 1) || !teams.some(team => team.pos === 2)) return;
  const maps = new Map<number, Array<Record<string, unknown>>>();
  for (const row of payload.odds) {
    const map = rayMatchStage(row.match_stage);
    // 风险只读原生“获胜者”赛果；不扩充目前部分游戏只覆盖前三图的下注白名单。
    if (!Number.isSafeInteger(map) || map < 1 || map > bo || row.group_name !== "获胜者" || !betRe.test(row.group_name)) continue;
    const rows = maps.get(map) ?? []; rows.push(row); maps.set(map, rows);
  }
  for (let map = 1; map <= bo; map++) {
    const rows = maps.get(map);
    if (!rows || rows.length !== 2 || !rows[0]!.odds_group_id || rows[0]!.odds_group_id !== rows[1]!.odds_group_id
      || rows.some(row => !teamIds.has(String(row.team_id))) || String(rows[0]!.team_id) === String(rows[1]!.team_id)
      || !rows[0]!.odds_id || !rows[1]!.odds_id || String(rows[0]!.odds_id) === String(rows[1]!.odds_id)) return;
    if (map < bo) {
      if (rows.some(row => !(row.win === -1 || row.win === "-1") || ![1, 2, 3].includes(Number(row.status)))) return;
    }
    else if (rows.some(row => Number(row.status) !== 5)
      || !rows.some(row => row.win === 1 || row.win === "1") || !rows.some(row => row.win === 0 || row.win === "0")) return;
  }
  load();
  if (closed.has(matchId)) return;
  closed.add(matchId);
  save();
}

// 初始化时恢复一次；下单路径只读内存，不请求赛果或等待存储。
load();
