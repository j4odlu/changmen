/**
 * IM / XBet 曾经 A8 Socket.IO 聚合（47.115.75.57）收频道推送，已禁用。
 * Stake 实时赔率改走 Chrome 扩展 `stake-odds` 端口（见 `stake/oddsPush.ts`）。
 */

type ChannelHandler = (message: unknown) => void;

/** @deprecated A8 聚合 WS 已移除 */
export const DEFAULT_A8_WS = "";

export async function subscribeA8Channel(
  _channel: string,
  _handler: ChannelHandler,
): Promise<() => void> {
  return () => {};
}
