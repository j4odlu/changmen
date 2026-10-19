import { saveVenueOdds, cleanVenueOdds, updateVenueBetLock } from "@changmen/client-core/bridge/oddsAccess";
import { io, type Socket } from "socket.io-client";
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import { fetchSabaEsportsPage } from "./parse";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";
import { getStaticVenueGames } from "@changmen/client-core/shared/venueGames";
import {
  buildSabaWsConfig,
  convertMalaysianToEU,
  decodePairMessage,
  normalizeSabaMatch,
  normalizeSabaOdds,
  parseEsportsPage,
  SABA_SUBSCRIBE_ODDS,
  type SabaMatchRow,
  type SabaOddsRow,
} from "./parse";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";

import { useMatchStore } from "../shared/webBridge";

const PLATFORM = PLATFORMS.SABA;
const CHECKIN_MS = 3_000;
const RECONNECT_MS = 5_000;
const WS_MAX_MS = 300_000;
const SABA_CACHE_KEY = "SABA:CONTENT";

export function startSabaCollector(): () => void {
  let stopped = false;
  let loopPromise: Promise<void> | null = null;
  const collect = useCollectStore();
  const matchStore = useMatchStore();

  const runOnce = async () => {
    const platform = await getCollectPlatform(PLATFORM);
    const games = getStaticVenueGames(PLATFORM);
    if (!platform?.Gateway || !platform.Token) {
      console.warn("[SABA] 采集跳过：无 Gateway/Token");
      cleanVenueOdds(PLATFORM);
      await wait(60_000);
      return;
    }
    const session = {
      gateway: platform.Gateway,
      token: platform.Token,
    };

    let html = sessionStorage.getItem(SABA_CACHE_KEY) ?? "";
    if (!html) {
      html = await fetchSabaEsportsPage(session);
      sessionStorage.setItem(SABA_CACHE_KEY, html);
    }

    const parsed = parseEsportsPage(html, session.gateway);
    if (!parsed) {
      sessionStorage.removeItem(SABA_CACHE_KEY);
      console.warn("[SABA] 页面解析失败");
      await wait(60_000);
      return;
    }

    const wsConfig = buildSabaWsConfig(parsed, session);
    const matchRows = new Map<string, SabaMatchRow>();
    const oddRows = new Map<string, SabaOddsRow>();
    const leagueRows = new Map<string, Record<string, unknown>>();
    const fieldMap: Record<number, string> = {};

    await new Promise<void>((resolve) => {
      let checkinTimer: ReturnType<typeof setInterval> | null = null;
      const wsUrl = wsConfig.wsHost.startsWith("wss://")
        ? wsConfig.wsHost
        : `wss://${wsConfig.wsHost}`;
      const started = Date.now();

      const socket: Socket = io(wsUrl, {
        transports: ["websocket"],
        withCredentials: true,
        extraHeaders: { Origin: wsConfig.origin },
        query: {
          gid: wsConfig.gid,
          token: wsConfig.token,
          id: wsConfig.id,
          rid: wsConfig.rid,
          ext: String(wsConfig.ext),
        },
      });

      const cleanup = () => {
        if (checkinTimer) clearInterval(checkinTimer);
        socket.removeAllListeners();
        socket.disconnect();
        resolve();
      };

      if (stopped) {
        cleanup();
        return;
      }

      socket.on("connect", () => {
        socket.emit("init", {
          gid: wsConfig.gid,
          token: wsConfig.token,
          id: wsConfig.id,
          rid: wsConfig.rid,
          ext: wsConfig.ext,
          dr: "transport close",
          rc: 1,
          v: 2,
        });
      });

      socket.on("init", () => {
        socket.emit("subscribe", SABA_SUBSCRIBE_ODDS);
        checkinTimer = setInterval(() => {
          void fetch(wsConfig.checkinUrl, { method: "POST", headers: { username: "" } }).catch(
            () => {},
          );
        }, CHECKIN_MS);
      });

      socket.on("err", () => {
        sessionStorage.removeItem(SABA_CACHE_KEY);
        cleanup();
      });

      socket.on("disconnect", () => {
        cleanVenueOdds(PLATFORM);
        cleanup();
      });

      socket.on("m", (_type: unknown, batches: unknown) => {
        if (!Array.isArray(batches)) return;
        for (const batch of batches) {
          handleBatch(batch as unknown[]);
        }
        if (Date.now() - started > WS_MAX_MS) {
          socket.disconnect();
        }
      });

      const handleBatch = (batch: unknown[]) => {
        if (!Array.isArray(batch)) return;
        const [head, ...rest] = batch;
        if (head === "f") {
          const [baseIndex, names] = rest;
          if (Array.isArray(names)) {
            names.forEach((name, idx) => {
              fieldMap[Number(baseIndex) + idx] = String(name);
            });
          }
          return;
        }
        if (head !== 0) return;
        const [cmd, ...payload] = rest;
        switch (cmd) {
          case "reset":
            matchRows.clear();
            oddRows.clear();
            break;
          case "done":
            void flushSave();
            break;
          case "l": {
            const row = decodePairMessage(payload, fieldMap);
            const leagueId = row.leagueid;
            if (leagueId) {
              const id = String(leagueId);
              leagueRows.set(id, { ...leagueRows.get(id), ...row });
            }
            break;
          }
          case "m": {
            const row = decodePairMessage(payload, fieldMap) as SabaMatchRow;
            if (row.matchid) {
              const id = String(row.matchid);
              const merged = { ...matchRows.get(id), ...row };
              if (merged.leagueid) {
                const league = leagueRows.get(String(merged.leagueid));
                const gameId = league?.leaguegroupid;
                if (gameId) merged.gameId = gameId as string | number;
              }
              matchRows.set(id, merged);
            }
            break;
          }
          case "o": {
            const row = decodePairMessage(payload, fieldMap) as SabaOddsRow;
            if (row.oddsid) {
              const id = String(row.oddsid);
              oddRows.set(id, { ...oddRows.get(id), ...row });
              const locked = row.oddsstatus !== "running";
              const now = Date.now();
              if (row.odds1a != null) {
                saveVenueOdds(PLATFORM, {
                  id: `${row.oddsid}:Home`,
                  odds: convertMalaysianToEU(row.odds1a),
                  isLock: locked,
                  betId: id,
                  time: now,
                });
              }
              if (row.odds2a != null) {
                saveVenueOdds(PLATFORM, {
                  id: `${row.oddsid}:Away`,
                  odds: convertMalaysianToEU(row.odds2a),
                  isLock: locked,
                  betId: id,
                  time: now,
                });
              }
              matchStore.refreshOddsOnBets();
            }
            break;
          }
          case "-o": {
            const row = decodePairMessage(payload, fieldMap) as SabaOddsRow;
            if (row.oddsid) updateVenueBetLock(PLATFORM, String(row.oddsid), true);
            break;
          }
          default:
            break;
        }
      };

      const flushSave = async () => {
        const matchPayload: CollectMatchDto[] = [];
        const betsByMatch = new Map<string, CollectBetDto[]>();

        for (const row of matchRows.values()) {
          const normalized = normalizeSabaMatch(row, games);
          if (!normalized) continue;
          matchPayload.push({
            Type: PLATFORM,
            SourceMatchID: normalized.matchId,
            SourceGameID: normalized.gameId,
            StartTime: normalized.startTime,
            Home: normalized.homeName,
            HomeID: normalized.homeId,
            Away: normalized.awayName,
            AwayID: normalized.awayId,
            Teams: [
              {
                Type: PLATFORM,
                GameID: normalized.gameId,
                Name: normalized.homeName,
                TeamID: normalized.homeId,
                Logo: `https://esports.egmscentral.net/(S(ESportWeb2grh4bkvz4quqeosmtetdiri1))/(S(ESportWeb2grh4bkvz4quqeosmtetdiri1))/ESportsWeb/GetLogoImage?type=t&id=${normalized.homeId}&ha=h`,
              },
              {
                Type: PLATFORM,
                GameID: normalized.gameId,
                Name: normalized.awayName,
                TeamID: normalized.awayId,
                Logo: `https://esports.egmscentral.net/(S(ESportWeb2grh4bkvz4quqeosmtetdiri1))/(S(ESportWeb2grh4bkvz4quqeosmtetdiri1))/ESportsWeb/GetLogoImage?type=t&id=${normalized.awayId}&ha=a`,
              },
            ],
          });

          const bets: CollectBetDto[] = [];
          for (const odd of oddRows.values()) {
            if (String(odd.matchid) !== normalized.matchId) continue;
            const stage = normalizeSabaOdds(odd, normalized);
            if (!stage) continue;
            bets.push({
              Type: PLATFORM,
              SourceMatchID: normalized.matchId,
              SourceBetID: stage.marketId,
              Map: stage.stageId,
              BetName: stage.betName,
              SourceHomeID: stage.homeId,
              HomeName: normalized.homeName,
              HomeOdds: stage.homeOdds,
              SourceAwayID: stage.awayId,
              AwayName: normalized.awayName,
              AwayOdds: stage.awayOdds,
              Status: stage.locked ? "Locked" : "Normal",
            });
          }
          if (bets.length) betsByMatch.set(normalized.matchId, bets);
        }

        const saved = await collect.saveMatch(PLATFORM, matchPayload);
        if (saved) {
          await Promise.all(
            [...betsByMatch.entries()].map(([matchId, bets]) =>
              collect.saveBets(PLATFORM, matchId, bets),
            ),
          );
        }
      };
    });
  };

  loopPromise = (async () => {
    while (!stopped) {
      try {
        await runOnce();
      } catch (err) {
        console.warn("[SABA] collect error", err);
        notifyCollectError("SABA", err);
        sessionStorage.removeItem(SABA_CACHE_KEY);
      }
      if (!stopped) await wait(RECONNECT_MS);
    }
  })();

  return () => {
    stopped = true;
    void loopPromise;
  };
}
