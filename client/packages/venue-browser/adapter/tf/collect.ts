import { saveVenueOdds, isVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import type { CollectMatchDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";
import { getStaticVenueGames } from "@changmen/client-core/shared/venueGames";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";

import { useMatchStore } from "../shared/webBridge";
import { a8StartTimeCollectAllowed } from "@changmen/shared/time/match_time";
import {
  buildTfCollectMatchDto,
  collectTfGet,
  loadTfBets,
} from "./markets";
import { compileTfBetNameRegex, selectionOddsId } from "./shared/save_bets";
import { startTfOddsWs } from "./ws";

const PLATFORM = PLATFORMS.TF;
const TF_POLL_MS = 30_000;
/** [A8 可证实] TF/PB 同类：saveMatch 60s 门控 */
const SAVE_MS = 60_000;

function parseTfStartTimeMs(raw: unknown): number {
  if (!raw) return 0;
  const ms = Date.parse(String(raw).replace(" ", "T"));
  return Number.isNaN(ms) ? 0 : ms;
}

/** A8 `h4e` 列表过滤：game_id ∈ games 且 start < now + 3600s */
function tfListEventCollectAllowed(row: Record<string, unknown>): boolean {
  return a8StartTimeCollectAllowed(parseTfStartTimeMs(row.start_datetime));
}

export function startTfCollector(): () => void {
  let stopped = false;
  let stopWs: (() => void) | null = null;
  let lastSaveAt = 0;
  const collect = useCollectStore();
  const matchStore = useMatchStore();

  const start = async () => {
    const platform = await getCollectPlatform(PLATFORM);
    const games = getStaticVenueGames(PLATFORM);
    if (!platform?.Gateway || !platform.Token) {
      console.warn("[TF] 采集跳过：无 Gateway/Token（A8 Client_GetCollectPlatform）");
      return;
    }

    const betRe = compileTfBetNameRegex(platform.BetName);

    stopWs = startTfOddsWs({
      getToken: async () => {
        const wsPlatform = await getCollectPlatform(PLATFORM);
        return wsPlatform?.Token;
      },
      onMessage: (payload) => {
        const data = payload.data;
        if (!data?.selection || !data.market_id) return;

        const marketId = String(data.market_id);
        const now = Date.now();
        for (const sel of data.selection) {
          const id = selectionOddsId(marketId, String(sel.name ?? ""));
          if (!isVenueOdds(PLATFORM, id)) continue;
          saveVenueOdds(PLATFORM, {
            id,
            odds: Number(sel.euro_odds) || 0,
            isLock: sel.status !== "open",
            betId: marketId,
            time: now,
          });
        }
        matchStore.refreshOddsOnBets();
      },
      onError: () => {
        notifyCollectError(PLATFORM, "WebSocket链接发生错误");
      },
    });

    while (!stopped) {
      const started = Date.now();
      let matchCount = 0;
      try {
        const listRes = await collectTfGet<{ results?: Array<Record<string, unknown>> }>(platform, {
          game_id: "",
          timing: "today",
          market_option: "MATCH",
        });

        const list = (listRes.results ?? []).filter((row) => {
          const gid = String(row.game_id ?? "");
          return games.includes(gid) && tfListEventCollectAllowed(row);
        });

        const matchPayload: CollectMatchDto[] = [];
        for (const row of list) {
          const dto = buildTfCollectMatchDto(row);
          if (dto) matchPayload.push(dto);
        }

        if (Date.now() - lastSaveAt > SAVE_MS) {
          const saved = await collect.saveMatch(PLATFORM, matchPayload);
          if (saved)
            lastSaveAt = Date.now();
        }

        for (const row of list) {
          if (stopped) break;
          const matchId = String(row.event_id ?? "");
          const teamNames: [string, string] = [
            String((row.home as Record<string, unknown>)?.team_name ?? ""),
            String((row.away as Record<string, unknown>)?.team_name ?? ""),
          ];
          await loadTfBets(platform, matchId, betRe, teamNames);
          matchCount += 1;
        }
      } catch (err) {
        console.warn("[TF] collect error", err);
        notifyCollectError(PLATFORM, err);
      } finally {
        console.debug(`[TF]比赛列表:${Date.now() - started}ms，读取比赛:${matchCount}场`);
        await wait(TF_POLL_MS);
      }
    }
  };

  void start();

  return () => {
    stopped = true;
    stopWs?.();
  };
}
