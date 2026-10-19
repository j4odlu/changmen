/** 对齐 gamebet_backend/platforms/imt/imt_core.js / A8 HQe */

export function parseMapFromWs(ws: Array<{ s?: string }> | undefined): number {
  if (!ws || ws.length !== 2) return 0;
  const text = ws[0]?.s || "";
  const m = /gamenr=(\d)/.exec(String(text));
  return m ? Number(m[1]) : 0;
}

export function oddsKey(si: number | string, wsi: number | string): string {
  return `${si}:${wsi}`;
}

export interface ImtParsedBet {
  matchId: string;
  gameId: string;
  map: number;
  betName: string;
  marketId: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeOdds: number;
  awayOdds: number;
  locked: boolean;
}

export interface ImtParsedMatch {
  matchId: string;
  gameId: string;
  startTime: number;
  homeId: string | number;
  homeName: string;
  awayId: string | number;
  awayName: string;
  leagueName: string;
  bets: ImtParsedBet[];
}

export function normalizeImtFullPayload(data: Record<string, unknown>): {
  matches: ImtParsedMatch[];
  delta: unknown;
} {
  const matches: ImtParsedMatch[] = [];
  const ale = (data.ale ?? []) as Array<{ sels?: Array<Record<string, unknown>> }>;

  for (const group of ale) {
    for (const sel of group.sels ?? []) {
      const matchId = `${sel.st}:${sel.eid}`;
      const bets: ImtParsedBet[] = [];

      for (const ml of (sel.mls ?? []) as Array<Record<string, unknown>>) {
        const ws = ml.ws as Array<{ s?: string; si?: number; wsi?: number; o?: number }> | undefined;
        const map = parseMapFromWs(ws);
        if (map === 0) continue;
        const home = ws?.find((w) => w.si === 707);
        const away = ws?.find((w) => w.si === 708);
        if (!home || !away) continue;

        const marketId = `${map}:${ml.bti}:${ml.mi}`;
        bets.push({
          matchId,
          gameId: String(sel.st),
          map,
          betName: String(ml.btn || ""),
          marketId,
          homeId: oddsKey(home.si!, home.wsi!),
          awayId: oddsKey(away.si!, away.wsi!),
          homeName: String(sel.htn || "主队"),
          awayName: String(sel.atn || "客队"),
          homeOdds: Number(home.o) || 0,
          awayOdds: Number(away.o) || 0,
          locked: Boolean(ml.il),
        });
      }

      matches.push({
        matchId,
        gameId: String(sel.st),
        startTime: sel.edt ? new Date(String(sel.edt)).getTime() : Date.now(),
        homeId: sel.htid as string | number,
        homeName: String(sel.htn || "主队"),
        awayId: sel.atid as string | number,
        awayName: String(sel.atn || "客队"),
        leagueName: String(sel.cn || sel.en || ""),
        bets,
      });
    }
  }

  return { matches, delta: data.d ?? null };
}

export function imtTeamLogo(teamId: string | number): string {
  return `https://ipis-cdn.kemehkemeh.xyz/TeamImage/${teamId}.png`;
}

export const IMT_DEFAULT_X_SC =
  "AlcIWQJYUwMIBwEFVAkLVAECBw9QVV0BDQpXWAAHAVIABB0DACFIbmFVIlI9BCw6OBBxXANsEzZZ";

export const IMT_DEFAULT_SPORT_IDS = ["43"];
