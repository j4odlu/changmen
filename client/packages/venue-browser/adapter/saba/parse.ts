/** 对齐 gamebet_backend/platforms/saba/saba_core.js / A8 NQe + RQe */

export const SABA_BET_TYPES: Record<number, string> = {
  20: "Moneyline",
  9001: "Map X Moneyline",
};

function extractEsField(html: string, field: string): string | null {
  const re = new RegExp(`ES\\.${field}\\s*=\\s*(.+);`);
  const m = re.exec(html);
  return m ? m[1].trim() : null;
}

function parseEsUrl(raw: string | null): string | null {
  if (!raw) return null;
  let text = raw.replace(/^["']|["']$/g, "");
  try {
    const obj = JSON.parse(text) as { p?: string };
    if (obj?.p) return String(obj.p);
  } catch {
    /* fall through */
  }
  const m = /"p"\s*:\s*"([^"]+)"/.exec(text);
  if (m) return m[1]!;
  if (text.startsWith("wss://")) return text.replace(/^wss:\/\//, "");
  return text;
}

export interface SabaWsConfig {
  wsHost: string;
  id: string;
  logo: string;
  token: string;
  gid: string;
  rid: string;
  ext: number;
  origin: string;
  checkinUrl: string;
}

export function parseEsportsPage(html: string, _gateway: string): Omit<SabaWsConfig, "origin" | "checkinUrl" | "gid"> | null {
  const urlRaw = extractEsField(html, "url");
  const wsHost = parseEsUrl(urlRaw);
  const id = extractEsField(html, "id")?.replace(/\\"/g, "").replace(/^"|"$/g, "");
  const logo = extractEsField(html, "logo")?.replace(/\\"/g, "").replace(/^"|"$/g, "");
  const accountRaw = extractEsField(html, "account");
  if (!wsHost || !id || !logo || !accountRaw) return null;
  let account: { pnv?: { tk?: string } };
  try {
    account = JSON.parse(accountRaw);
  } catch {
    return null;
  }
  const token = account?.pnv?.tk;
  if (!token) return null;
  return {
    wsHost,
    id,
    logo,
    token,
    rid: "1",
    ext: 1,
  };
}

export function buildSabaWsConfig(
  parsed: Omit<SabaWsConfig, "origin" | "checkinUrl" | "gid">,
  session: { gateway: string; token: string },
): SabaWsConfig {
  const originHost = new URL(session.gateway).host;
  return {
    ...parsed,
    gid: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    origin: `https://${originHost}`,
    checkinUrl: `${session.gateway.replace(/\/+$/, "")}/${session.token}/LoginCheckin/Index`,
  };
}

export function convertMalaysianToEU(odds: unknown, digits = 2): number {
  const n = Number(odds);
  if (!Number.isFinite(n)) return 0;
  const fixed = (v: number) => Number(v.toFixed(digits));
  return n > 0 ? fixed(n + 1) : fixed(1 + 1 / Math.abs(n));
}

export interface SabaMatchRow {
  matchid?: string | number;
  gameId?: string | number;
  kickofftime?: number;
  homeid?: string | number;
  awayid?: string | number;
  hteamnamecn?: string;
  ateamnamecn?: string;
  hteamname?: string;
  ateamname?: string;
  leaguenamecn?: string;
  leagueid?: string | number;
}

export interface SabaOddsRow {
  oddsid?: string | number;
  matchid?: string | number;
  bettype?: number;
  resourceid?: string | number;
  oddsstatus?: string;
  odds1a?: unknown;
  odds2a?: unknown;
}

export function normalizeSabaMatch(row: SabaMatchRow, gameIds: string[]): ReturnType<typeof buildMatchDto> | null {
  if (!row?.gameId || !gameIds.includes(String(row.gameId))) return null;
  const nowSec = Date.now() / 1000;
  if (Number(row.kickofftime) > nowSec + 3600) return null;
  return buildMatchDto(row);
}

function buildMatchDto(row: SabaMatchRow) {
  return {
    matchId: String(row.matchid),
    gameId: String(row.gameId),
    startTime: Number(row.kickofftime) * 1000,
    homeId: String(row.homeid),
    homeName: row.hteamnamecn || row.hteamname || "主队",
    awayId: String(row.awayid),
    awayName: row.ateamnamecn || row.ateamname || "客队",
    leagueName: row.leaguenamecn || "",
  };
}

export function normalizeSabaOdds(
  oddRow: SabaOddsRow,
  match: ReturnType<typeof buildMatchDto>,
): {
  stageId: number;
  betName: string;
  marketId: string;
  homeId: string;
  awayId: string;
  homeOdds: number;
  awayOdds: number;
  locked: boolean;
} | null {
  const betType = SABA_BET_TYPES[Number(oddRow.bettype)];
  if (!betType || !match) return null;
  const stageId = oddRow.resourceid ? Number(oddRow.resourceid) : 0;
  const locked = oddRow.oddsstatus !== "running";
  const homeId = `${oddRow.oddsid}:Home`;
  const awayId = `${oddRow.oddsid}:Away`;
  return {
    stageId,
    betName: betType.replace("Map X", stageId ? `Map ${stageId}` : "Moneyline"),
    marketId: String(oddRow.oddsid),
    homeId,
    awayId,
    homeOdds: convertMalaysianToEU(oddRow.odds1a),
    awayOdds: convertMalaysianToEU(oddRow.odds2a),
    locked,
  };
}

export function decodePairMessage(parts: unknown[], fieldMap: Record<number, string>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i];
    const val = parts[i + 1];
    if (typeof key === "number" || typeof key === "string") {
      obj[fieldMap[Number(key)] ?? String(key)] = val;
    }
  }
  return obj;
}

export const SABA_PAGE_PATH = (gateway: string, token: string, sportPath = "43") =>
  `${gateway.replace(/\/+$/, "")}/${token}/ESports/${sportPath}/ALL?mode=m0&market=L`;

export const SABA_SUBSCRIBE_ODDS: unknown[] = [
  [
    "odds",
    {
      spread: [
        {
          id: "c0",
          rev: "DM4WT",
          sorting: 0,
          condition: {},
          r: "c1627df7-r3928",
          p: "d530b060d500b34b-b2074",
        },
      ],
      odds: [
        {
          id: "c2",
          rev: "Gwz9v",
          sorting: "n",
          condition: { sporttype: "43", marketid: "L", no_stream: true, bettype: [20, 9001] },
          r: "be2e717c-r4560",
          p: "d530b060d500b34b-b783",
        },
        {
          id: "c4",
          rev: "Gwz0v",
          sorting: "n",
          condition: { sporttype: "43", marketid: "L", no_stream: true, bettype: [20, 9001] },
          r: "be2e717c-r4560",
          p: "d530b060d500b34b-b783",
        },
      ],
    },
  ],
];

/** SABA 电竞页 HTML（A8 插件 Yn.get；此处为页面 fetch 直连） */
export async function fetchSabaEsportsPage(session: {
  gateway: string;
  token: string;
  sportPath?: string;
}): Promise<string> {
  const url = SABA_PAGE_PATH(session.gateway, session.token, session.sportPath ?? "43");
  const headers = {
    Accept: "text/html,application/xhtml+xml,*/*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  };
  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
  return text;
}
