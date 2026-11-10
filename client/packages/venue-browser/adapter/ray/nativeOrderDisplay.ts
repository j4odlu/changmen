import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { shallowReactive, toRaw } from "vue";

export interface RayNativeOrderDisplayRow {
  order_number?: string | number;
  status?: number | string;
  create_time?: string | number | null;
  live?: number | string;
  server_time_offset_ms?: number | string;
  detail?: readonly { live?: number | string; risk?: number | string; win?: number | string }[];
}
export type RayNativeOrderDisplayStatus = "Pending" | "Open" | "Rejected" | "Returned" | "Settled";
interface Snapshot {
  sequence: number;
  binding: string;
  receivedAt: number;
  serverAt?: number;
  rows: ReadonlyMap<string, RayNativeOrderDisplayRow>;
}
let snapshots = new WeakMap<PlatformAccount, Snapshot>();
let generation = 0;
let sequence = 0;
export const rayNativeOrderDisplay = shallowReactive({ revision: 0 });
const binding = (account: PlatformAccount) => JSON.stringify([account.provider, account.accountId, account.gateway, account.token, account.currency]);

// H5 shared E/rn/cn：可识别的无时区日期按 GMT+8，其他字符串回退原生 Date。
function creationTime(value: RayNativeOrderDisplayRow["create_time"] = Date.now()): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?(?:\s*(Z)|([+-])(\d{2}):?(\d{2}))?$/i);
  if (match) {
    const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0", z, sign, zoneHour, zoneMinute] = match;
    const parts = [year, month, day, hour, minute, second, fraction.padEnd(3, "0")].map(Number);
    const [y, m, d, h, min, s, ms] = parts as [number, number, number, number, number, number, number];
    const utc = Date.UTC(y, m - 1, d, h, min, s, ms), date = new Date(utc);
    const valid = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()].every((part, i) => part === parts[i]);
    const offset = z ? 0 : sign ? (sign === "-" ? -1 : 1) * (Number(zoneHour) * 60 + Number(zoneMinute)) : 480;
    if (valid && (!sign || (Number(zoneHour) <= 23 && Number(zoneMinute) <= 59))) return utc - offset * 60_000;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** [changmen 扩展] RAY H5 co/ao 的显示投影，不改变 A8 业务 status。
 * 来源：https://ray164.com/assets/index-vJ-T9whR.js（2026-11-10 核对，build a2ae0a31）。
 * H5 pending / unsettled 分别显示待确认 / 待结算；35 秒整仍在窗口内。
 */
export function rayNativeOrderDisplayStatus(row: RayNativeOrderDisplayRow, now: number): RayNativeOrderDisplayStatus {
  const status = Number(row.status ?? 0), detail = row.detail ?? [];
  const created = creationTime(row.create_time);
  const seconds = created === null ? NaN : Math.floor((now - created) / 1000);
  const recentLive = Number(row.live) === 1 && seconds >= 0 && seconds <= 35;
  const hasRisk = detail.some(item => [1, 2].includes(Number(item.risk)));
  const riskPending = detail.some(item => [1, 2].includes(Number(item.risk)) && Number(item.win) === -1);
  if (status === 1) return "Settled";
  if (status === 4) return hasRisk || recentLive ? "Rejected" : "Returned";
  if (status === 0) {
    if (riskPending || recentLive) return "Pending";
    if (detail.length && detail.every(item => Number(item.win) === 99)) return hasRisk ? "Rejected" : "Returned";
  }
  return "Open";
}

/** 仅旁听既有响应；快照不放入 VenueOrder，不序列化、不参与下注或补单判断。 */
export function beginRayNativeOrderDisplay(account: PlatformAccount): (rows: readonly RayNativeOrderDisplayRow[], serverTime?: string) => void {
  const original = binding(account), stamp = generation, request = ++sequence;
  const key = toRaw(account);
  return (rows, serverTime) => {
    if (stamp !== generation || account.provider !== "RAY" || binding(account) !== original
      || (snapshots.get(key)?.sequence ?? 0) > request) return;
    const receivedAt = Date.now();
    const serverAt = serverTime ? Date.parse(serverTime) : NaN;
    const copy = new Map<string, RayNativeOrderDisplayRow>();
    for (const row of rows) {
      if (row.order_number == null) continue;
      copy.set(String(row.order_number), Object.freeze({
        order_number: row.order_number, status: row.status,
        create_time: row.create_time, live: row.live, server_time_offset_ms: row.server_time_offset_ms,
        detail: Object.freeze((row.detail ?? []).map(detail => Object.freeze({ live: detail.live, risk: detail.risk, win: detail.win }))),
      }));
    }
    snapshots.set(key, { sequence: request, binding: original, receivedAt, serverAt: Number.isFinite(serverAt) ? serverAt : undefined, rows: copy });
    rayNativeOrderDisplay.revision++;
  };
}

export function lookupRayNativeOrderDisplay(account: PlatformAccount, orderId: string, now = Date.now()): RayNativeOrderDisplayStatus | undefined {
  void rayNativeOrderDisplay.revision;
  const snapshot = snapshots.get(toRaw(account));
  if (!snapshot || snapshot.binding !== binding(account)) return undefined;
  const row = snapshot.rows.get(orderId);
  if (!row) return undefined;
  const offset = Number(row.server_time_offset_ms);
  const effectiveNow = snapshot.serverAt === undefined ? now + (Number.isFinite(offset) ? offset : 0) : snapshot.serverAt + now - snapshot.receivedAt;
  return rayNativeOrderDisplayStatus(row, effectiveNow);
}

export function resetRayNativeOrderDisplay(): void {
  generation++; snapshots = new WeakMap(); rayNativeOrderDisplay.revision++;
}
