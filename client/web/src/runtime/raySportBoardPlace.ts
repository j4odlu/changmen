/** [changmen 扩展] 足球板 RAY 双击手动下注，使用独立体育订单回查。 */
import { ElMessage } from "element-plus";
import type { PmSportBoardPlaceInput } from "@/runtime/pmSportBoardPlace";
import { readPodBetSettings } from "@/runtime/podBetSettings";
import { listRayFollowAccounts, placePodRayFollowBet } from "@/runtime/podRayFollowPlace";
import { promptSportBoardStake, sportBoardMarketLabel, sportBoardSideLabel } from "@/runtime/obSportBoardPlace";
import { useAccountStore } from "@/stores/accountStore";
import type { PodMarketSide } from "@/runtime/podMarketMatch";

export async function confirmPlaceRaySportBoardBet(input: PmSportBoardPlaceInput): Promise<void> {
  const settings = readPodBetSettings();
  const accounts = listRayFollowAccounts(useAccountStore().accounts, settings.rayFollowAccountIds);
  if (!accounts.length) { ElMessage.warning("请先在足球设置选择 RAY 跟单账号"); return; }
  const marketLabel = sportBoardMarketLabel(input.marketCode, input.line);
  const sideLabel = sportBoardSideLabel(input.boardSide);
  const stake = await promptSportBoardStake({ title: `${input.home} vs ${input.away} · ${marketLabel} · ${sideLabel} @ ${input.odds}`,
    venue: "RAY", defaultStake: settings.rayStake, accountCount: accounts.length });
  if (!stake) return;
  const result = await placePodRayFollowBet({ id: `board:RAY:${input.venueMid}:${input.oid}:${Date.now()}`,
    rayMatchId: String(input.venueMid || ""), fixtureStatus: "matched", stake,
    accountIds: settings.rayFollowAccountIds, home: input.home, away: input.away, sideLabel, marketLabel, auto: false,
    market: { status: "matched", venue: "RAY", locked: !(input.odds > 1), oid: input.oid, betId: String(input.betId || ""),
      quote: input.odds, marketCode: String(input.marketCode || ""), boardSide: input.boardSide as PodMarketSide,
      boardLine: input.line ?? null, fromLive: false },
    quote: { status: "ok", quote: input.odds, minObOdds: input.odds, maxObOdds: 0, evPercent: 0 } });
  if (result.ok) ElMessage.success(result.message); else ElMessage.warning(result.message);
}
