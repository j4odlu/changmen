import { saveVenueOdds, cleanVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import { directPostJson } from "@changmen/client-core/shared/http";
import { resolveCollectSession } from "../shared/collectSession";
import type { CollectHttpSession } from "../shared/collectSession";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import {
  IMT_DEFAULT_SPORT_IDS,
  imtTeamLogo,
  normalizeImtFullPayload,
} from "./parse";
import { buildImtHeaders } from "./auth";
import { PLATFORMS } from "../shared/platforms";
import { getStaticVenueGames } from "@changmen/client-core/shared/venueGames";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";

import { useMatchStore } from "../shared/webBridge";

const PLATFORM = PLATFORMS.IMT;
const POLL_MS = 1_000;
const SAVE_MS = 60_000;

interface ImtApiResponse {
  StatusCode?: number;
  Message?: string;
  Delta?: unknown;
  dc?: Array<{ v?: Array<{ il?: boolean; ws?: Array<{ si?: number; wsi?: number; o?: number }> }> }>;
}

/** A8 HQe/GQe：IMT POST 直连 */
async function collectImtPost<T>(
  session: CollectHttpSession,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const base = session.gateway.replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = buildImtHeaders(session);
  return directPostJson<T>(url, headers, body);
}

export function startImtCollector(): () => void {
  let stopped = false;
  let lastSaveAt = 0;
  let delta: unknown = null;
  let sportIds: number[] = [];
  const collect = useCollectStore();
  const matchStore = useMatchStore();

  const poll = async () => {
    while (!stopped) {
      const started = Date.now();
      let matchCount = 0;
      try {
        const platform = await getCollectPlatform(PLATFORM);
        const games = getStaticVenueGames(PLATFORM);
        if (!platform) {
          await wait(POLL_MS);
          continue;
        }

        const session = await resolveCollectSession(PLATFORM, {
          preferAccountWithBalance: true,
          allowPlatformFallback: false,
        });
        if (!session) {
          console.log(PLATFORM, "当前未检测到账号");
          cleanVenueOdds(PLATFORM);
          await wait(3_000);
          continue;
        }

        const shouldSave = Date.now() - lastSaveAt > SAVE_MS;

        if (shouldSave) {
          const sportIdList = games.length
            ? games.map((g) => Number(g)).filter((n) => !Number.isNaN(n))
            : IMT_DEFAULT_SPORT_IDS.map(Number);

          const body = {
            AllLiveEventsRequestGroups: sportIdList.map((id) => ({
              SportId: id,
              EventGroupTypeIds: [],
              OddsTemplateBetType: 0,
              OddsTemplate: 16,
            })),
            IsCombo: false,
            OddsType: 3,
            BetTypes: [283],
            Periods: [1],
            SortingType: 2,
            PanelType: 2,
          };

          const res = await collectImtPost<ImtApiResponse & Record<string, unknown>>(
            session,
            "/mobilesitev2/api/Event/GetAllLiveEvents",
            body,
          );

          if (res.StatusCode !== 100) {
            cleanVenueOdds(PLATFORM);
            await wait(POLL_MS);
            continue;
          }

          const { matches, delta: nextDelta } = normalizeImtFullPayload(res);
          if (nextDelta != null) delta = nextDelta;

          const allowed = new Set(games.length ? games : sportIdList.map(String));
          const filtered = matches.filter((m) => allowed.has(m.gameId));
          matchCount = filtered.length;
          sportIds = [...new Set(filtered.map((m) => Number(m.gameId)).filter((n) => !Number.isNaN(n)))];

          const matchPayload: CollectMatchDto[] = [];
          const betsByMatch = new Map<string, CollectBetDto[]>();

          const now = Date.now();
          for (const row of filtered) {
            const bets: CollectBetDto[] = row.bets.map((bet) => {
              saveVenueOdds(PLATFORM, {
                id: bet.homeId,
                odds: bet.homeOdds,
                isLock: bet.locked,
                betId: bet.marketId,
                time: now,
              });
              saveVenueOdds(PLATFORM, {
                id: bet.awayId,
                odds: bet.awayOdds,
                isLock: bet.locked,
                betId: bet.marketId,
                time: now,
              });
              return {
                Type: PLATFORM,
                SourceMatchID: row.matchId,
                SourceBetID: bet.marketId,
                Map: bet.map,
                BetName: bet.betName,
                SourceHomeID: bet.homeId,
                HomeName: bet.homeName,
                HomeOdds: bet.homeOdds,
                SourceAwayID: bet.awayId,
                AwayName: bet.awayName,
                AwayOdds: bet.awayOdds,
                Status: bet.locked ? "Locked" : "Normal",
              };
            });

            matchPayload.push({
              Type: PLATFORM,
              SourceMatchID: row.matchId,
              SourceGameID: row.gameId,
              StartTime: row.startTime,
              Home: row.homeName,
              HomeID: row.homeId,
              Away: row.awayName,
              AwayID: row.awayId,
              Teams: [
                {
                  Type: PLATFORM,
                  GameID: row.gameId,
                  Name: row.homeName,
                  TeamID: row.homeId,
                  Logo: imtTeamLogo(row.homeId),
                },
                {
                  Type: PLATFORM,
                  GameID: row.gameId,
                  Name: row.awayName,
                  TeamID: row.awayId,
                  Logo: imtTeamLogo(row.awayId),
                },
              ],
            });
            betsByMatch.set(row.matchId, bets);
          }

          const saved = await collect.saveMatch(PLATFORM, matchPayload);
          if (saved) {
            await Promise.all(
              [...betsByMatch.entries()]
                .filter(([, bets]) => bets.length)
                .map(([matchId, bets]) => collect.saveBets(PLATFORM, matchId, bets)),
            );
            lastSaveAt = Date.now();
          }
        } else if (delta != null && sportIds.length > 0) {
          const body = {
            AllLiveEventsDeltaRequestGroups: sportIds.map((id) => ({
              SportId: id,
              EventGroupTypeIds: [],
              OddsTemplateBetType: 0,
              OddsTemplate: 16,
            })),
            CompetitionIds: [],
            SortingType: 2,
            Delta: delta,
            BetTypes: [283],
            Periods: [1],
            OddsType: 3,
            SportIds: sportIds,
            IsCombo: false,
            PanelType: 2,
          };

          const res = await collectImtPost<ImtApiResponse>(
            session,
            "/mobilesitev2/api/Event/getAllLiveEventsDelta",
            body,
          );

          if (res.StatusCode !== 100) {
            cleanVenueOdds(PLATFORM);
          } else {
            if (res.Delta != null) delta = res.Delta;
            const now = Date.now();
            for (const block of res.dc ?? []) {
              for (const row of block.v ?? []) {
                for (const ws of row.ws ?? []) {
                  const id = `${ws.si}:${ws.wsi}`;
                  saveVenueOdds(PLATFORM, {
                    id,
                    odds: Number(ws.o) || 0,
                    isLock: Boolean(row.il),
                    time: now,
                  });
                }
              }
            }
            matchStore.refreshOddsOnBets();
          }
        }
      } catch (err) {
        console.warn("[IMT] collect error", err);
        notifyCollectError("IMT", err);
      } finally {
        console.debug(`[IMT]轮询:${Date.now() - started}ms，读取比赛:${matchCount}场`);
        await wait(POLL_MS);
      }
    }
  };

  void poll();

  return () => {
    stopped = true;
  };
}
