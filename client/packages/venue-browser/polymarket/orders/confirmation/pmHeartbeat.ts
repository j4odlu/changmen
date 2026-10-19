/**
 * [Polymarket 可证实] CLOB heartbeat：约 10s 无有效心跳会取消该用户全部 open 订单。
 * 当前生产无调用方（GTC 止盈已取消；手动卖为 FOK）。保留供将来挂单类功能复用。
 * @see https://docs.polymarket.com/trading/orders/overview
 * SDK path: POST /v1/heartbeats  body `{ heartbeat_id }`
 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pmPostHeartbeat } from "../pmClientApi";

/** 官方建议约 5s 一次（超时约 10s + 5s buffer） */
export const POLYMARKET_HEARTBEAT_INTERVAL_MS = 5_000;

interface HeartbeatSession {
  account: PlatformAccount;
  heartbeatId: string;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  startedAt: number;
}

const sessions = new Map<number, HeartbeatSession>();

function accountKey(account: PlatformAccount): number | null {
  const id = account.accountId;
  return id == null ? null : Number(id);
}

function extractHeartbeatId(raw: unknown): string {
  if (!raw || typeof raw !== "object")
    return "";
  const row = raw as Record<string, unknown>;
  const id = row.heartbeat_id ?? row.heartbeatId;
  return id == null ? "" : String(id);
}

async function postHeartbeatOnce(
  account: PlatformAccount,
  heartbeatId: string,
): Promise<string> {
  const res = await pmPostHeartbeat(account, heartbeatId);
  return extractHeartbeatId(res) || heartbeatId;
}

async function tickSession(key: number): Promise<void> {
  const session = sessions.get(key);
  if (!session || session.inFlight)
    return;
  session.inFlight = true;
  try {
    session.heartbeatId = await postHeartbeatOnce(session.account, session.heartbeatId);
  }
  catch (err) {
    console.warn(
      `[Polymarket] heartbeat failed account=${key}:`,
      err instanceof Error ? err.message : err,
    );
  }
  finally {
    session.inFlight = false;
  }
}

/** 为账号启动心跳（幂等）。挂 GTC 卖单前应调用。 */
export function ensurePolymarketHeartbeat(account: PlatformAccount): void {
  const key = accountKey(account);
  if (key == null)
    return;

  const existing = sessions.get(key);
  if (existing) {
    existing.account = account;
    return;
  }

  const session: HeartbeatSession = {
    account,
    heartbeatId: "",
    timer: null,
    inFlight: false,
    startedAt: Date.now(),
  };
  sessions.set(key, session);

  void tickSession(key);
  session.timer = setInterval(() => {
    void tickSession(key);
  }, POLYMARKET_HEARTBEAT_INTERVAL_MS);
}

export function stopPolymarketHeartbeat(accountId: number): void {
  const session = sessions.get(accountId);
  if (!session)
    return;
  if (session.timer != null)
    clearInterval(session.timer);
  sessions.delete(accountId);
}

export function stopAllPolymarketHeartbeats(): void {
  for (const id of [...sessions.keys()])
    stopPolymarketHeartbeat(id);
}

/** 测试用 */
export function getPolymarketHeartbeatAccountIdsForTests(): number[] {
  return [...sessions.keys()];
}
