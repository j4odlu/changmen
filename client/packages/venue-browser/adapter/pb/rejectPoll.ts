import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { saveUserLog } from "@changmen/client-core/bridge/clientApi";
import type { VenueOrder, VenueOrderStatus } from "../contract";
import { pbGet } from "./transport";
import { wait } from "@changmen/client-core/shared/wait";
import { PLATFORMS } from "../shared/platforms";

const POLL_MS = 1_000;
const MAX_MS = 30_000;

/** 对齐 A8 `SQ` */
export function pbRejectStorageKey(account: PlatformAccount): string {
  return `${PLATFORMS.PB}:${account.accountId}:Order`;
}

function mapMyBetStatus(raw: string): VenueOrderStatus {
  switch (raw) {
    case "PENDING":
      return "pending";
    case "OPEN":
      return "none";
    case "CANCELLED":
    case "REJECTED":
      return "reject";
    default:
      return "none";
  }
}

/** 对齐 A8 `_Q`：PENDING_ACCEPTANCE 后轮询 my-bets */
export async function startPbRejectPoll(account: PlatformAccount, startedAt: number): Promise<void> {
  if (Date.now() - startedAt > MAX_MS) return;

  const storageKey = pbRejectStorageKey(account);
  let row: unknown[] | undefined;
  let statusRaw = "";

  try {
    const path = `/member-service/v2/my-bets?locale=zh_CN&_=${Date.now()}&withCredentials=true`;
    const data = await pbGet<unknown[]>(account, path, {
      "content-type": "application/json; charset=utf-8",
    });
    if (!Array.isArray(data) || data.length === 0) return;

    row = data[0] as unknown[];
    statusRaw = String(row[11] ?? "");
    const orderId = String(row[0] ?? "");
    const multiply = Math.max(1, account.multiply ?? 1);
    const status = mapMyBetStatus(statusRaw);
    const game = String(row[21] ?? "").split(" - ")[0] ?? "";
    const match = String(row[2] ?? "");
    const mapNum = Number(row[35]) || 0;
    const betLabel = mapNum === 0 ? "全场" : `地图${mapNum}`;
    const item = String(row[15] ?? "");
    const odds = Number(row[18]) || 0;
    const createAt = Number(row[12]) || 0;
    const betMoney = (Number(row[42]) || 0) * multiply;

    const pending: VenueOrder = {
      provider: PLATFORMS.PB,
      orderId,
      odds,
      createAt,
      betMoney,
      reward: 0,
      money: 0,
      status,
      game,
      match,
      bet: betLabel,
      item,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
  } finally {
    if (row) {
      const orderId = String(row[0] ?? "");
      void saveUserLog(`[PB] - ${orderId} 拒单检测 => ${statusRaw}`, row).catch(() => {});
    }
    if (statusRaw === "PENDING") {
      await wait(POLL_MS);
      await startPbRejectPoll(account, startedAt);
    }
  }
}
