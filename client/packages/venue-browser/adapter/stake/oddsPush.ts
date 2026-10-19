import { a8PluginConnect, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { wait } from "@changmen/client-core/shared/wait";
import type { A8BetsMessage } from "../shared/socket/accumulator";

/** 与 chrome-extension `STAKE_ODDS_PORT` 同名；替代 A8 `join room Stake` */
export const STAKE_ODDS_PORT = "stake-odds";

/**
 * 收插件 GraphQL WS 增量（A8 `n2[Stake]` / `LHe`）。
 * 不连 47.115.75.57。
 */
export function subscribeStakeOddsPush(handler: (message: A8BetsMessage) => void): () => void {
  let stopped = false;
  let port: ReturnType<typeof a8PluginConnect> = null;

  const attach = () => {
    if (stopped) return;
    if (!hasA8PluginRuntime()) {
      void wait(3000).then(attach);
      return;
    }
    port = a8PluginConnect(STAKE_ODDS_PORT);
    if (!port) {
      void wait(2000).then(attach);
      return;
    }
    port.onMessage.addListener((msg: unknown) => {
      const row = msg as { type?: string; message?: A8BetsMessage };
      if (row?.type === "stakeOdds" && row.message) handler(row.message);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      if (!stopped) void wait(1000).then(attach);
    });
  };

  attach();

  return () => {
    stopped = true;
    try {
      port?.disconnect();
    } catch {
      /* already gone */
    }
    port = null;
  };
}
