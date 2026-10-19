import { wait } from "@changmen/client-core/shared/wait";
import {
  ensureChangmenHubConnected,
  leaveChangmenChannel,
  publishChangmenChannel,
  subscribeChangmenChannel,
} from "@changmen/venue-browser/adapter/shared";

/**
 * [changmen 实现] 自研 realtime-hub pub/sub 客户端（BetTarget / 操盘 / 跟单）
 * 频道名与 A8 bundle GoEasy pub/sub 对齐；不经第三方 GoEasy SaaS。
 */

const channelCleanups = new Map<string, () => void>();
const channelHandlers = new Map<string, Set<(content: string) => void>>();

function contentToString(content: unknown): string {
  if (typeof content === "string")
    return content;
  if (content == null)
    return "";
  try {
    return JSON.stringify(content);
  }
  catch {
    return String(content);
  }
}

function dispatchChannelMessage(channel: string, content: unknown) {
  const handlers = channelHandlers.get(channel);
  if (!handlers)
    return;
  const text = contentToString(content);
  for (const fn of handlers)
    fn(text);
}

/** 对齐 A8 `W8e`：连接 changmen realtime-hub */
export function ensurePubsubConnected(): Promise<void> {
  return ensureChangmenHubConnected().then((ok) => {
    if (!ok)
      throw new Error("realtime hub 连接失败");
  });
}

/** 对齐 A8 `lv` */
export async function pubsubSubscribe(
  channel: string,
  onMessage: (content: string) => void,
): Promise<void> {
  await ensurePubsubConnected();

  let set = channelHandlers.get(channel);
  if (!set) {
    set = new Set();
    channelHandlers.set(channel, set);
  }
  set.add(onMessage);

  if (!channelCleanups.has(channel)) {
    const cleanup = await subscribeChangmenChannel(channel, (msg) => {
      dispatchChannelMessage(channel, msg);
    });
    channelCleanups.set(channel, cleanup);
  }
}

export function pubsubUnsubscribe(channel: string) {
  channelHandlers.delete(channel);
  const cleanup = channelCleanups.get(channel);
  if (cleanup) {
    cleanup();
    channelCleanups.delete(channel);
  }
  else {
    leaveChangmenChannel(channel);
  }
}

/** 对齐 A8 `ax` */
export function pubsubPublish(channel: string, message: string): Promise<boolean> {
  return publishChangmenChannel(channel, message);
}

const replyWaiters = new Map<string, unknown>();

/** 对齐 A8 `L8e` */
export function pubsubSetReply(msgId: string, content: unknown) {
  replyWaiters.set(msgId, content);
}

/** 对齐 A8 `U8e`：发布并等待对端经 reply 频道回传 msgId */
export async function pubsubRequestReply(
  channel: string,
  msgId: string,
  payload: string,
  timeoutMs = 3000,
): Promise<unknown> {
  if (!(await pubsubPublish(channel, payload)))
    return undefined;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (replyWaiters.has(msgId)) {
      const value = replyWaiters.get(msgId);
      replyWaiters.delete(msgId);
      return value;
    }
    await wait(10);
  }
  return undefined;
}

export function newMsgId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
