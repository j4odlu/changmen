import { hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { iaCollectPlatform } from "./a8Collect";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";
import { useUserStore } from "../shared/webBridge";
import { handleIaRealtimeMessage } from "./messages";
import { createIaRealtimeClient, type IaRealtimeClient } from "./realtime";
import { loadIaBets } from "./markets";
import { IA_PLUGIN_REQUIRED_MSG, iaCollectGet } from "./transport";

export { iaMainWinBetKey } from "./shared/save_bets";

const PLATFORM = PLATFORMS.IA;
const POLL_MS = 30_000;

function parseStartTime(raw: unknown): number {
  if (!raw) return Date.now();
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  const ms = Date.parse(String(raw).replace(" ", "T"));
  return Number.isNaN(ms) ? Date.now() : ms;
}

function pickIaTeamId(row: Record<string, unknown>, side: "home" | "away"): string {
  const raw =
    side === "home"
      ? row.team_id_1 ?? row.team_a_id ?? row.home_id ?? row.home_team_id
      : row.team_id_2 ?? row.team_b_id ?? row.away_id ?? row.away_team_id;
  if (raw == null) return "";
  return String(raw).trim();
}

/** A8 `$a.waitForUser()` */
async function waitForIaUser(): Promise<boolean> {
  const user = useUserStore();
  if (!user.userId) {
    await user.fetchUserInfo();
  }
  return Boolean(user.userId);
}

function buildIaMatchDto(row: Record<string, unknown>): CollectMatchDto {
  const homeName = String(
    row.team_name_1 ||
      row.team_a_name ||
      row.home_team_name ||
      row.home_name ||
      row.team1_name ||
      "主队",
  ).trim();
  const awayName = String(
    row.team_name_2 ||
      row.team_b_name ||
      row.away_team_name ||
      row.away_name ||
      row.team2_name ||
      "客队",
  ).trim();
  const homeId = pickIaTeamId(row, "home");
  const awayId = pickIaTeamId(row, "away");

  return {
    Type: PLATFORM,
    SourceMatchID: row.id as string | number,
    SourceGameID: row.game_type_id as string | number,
    BO: Number(row.bo || row.best_of || 0) || 0,
    StartTime: parseStartTime(row.start_time || row.begin_time || row.game_start_time),
    Home: homeName,
    HomeID: homeId,
    Away: awayName,
    AwayID: awayId,
    Teams: [
      {
        Type: PLATFORM,
        GameID: row.game_type_id as string | number,
        Name: homeName,
        TeamID: homeId,
        Logo: "",
      },
      {
        Type: PLATFORM,
        GameID: row.game_type_id as string | number,
        Name: awayName,
        TeamID: awayId,
        Logo: "",
      },
    ],
  };
}

/**
 * A8 `wQe` 行级结构：
 * waitForUser → t → fo + Socket.IO → RoomJoin/roomMessageCallBack → s()/o() 轮询
 * [changmen 扩展] 每轮 poll 后 saveMatch/saveBets 上报服务端（A8 仅写本地 fo）
 */
export function startIaCollector(): () => void {
  let stopped = false;
  let realtime: IaRealtimeClient | null = null;
  let pluginMissingNotified = false;

  const collect = useCollectStore();

  void (async () => {
    if (!(await waitForIaUser()) || stopped) return;

    const t = iaCollectPlatform();
    const betRe = new RegExp(t.BetName);

    realtime = createIaRealtimeClient(t.Gateway);
    await realtime.start(handleIaRealtimeMessage);
    if (stopped) return;

    const loadMatchBets = async (matchId: string): Promise<CollectBetDto[]> => {
      if (!matchId) return [];
      return loadIaBets(t, matchId, betRe);
    };

    const poll = async (): Promise<void> => {
      const started = Date.now();
      let matchCount = 0;
      try {
        if (!hasA8PluginRuntime()) {
          if (!pluginMissingNotified) {
            notifyCollectError("IA", IA_PLUGIN_REQUIRED_MSG);
            pluginMissingNotified = true;
          }
          return;
        }
        pluginMissingNotified = false;

        const listRes = await iaCollectGet<{
          data?: { data?: Array<Record<string, unknown>> };
        }>(t, "/api/game/game/gameListPageSplit/");
        const rawList = listRes.data?.data ?? [];
        const list = rawList.filter((row) =>
          t.Games.includes(String(row.game_type_id ?? "")),
        );

        const matchPayload: CollectMatchDto[] = [];
        const betsByMatch = new Map<string, CollectBetDto[]>();

        for (const row of list) {
          if (stopped) break;
          const matchId = String(row.id ?? "");
          matchCount += 1;
          matchPayload.push(buildIaMatchDto(row));
          const bets = await loadMatchBets(matchId);
          betsByMatch.set(matchId, bets);
        }

        const saved = await collect.saveMatch(PLATFORM, matchPayload);
        if (saved) {
          for (const [mid, bets] of betsByMatch) {
            if (!bets.length) continue;
            await collect.saveBets(PLATFORM, mid, bets);
          }
        }
      } catch (err) {
        console.warn("[IA] collect error", err);
        notifyCollectError("IA", err);
      } finally {
        console.debug(`[IA]比赛列表:${Date.now() - started}ms，读取比赛:${matchCount}场`);
        if (!stopped) {
          await wait(POLL_MS);
          await poll();
        }
      }
    };

    await poll();
  })();

  return () => {
    stopped = true;
    void realtime?.stop();
    realtime = null;
  };
}
