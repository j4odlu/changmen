import { A8BetsCollector, type A8BetsMessage } from "./accumulator";
import { subscribeA8Channel } from "./hub";
import type { PlatformId } from "@changmen/api-contract";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../collectNotify";
import { useCollectStore } from "../webBridge";
import { useMatchStore } from "../webBridge";

const SAVE_MS = 60_000;
const POLL_MS = 5_000;

export function startA8BetsCollector(opts: {
  platform: PlatformId;
  channel: string;
  homeSuffix: string;
  awaySuffix: string;
  useDirectIds?: boolean;
  /** [A8 可证实] IM/XBet 频道只写 fo，不调 API_SaveBet */
  reportToServer?: boolean;
  extraChannels?: Array<{ channel: string; onMessage: (msg: unknown) => void }>;
}): () => void {
  let stopped = false;
  let lastSaveAt = 0;
  const unsubs: Array<() => void> = [];
  const acc = new A8BetsCollector(opts.platform, {
    homeSuffix: opts.homeSuffix,
    awaySuffix: opts.awaySuffix,
    useDirectIds: opts.useDirectIds,
  });

  const collect = useCollectStore();
  const matchStore = useMatchStore();

  void (async () => {
    unsubs.push(
      await subscribeA8Channel(opts.channel, (msg) => {
        acc.ingest(msg as A8BetsMessage);
        matchStore.refreshOddsOnBets();
      }),
    );
    for (const extra of opts.extraChannels ?? []) {
      unsubs.push(await subscribeA8Channel(extra.channel, extra.onMessage));
    }
  })();

  const reportToServer = opts.reportToServer !== false;

  const poll = async () => {
    while (!stopped) {
      try {
        if (reportToServer && Date.now() - lastSaveAt > SAVE_MS) {
          const { matches, betsByMatch } = acc.buildPayload();
          // [A8 可证实] 60s 组包 saveMatch，matches 可为 []
          const saved = await collect.saveMatch(opts.platform, matches);
          if (saved) {
            for (const [matchId, bets] of betsByMatch) {
              if (bets.length) await collect.saveBets(opts.platform, matchId, bets);
            }
            lastSaveAt = Date.now();
          }
        }
      } catch (err) {
        console.warn(`[${opts.platform}] collect error`, err);
        notifyCollectError(opts.platform, err);
      }
      await wait(POLL_MS);
    }
  };

  void poll();

  return () => {
    stopped = true;
    for (const unsub of unsubs) unsub();
  };
}

/** 供 Stake GraphQL 等 HTTP 快照复用同一 accumulator */
export function createA8BetsCollector(opts: {
  platform: PlatformId;
  homeSuffix: string;
  awaySuffix: string;
  useDirectIds?: boolean;
}) {
  return new A8BetsCollector(opts.platform, opts);
}
