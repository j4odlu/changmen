import { extractObPlaySelections, playsFromObMatchRow } from "@/runtime/obSportOdds";

export type ObSportMarketMeta = {
  oid: string;
  hid: string;
  hpid: string;
  playOptions: string;
  marketValue: string;
};

// 只复用盘口标识，绝不把列表赔率当成下注账号的最终预检价。
const cache = new Map<string, { at: number; rows: Map<string, ObSportMarketMeta> }>();
const TTL_MS = 15_000;
const MAX_MATCHES = 500;

function key(gateway: string, mid: string): string {
  return `${gateway.replace(/\/$/, "")}|${mid}`;
}

export function clearObSportMarketMeta() {
  cache.clear();
}

export function rememberObSportMarketMeta(gateway: string, decoded: unknown) {
  function visit(value: unknown) {
    if (!value || typeof value !== "object")
      return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const row = value as Record<string, unknown>;
    const mid = String(row.mid || "").trim();
    const plays = playsFromObMatchRow(row);
    if (mid && plays.length) {
      const rows = new Map<string, ObSportMarketMeta>();
      for (const play of plays) {
        for (const line of extractObPlaySelections(play)) {
          if (!line.hid || !line.hpid)
            continue;
          for (const selection of line.selections) {
            if (!selection.oid)
              continue;
            const side = selection.side;
            rows.set(selection.oid, {
              oid: selection.oid, hid: line.hid, hpid: line.hpid,
              playOptions: side === "over" ? "Over" : side === "under" ? "Under" : side === "home" ? "1" : side === "away" ? "2" : "X",
              marketValue: line.line == null ? "" : String(line.line),
            });
          }
        }
      }
      cache.set(key(gateway, mid), { at: Date.now(), rows });
      while (cache.size > MAX_MATCHES)
        cache.delete(cache.keys().next().value!);
      return;
    }
    for (const child of Object.values(row))
      if (child && typeof child === "object")
        visit(child);
  }
  visit(decoded);
}

export function peekObSportMarketMeta(gateway: string, mid: string, oid: string): ObSportMarketMeta | undefined {
  const id = key(gateway, mid);
  const hit = cache.get(id);
  if (!hit)
    return undefined;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return hit.rows.get(oid);
}
