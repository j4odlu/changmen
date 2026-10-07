/**
 * 足球板双击 Polymarket 赔率 → 手动输入 RMB 金额，用 POD tab 里显式选择的 PM 账号下注。
 * 不进电竞 mainBetLoop / fo。
 */
import { BetOption } from "@changmen/client-core/models/betOption";
import type { BetSide } from "@changmen/client-core/models/match";
import { ElMessage } from "element-plus";
import { ensurePmFootballAccountsHaveVaultKeys, listPmFollowAccounts } from "@/runtime/podPmFollowPlace";
import { readPodBetSettings } from "@/runtime/podBetSettings";
import {
  promptSportBoardStake,
  sportBoardMarketLabel,
  sportBoardSideLabel,
} from "@/runtime/obSportBoardPlace";
import { useAccountStore } from "@/stores/accountStore";
import { useFootballOrderStore } from "@/stores/footballOrderStore";

const PM = "Polymarket" as const;

export type PmSportBoardPlaceInput = {
  oid: string;
  /** PM provider match id；展示/兜底用。 */
  venueMid?: string;
  /** PM condition_id / SourceBetID，下单后 user ws 订阅用。 */
  betId?: string;
  odds: number;
  boardSide?: string;
  marketCode?: string;
  line?: number | null;
  home?: string;
  away?: string;
};

let placing = false;

function pmSideFromBoardSide(side: string | undefined): BetSide | null {
  const s = String(side || "").trim().toLowerCase();
  if (s === "home" || s === "over")
    return "Home";
  if (s === "away" || s === "under")
    return "Away";
  return null;
}

function selectedPmAccountIds(ids: unknown): number[] {
  return Array.isArray(ids)
    ? ids.map(id => Math.round(Number(id) || 0)).filter(id => id > 0)
    : [];
}

export function formatPmSportBoardPlaceTitle(input: PmSportBoardPlaceInput): string {
  const side = sportBoardSideLabel(input.boardSide);
  const market = sportBoardMarketLabel(input.marketCode, input.line);
  const odds = Number(input.odds) > 0 ? Number(input.odds) : 0;
  const teams = [input.home, input.away].filter(Boolean).join(" vs ");
  const head = [teams, market, side].filter(Boolean).join(" · ");
  return odds > 0 ? `${head} @ ${odds}` : head;
}

export async function placePmSportBoardBet(
  input: PmSportBoardPlaceInput,
): Promise<{ ok: boolean; message: string }> {
  const tokenId = String(input.oid || "").trim();
  const conditionId = String(input.betId || "").trim();
  const odds = Number(input.odds) || 0;
  if (!tokenId)
    return { ok: false, message: "无 PM token" };
  if (!conditionId)
    return { ok: false, message: "无 PM condition_id" };
  if (conditionId === tokenId)
    return { ok: false, message: "PM condition_id 异常，请刷新足球列表后重试" };
  if (!(odds > 0))
    return { ok: false, message: "锁盘或无赔率" };

  const side = pmSideFromBoardSide(input.boardSide);
  if (!side)
    return { ok: false, message: "PM 暂不支持平局手动下单" };

  const settings = readPodBetSettings();
  const accountIds = selectedPmAccountIds(settings.pmFollowAccountIds);
  if (!accountIds.length)
    return { ok: false, message: "请先在 POD 跟单 tab 选择 PM 账号" };

  const vaultBlock = await ensurePmFootballAccountsHaveVaultKeys();
  if (vaultBlock)
    return { ok: false, message: vaultBlock };

  const accountStore = useAccountStore();
  const accounts = listPmFollowAccounts(accountStore.accounts, accountIds);
  if (!accounts.length)
    return { ok: false, message: "未找到已选择的 PM 账号" };

  if (placing)
    return { ok: false, message: "下单中" };

  const title = formatPmSportBoardPlaceTitle(input);
  const stake = await promptSportBoardStake({
    title,
    defaultStake: Number(settings.pmStake) || 0,
    accountCount: accounts.length,
    venue: PM,
  });
  if (!(stake && stake > 0))
    return { ok: false, message: "已取消" };

  placing = true;
  const orders = useFootballOrderStore();
  const okNotes: string[] = [];
  const failNotes: string[] = [];
  const at = Date.now();
  const market = sportBoardMarketLabel(input.marketCode, input.line);
  const sideText = sportBoardSideLabel(input.boardSide);
  const matchId = String(input.venueMid || conditionId).trim();
  try {
    for (const account of accounts) {
      const accountId = Number(account.accountId) || 0;
      const label = String(account.playerName || accountId || "PM账号").trim() || "PM账号";
      const option = new BetOption(PM, matchId, conditionId, tokenId, stake, side, odds);
      const checked = await accountStore.checkBetting(account, option, { pmQuoteScope: "sport" });
      if (!checked.data) {
        failNotes.push(`${label}:${checked.checkError || "预检失败"}`);
        continue;
      }
      const result = await accountStore.betting(account, checked, 0, { requirePreparedQuote: true });
      if (!result.success) {
        failNotes.push(`${label}:${result.message || "下单失败"}`);
        continue;
      }
      const orderId = String(result.orderId || "").trim();
      await orders.appendVenuePlaced({
        id: `board:${PM}:${conditionId}:${tokenId}:${at}${accountId ? `#${accountId}` : ""}`,
        orderId,
        at,
        home: String(input.home || "").trim(),
        away: String(input.away || "").trim(),
        sideLabel: sideText,
        marketLabel: market,
        odds: Number(checked.newOdds) > 1 ? Number(checked.newOdds) : odds,
        stake,
        oid: tokenId,
        obMid: conditionId,
        auto: false,
        status: result.pending ? "Pending" : "None",
        profit: 0,
        venue: PM,
        playerId: accountId,
        accountName: label,
      }, account, { venue: PM, hydrateOb: false, source: "football-board" });
      okNotes.push(orderId ? `${label}:${orderId}` : label);
    }
  }
  finally {
    placing = false;
  }

  if (!okNotes.length)
    return { ok: false, message: failNotes.join("；") || "PM 下单失败" };
  const head = `PM 已下 ${okNotes.length}/${accounts.length}`;
  const msg = failNotes.length
    ? `${head} ${okNotes.join("、")}；失败 ${failNotes.join("；")}`
    : `${head} ${okNotes.join("、")}`;
  return { ok: true, message: msg.slice(0, 180) };
}

export async function confirmPlacePmSportBoardBet(input: PmSportBoardPlaceInput): Promise<void> {
  const result = await placePmSportBoardBet(input);
  if (result.message === "已取消")
    return;
  if (result.ok)
    ElMessage.success(result.message);
  else
    ElMessage.warning(result.message);
}
