import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import type { PlatformId } from "@/types/esport";
import { opponentSide } from "@changmen/client-core/models/betOption";
import { applyStakeScaleByProfit } from "@/extensions/arbBet/stakeScaleByProfit";
import { buildArbProgressLegPair } from "@/shared/arbProgressLegMeta";
import { useAccountStore } from "@/stores/accountStore";
import { syncActiveBetBegin } from "@/stores/betting/activeBetRunSync";
import { ensureArbExecutionTrace, setArbExecutionTraceMeta } from "@/stores/betting/autoBet/arbProgressTrace";
import { useUserStore } from "@/stores/userStore";
import { filterArbProviderKeys } from "@/types/extensionPrefs";
import { gtcAccountAllows } from "./accountFilter";
import { pickAccount } from "./accountPicker";
import { readGtcUsedAccounts } from "./successMarkers";

const providerPickIndex = new Map<PlatformId, number>();
let pickerOwner = "";
export async function prepareArbAttempt(params: ArbBetAttemptParams): Promise<ArbBetReady | null> {
  const { match, bet, config } = params;
  const accountStore = useAccountStore();
  const user = useUserStore();
  const owner = String(user.userId);
  if (pickerOwner !== owner) {
    providerPickIndex.clear();
    pickerOwner = owner;
  }
  bet.items.forEach(item => item.updateOdds());
  if (!accountStore.loaded || accountStore.accounts.some(account => account.loadingBalance))
    return null;
  if (config.minMoney !== 0 && config.maxMoney !== 0)
    config.betMoney = Math.floor(Math.random() * (config.maxMoney - config.minMoney + 1)) + config.minMoney;
  const threshold = config.betMoneyMode === "total" ? 0 : config.betMoney;
  const funded = accountStore.accounts.filter(account => account.getBalance() != null && account.getBalance()! >= threshold);
  const providers = filterArbProviderKeys([...new Set(funded.map(account => account.provider))], user.extensionPrefs.arbAllowedPlatforms);
  const options = bet.getOrderOptions(match, config, accountStore.accounts, providers);
  if (!options || options.length !== 2)
    return null;
  ensureArbExecutionTrace(params);
  const [legA, legB] = options;
  if ([legA.type, legB.type].filter(type => type === "Polymarket").length !== 1) {
    params.trace?.finish("skip", "GTC 模块仅支持一条 PM 腿的双边套利");
    return null;
  }
  const implied = 1 / options.reduce((sum, option) => sum + 1 / option.odds, 0);
  const stakeScale = applyStakeScaleByProfit(legA, legB, implied, user.extensionPrefs.stakeScaleByProfit);
  const pick = (leg: typeof legA) => {
    // Rotation belongs to this execution path; daily limits use the ordinary account order count.
    const context = { ...accountStore, providerPickIndex };
    const clone = pickAccount(context, leg.type, leg.betMoney, config.noSameBet ? readGtcUsedAccounts(owner, bet.id, opponentSide(leg.target)) : [], account => gtcAccountAllows(account, leg, bet, match, owner, config.noSameBet), options);
    return clone ? accountStore.findAccount(clone.accountId) : undefined;
  };
  const accountA = pick(legA);
  const accountB = pick(legB);
  if (!accountA || !accountB) {
    params.trace?.finish("skip", "GTC 双腿账号未就绪");
    return null;
  }
  const linkId = Date.now();
  setArbExecutionTraceMeta(params.trace, { implied, legs: buildArbProgressLegPair(legA, legB, accountA, accountB) });
  syncActiveBetBegin({ match, bet, legA, legB, accountA, accountB, checkAccountA: accountA, checkAccountB: accountB, linkId, betBothLegs: true });
  return { legA, legB, accountA, accountB, checkAccountA: accountA, checkAccountB: accountB, implied, betBothLegs: true, singleLegByRate: false, linkId, stakeScale };
}
