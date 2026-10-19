import { getCollectPlatform, saveLiveTimer, updatePlatform } from "@changmen/client-core/bridge/clientApi";
import { OB_DEMO_LOGIN_URL } from "./constants";
import { getObBetNameRe } from "./parse";

import { PLATFORMS } from "../shared/platforms";
import { getStaticVenueGames } from "@changmen/client-core/shared/venueGames";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { getGameCodeForPlatformId } from "@changmen/shared/catalog/game_catalog.browser";
import { collectObGet, loadMarketsForMatch, maxStageFromBo } from "./markets";
import {
  connectObMqtt,
  disconnectObMqtt,
  setObMqttCollectPlatform,
  subscribeObMatchAfterView,
  unsubscribeObMatchBeforeView,
} from "./mqtt";
import { num } from "./parse";
import { directGet } from "@changmen/client-core/shared/http";
import { useCollectStore } from "../shared/webBridge";
import type { CollectMatchDto } from "@changmen/client-core/types/collect";
import type { CollectPlatformInfo } from "@changmen/api-contract";

const PLATFORM = PLATFORMS.OB;
const POLL_MS = 30_000;

/** [A8 可证实] bundle `tK` / `pIe`（2.0.245） */
const OB_CDN_BASE = "https://uphw-cdn4.shudarong.com";
const TEAM_LOGO_URL = `${OB_CDN_BASE}/upload/json/pc.json`;
const TEAM_LOGO_LS = "OBService:TeamLogo";

let teamLogos: Record<string, string> | null = null;

/** ?? A8 v0???? device=2?PC=1 */
export function obDeviceId(userAgent?: string): string {
  return userAgent && /mobile/i.test(userAgent) ? "2" : "1";
}

async function loadObTeamLogosMap(): Promise<Record<string, string> | null> {
  try {
    const data = await directGet<{ team_imag?: Record<string, string> }>(TEAM_LOGO_URL, {});
    return data.team_imag ?? null;
  } catch {
    return null;
  }
}

/** ?? A8 e9????????????Nr.get ?? CDN??*/
export async function ensureObTeamLogosLoaded(): Promise<void> {
  if (teamLogos) return;
  teamLogos = await loadObTeamLogosMap();
  if (teamLogos) {
    localStorage.setItem(TEAM_LOGO_LS, JSON.stringify(teamLogos));
    return;
  }
  const cached = localStorage.getItem(TEAM_LOGO_LS);
  if (!cached) return;
  try {
    teamLogos = JSON.parse(cached) as Record<string, string>;
  } catch {
    teamLogos = null;
  }
}

/** ?? URL????ensureObTeamLogosLoaded??*/
export function resolveObTeamLogoSync(teamId: string): string {
  if (!teamLogos || !teamLogos[teamId]) return "";
  return `${OB_CDN_BASE}/${teamLogos[teamId]}`;
}

/** ?? A8 e9????CDN */
export async function resolveObTeamLogo(teamId: string): Promise<string> {
  await ensureObTeamLogosLoaded();
  return resolveObTeamLogoSync(teamId);
}

function parseObPcEntry(pc: string): { token: string; gateway: string | null } {
  const url = new URL(pc);
  const token = url.searchParams.get("token") || "";
  const addrRaw = url.searchParams.get("addr") || "";
  let gateway: string | null = null;
  if (addrRaw) {
    try {
      const addr = JSON.parse(atob(decodeURIComponent(addrRaw))) as { api?: unknown };
      if (Array.isArray(addr.api) && addr.api[0]) gateway = String(addr.api[0]);
    } catch {
      /* ignore */
    }
  }
  return { token, gateway };
}

/** [A8 可证实] bundle `$Me`/`gIe`：试玩 login 只写 token */
export async function refreshObCollectToken(): Promise<string | null> {
  try {
    const body = await directGet<{ data?: { pc?: string; token?: string } }>(OB_DEMO_LOGIN_URL, {});
    const pc = body?.data?.pc;
    if (!pc) return null;
    const token = body.data?.token || parseObPcEntry(pc).token;
    if (!token) return null;
    await updatePlatform({ provider: PLATFORMS.OB, token });
    return token;
  } catch {
    return null;
  }
}

/** [A8 可证实] bundle `mIe`：`game/getTimer` → `Ut.saveLiveTimer(OB, rows)`，无 is_live 过滤、无 index 推断、不上报后拉 GetMatchs */
export async function syncObLiveTimer(
  platform: CollectPlatformInfo,
  indexRows: Array<Record<string, unknown>> = [],
): Promise<void> {
  const res = await collectObGet<{
    status: string;
    data?: Record<string, Record<string, unknown>>;
  }>(platform, "game/getTimer", "");
  if (res.status !== "true" || !res.data) return;

  const timer: Array<{ MatchID: string | number; Round: number; StartTime: number }> = [];
  for (const row of Object.values(res.data)) {
    timer.push({
      MatchID: row.match_id as string | number,
      Round: num(row.round),
      StartTime: num(row.start_time) * 1000,
    });
  }
  if (timer.length === 0 && indexRows.some(row => num(row.is_live) === 2)) {
    console.warn("[OB] getTimer empty while index has is_live=2; skip saveLiveTimer");
    return;
  }
  await saveLiveTimer(PLATFORMS.OB, timer);
}

/** game/index ???? match_team ?????? */
export function teamsFromListRow(row: Record<string, unknown>): [string, string] {
  const teams = String(row.match_team ?? "")
    .replace(/&nbsp;/g, " ")
    .split(",");
  return [teams[0] ?? "", teams[1] ?? ""];
}

/** game/index ?? ??Client_SaveMatch ?? */
export async function buildMatchesFromList(
  rows: Array<Record<string, unknown>>,
): Promise<CollectMatchDto[]> {
  await ensureObTeamLogosLoaded();
  const payload: CollectMatchDto[] = [];
  for (const row of rows) {
    const [homeName, awayName] = teamsFromListRow(row);
    const teamIds = String(row.team_id ?? "").split(",");
    if (!homeName || !awayName || teamIds.length !== 2) continue;
    const homeLogo = resolveObTeamLogoSync(teamIds[0]!);
    const awayLogo = resolveObTeamLogoSync(teamIds[1]!);
    payload.push({
      Type: PLATFORM,
      SourceGameID: row.game_id as string | number,
      SourceMatchID: row.id as string | number,
      BO: num(row.bo),
      StartTime: num(row.start_time) * 1000,
      Home: homeName,
      HomeID: teamIds[0]!,
      Away: awayName,
      AwayID: teamIds[1]!,
      IsLive: num(row.is_live),
      Teams: [
        {
          Type: PLATFORM,
          GameID: row.game_id as string | number,
          Name: homeName,
          TeamID: teamIds[0]!,
          Logo: homeLogo,
        },
        {
          Type: PLATFORM,
          GameID: row.game_id as string | number,
          Name: awayName,
          TeamID: teamIds[1]!,
          Logo: awayLogo,
        },
      ],
    });
  }
  return payload;
}

export function startObCollector(): () => void {
  let stopped = false;
  let loopPromise: Promise<void> | null = null;

  const collect = useCollectStore();

  const poll = async () => {
    while (!stopped) {
      const started = Date.now();
      let matchCount = 0;
      try {
        let platform = await getCollectPlatform(PLATFORM);
        const games = getStaticVenueGames(PLATFORM);
        if (!platform?.Gateway) {
          await wait(POLL_MS);
          continue;
        }
        setObMqttCollectPlatform(platform);

        const betRe = getObBetNameRe(platform.BetName);

        const index = await collectObGet<{ status: string; data?: Array<Record<string, unknown>> | string }>(
          platform,
          "game/index",
          "game_id=0&flag=1&day=1",
        );
        if (index.status === "false") {
          if (index.data === "token") {
            const token = await refreshObCollectToken();
            if (token) platform = { ...platform, Token: token };
          }
          await wait(POLL_MS);
          continue;
        }

        const rawList = (index.data ?? []) as Array<Record<string, unknown>>;
        const horizon = Date.now() / 1000 + 3600;
        const list = rawList.filter((row) => {
          const gid = String(row.game_id ?? "");
          return games.includes(gid) && num(row.start_time) < horizon;
        });

        const matchPayload = await buildMatchesFromList(list);
        await collect.saveMatch(PLATFORM, matchPayload);

        for (const row of list) {
          if (stopped) break;
          const matchId = String(row.id ?? "");
          if (!matchId) continue;
          matchCount += 1;

          unsubscribeObMatchBeforeView(matchId);
          const gameCode = getGameCodeForPlatformId("OB", String(row.game_id ?? "")) || null;
          const loaded = await loadMarketsForMatch(
            platform,
            matchId,
            maxStageFromBo(row.bo),
            betRe,
            teamsFromListRow(row),
            gameCode,
          );
          // [A8 可证实] UMe：h||saveBets — 仅 hadError 挡上报，空 f 仍 saveBets
          if (!loaded.hadError) {
            await collect.saveBets(PLATFORM, matchId, loaded.bets);
          }
          void subscribeObMatchAfterView(matchId);
        }

        await syncObLiveTimer(platform, list);
      } catch (err) {
        console.warn("[OB] collect error", err);
        notifyCollectError("OB", err);
      } finally {
        console.debug(`[OB] poll:${Date.now() - started}ms views:${matchCount}`);
        await wait(POLL_MS);
      }
    }
  };

  void (async () => {
    await wait(3000);
    if (stopped) return;
    // [A8 可证实] MQTT 只写 fo；全表 refreshOddsOnBets 由主循环负责
    connectObMqtt();
    loopPromise = poll();
  })();

  return () => {
    stopped = true;
    disconnectObMqtt();
    void loopPromise;
  };
}
