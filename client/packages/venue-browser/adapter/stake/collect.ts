import { a8PluginSend, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import { cleanStakeBets, collectStakeSportViaPlugin, stakeSportSlugs } from "./graphql";
import { applyStakeLiveOdds } from "./liveOdds";
import { subscribeStakeOddsPush } from "./oddsPush";
import { getStakeTabIdCached, setStakeTabIdCached, stakeTabIdHint, waitForStakeTabId } from "./tabId";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";
import { useMatchStore } from "../shared/webBridge";
import { useUserStore } from "../shared/webBridge";

const LOOP_MS = 30_000;

/** A8 `Ua.waitForUser()` */
async function waitForStakeUser(): Promise<void> {
  const user = useUserStore();
  if (!user.userId)
    await user.fetchUserInfo();
}

/** 对齐 A8 `LHe` / `n2[Stake]` */
function registerStakeOddsHandler(matchStore: ReturnType<typeof useMatchStore>) {
  return subscribeStakeOddsPush((msg) => {
    applyStakeLiveOdds(msg);
    matchStore.refreshOddsOnBets();
  });
}

/**
 * 对齐 A8 `oZ` / `MQ`：
 * waitForUser → LHe → tabId（10×3s）→ collect.get(Stake) → GraphQL → saveMatch/saveBets → 插件订阅。
 * HTTP 快照经 `UHe`/`Mi.send` 等价路径写 fo；WS 增量经 `stake-odds`（不连 47.115.75.57）。
 */
export function startStakeCollector(): () => void {
  let stopped = false;
  let socketRegistered = false;
  const unsubs: Array<() => void> = [];

  const collect = useCollectStore();
  const matchStore = useMatchStore();

  const runCycle = async () => {
    while (!collect.ready) {
      if (stopped) return;
      await wait(500);
    }

    await waitForStakeUser();

    if (!socketRegistered) {
      unsubs.push(registerStakeOddsHandler(matchStore));
      socketRegistered = true;
    }

    if (!hasA8PluginRuntime()) {
      notifyCollectError("Stake", stakeTabIdHint());
      return;
    }

    let tabId = getStakeTabIdCached();
    if (!tabId)
      tabId = await waitForStakeTabId();
    if (!tabId) {
      notifyCollectError("Stake", stakeTabIdHint());
      return;
    }

    // [A8 可证实] oZ：`if(!f1.config.collect.get(Ws))return` — 仍保留 tabId / LHe
    if (!collect.collect.get(PLATFORMS.Stake))
      return;

    const matches = [];
    const subscribe: Array<{ id: string; slug: string }> = [];
    const betsToSave: Array<{ matchId: string | number; bets: CollectBetDto[] }> = [];

    for (const slug of stakeSportSlugs()) {
      const { rows, subscribe: subRows } = await collectStakeSportViaPlugin(tabId, slug);
      for (const row of rows) {
        matches.push(row.match);
        betsToSave.push({ matchId: row.match.SourceMatchID, bets: row.bets });
      }
      subscribe.push(...subRows);
    }

    // [A8 可证实] oZ：空 e 仍 saveMatch，再逐场 saveBets(n.Bets??[])，bf.clean(e)
    await collect.saveMatch(PLATFORMS.Stake, matches);
    for (const { matchId, bets } of betsToSave)
      await collect.saveBets(PLATFORMS.Stake, matchId, bets);

    // [A8 可证实] 空 subscribe 仍 sendMessage，Pn 会退订已下线场次
    await a8PluginSend({
      type: "",
      data: subscribe,
      options: { tabId },
    });

    cleanStakeBets(matches);
    matchStore.refreshOddsOnBets();
  };

  const loop = async () => {
    while (!stopped) {
      try {
        await runCycle();
      } catch (err) {
        console.warn("[Stake] collect error", err);
        notifyCollectError("Stake", err);
        setStakeTabIdCached(undefined);
      }
      await wait(LOOP_MS);
    }
  };

  void loop();

  return () => {
    stopped = true;
    for (const unsub of unsubs) unsub();
  };
}
