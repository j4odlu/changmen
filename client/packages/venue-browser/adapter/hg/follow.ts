import { getHgFollowOrders } from "@changmen/client-core/bridge/clientApi";
import { BetOption } from "@changmen/client-core/models/betOption";
import { useAccountStore } from "../shared/webBridge";
import { useUserStore } from "../shared/webBridge";
import type { HgFollowOrder } from "./parse";
import {
  hgBetIdFromOrder,
  hgItemIdFromOrder,
  parseHgFollowOdds,
  parseHgToken,
  recordHgFollowResult,
  shouldSkipHgFollow,
} from "./parse";

const HG = "HG" as const;
const INTERVAL_MS = 1000;
const IDLE_MS = 3000;
const BETTING_IDLE_MS = 10_000;

let stopped = true;
let running = false;

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function parseAgentIds(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function collectFollowOrders(
  agentIds: string[],
  username: string | undefined,
): Promise<HgFollowOrder[]> {
  const seen = new Set<string>();
  const queue: HgFollowOrder[] = [];

  for (const agentId of agentIds) {
    let orders: HgFollowOrder[];
    try {
      orders = (await getHgFollowOrders(agentId)) as HgFollowOrder[];
    } catch {
      continue;
    }
    for (const order of orders) {
      if (seen.has(order.TID)) continue;
      if (username && order.NAME0 === username) continue;
      if (shouldSkipHgFollow(order.TID)) continue;
      seen.add(order.TID);
      queue.push(order);
    }
  }

  return queue;
}

async function tick(): Promise<number> {
  const config = useUserStore().config;
  if (!config.betting) return BETTING_IDLE_MS;

  const accountStore = useAccountStore();
  const account = accountStore.getAccount(
    HG,
    0,
    [],
    (acc) => !!acc.userAgent?.trim(),
  );
  if (!account?.userAgent) return IDLE_MS;

  const token = parseHgToken(account.token);
  if (!token) return IDLE_MS;

  const agentIds = parseAgentIds(account.userAgent);
  if (!agentIds.length) return IDLE_MS;

  const orders = await collectFollowOrders(agentIds, token.username);
  for (const order of orders) {
    const odds = parseHgFollowOdds(order);
    const betMoney = Number(order.GOLD);
    const matchId = String(order._EVENT);
    const betId = hgBetIdFromOrder(order);
    const itemId = hgItemIdFromOrder(order);

    const option = new BetOption(HG, matchId, betId, itemId, betMoney, "Home", odds);
    const check = await accountStore.checkBetting(account, option);
    if (!check.data) continue;

    const result = await accountStore.betting(account, option);
    recordHgFollowResult(order.TID, result.success);
    await wait(INTERVAL_MS);
  }

  return INTERVAL_MS;
}

async function loop() {
  if (stopped || running) return;
  running = true;
  try {
    while (!stopped) {
      const delay = await tick();
      await wait(delay);
    }
  } finally {
    running = false;
  }
}

export function startHgFollowLoop() {
  if (!stopped) return;
  stopped = false;
  void loop();
}

export function stopHgFollowLoop() {
  stopped = true;
}
