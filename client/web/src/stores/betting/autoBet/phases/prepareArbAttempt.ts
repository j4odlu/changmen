import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import type { PlatformId } from "@/types/esport";
import {
  allowArbBetExecution,
  arbAccountPickerFilter,
  createArbLinkId,
  explainAllowArbRejection,
  explainMissingLegAccount,
  resolveSingleLegByRate,
  resolveSingleLegCheckAccounts,
} from "@/domain/betting/singleLegRate";
import { opponentSide } from "@changmen/client-core/models/betOption";
import { applyStakeScaleByProfit } from "@/extensions/arbBet/stakeScaleByProfit";
import {
  applyValueBetMoneyTo9999LiveLeg,
  resolve9999LiveSide,
} from "@/extensions/arbBet/singleLeg9999Stake";
import {
  getSingleLeg9999MapCountForKeys,
  hasSingleLeg9999OppositeSourceSide,
  releaseSingleLeg9999MapFillKeys,
  reserveSingleLeg9999MapFillKeys,
  singleLeg9999MapKey,
  singleLeg9999SourceMarketKey,
  singleLeg9999SourceSideKey,
} from "@/extensions/arbBet/singleLeg9999MapCount";
import { formatLegAccount } from "@/shared/arbBetTraceFormat";
import { buildArbProgressLegPair } from "@/shared/arbProgressLegMeta";
import { accountsFundingReady } from "@/stores/account/accountPicker";
import { useAccountStore } from "@/stores/accountStore";
import { ensureArbExecutionTrace, setArbExecutionTraceMeta } from "@/stores/betting/autoBet/arbProgressTrace";
import { syncActiveBetBegin } from "@/stores/betting/activeBetRunSync";
import { readUsedAccounts } from "@/stores/betting/successMarkers";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useMatchStore } from "@/stores/matchStore";
import { filterArbProviderKeys } from "@/types/extensionPrefs";
import { useUserStore } from "@/stores/userStore";

/** 选腿、选号、比例 9999 单边 / linkId；失败时 return null（A8 静默 continue） */
export async function prepareArbAttempt(
  params: ArbBetAttemptParams,
): Promise<ArbBetReady | null> {
  const { match, bet, config } = params;
  const matchStore = useMatchStore();
  const accountStore = useAccountStore();
  const loseStore = useLoseOrderStore();
  const userStore = useUserStore();

  bet.items.forEach(item => item.updateOdds());

  const accounts = accountStore.accounts;

  if (!accountsFundingReady(accountStore)) {
    return null;
  }

  if (loseStore.orders.has(bet.id)) {
    return null;
  }

  // [A8 可证实] 每个 bet 循环内 roll（非每轮一次）
  if (config.minMoney !== 0 && config.maxMoney !== 0) {
    config.betMoney
      = Math.floor(Math.random() * (config.maxMoney - config.minMoney + 1)) + config.minMoney;
  }

  const funded = [...accountStore.getProviders(config.betMoneyMode === "total" ? 0 : config.betMoney).keys()] as PlatformId[];
  // [changmen 扩展] 扩展 Tab 套利场馆白名单；null = 不限制（现网）
  const providerKeys = filterArbProviderKeys(funded, userStore.extensionPrefs.arbAllowedPlatforms);

  const options = bet.getOrderOptions(match, config, accounts, providerKeys);
  if (!options || options.length !== 2) {
    return null;
  }

  ensureArbExecutionTrace(params);
  const trace = params.trace;

  const legA = options[0];
  const legB = options[1];
  const implied = 1 / options.reduce((sum, o) => sum + 1 / o.odds, 0);
  // [changmen 扩展] 高利润加仓：仅放大两腿注码，不改 config.betMoney / 对冲比例
  const stakeScale = applyStakeScaleByProfit(
    legA,
    legB,
    implied,
    userStore.extensionPrefs.stakeScaleByProfit,
  );
  const detectionLegs = buildArbProgressLegPair(legA, legB);
  setArbExecutionTraceMeta(trace, {
    implied,
    homeLine: `${legA.type}@${legA.odds}`,
    awayLine: `${legB.type}@${legB.odds}`,
    legs: detectionLegs,
  });
  trace?.event("检测", `平台 ${providerKeys.join("、")}`);
  if (stakeScale !== 1) {
    const scalePrefs = userStore.extensionPrefs.stakeScaleByProfit;
    const scaleDetail = scalePrefs.skipAccountRateOnScale
      ? `利润达阈值，注码 ×${stakeScale}（忽略账号比例）`
      : `利润达阈值，注码 ×${stakeScale}`;
    trace?.event("加仓", scaleDetail);
  }

  // [A8 可证实] `lBe`：GetOrderOptions 后立即 `linkId=Date.now()`（9999 扩展再取负）
  const linkTs = Date.now();

  const accountA = accountStore.getAccount(
    legA.type,
    legA.betMoney,
    config.noSameBet ? readUsedAccounts(bet.id, opponentSide(legA.target)) : [],
    acc => arbAccountPickerFilter(acc, bet, match, legA, matchStore, implied),
    options,
  );
  const accountB = accountStore.getAccount(
    legB.type,
    legB.betMoney,
    config.noSameBet ? readUsedAccounts(bet.id, opponentSide(legB.target)) : [],
    acc => arbAccountPickerFilter(acc, bet, match, legB, matchStore, implied),
    options,
  );
  if (!accountA && !accountB) {
    trace?.finish("fail", "无可用账号");
    return null;
  }

  if (accountA) {
    trace?.event("选号", `${legA.target} ${formatLegAccount(legA.type, accountA.playerName)}`);
  }
  if (accountB) {
    trace?.event("选号", `${legB.target} ${formatLegAccount(legB.type, accountB.playerName)}`);
  }
  setArbExecutionTraceMeta(trace, {
    legs: buildArbProgressLegPair(legA, legB, accountA, accountB, undefined, detectionLegs),
  });

  const betBothLegs = Boolean(accountA) && Boolean(accountB);
  const excludeA = config.noSameBet ? readUsedAccounts(bet.id, opponentSide(legA.target)) : [];
  const excludeB = config.noSameBet ? readUsedAccounts(bet.id, opponentSide(legB.target)) : [];
  const singleLegByRate = resolveSingleLegByRate({
    betBothLegs,
    accountA,
    accountB,
    legA,
    legB,
    bet,
    match,
    accounts: accountStore.accounts,
    excludeA,
    excludeB,
    matchStore,
    implied,
  });

  if (!allowArbBetExecution(betBothLegs, singleLegByRate)) {
    const missingAReason = accountA
      ? undefined
      : explainMissingLegAccount(
          legA,
          bet,
          match,
          accounts,
          excludeA,
          matchStore,
          implied,
        );
    const missingBReason = accountB
      ? undefined
      : explainMissingLegAccount(
          legB,
          bet,
          match,
          accounts,
          excludeB,
          matchStore,
          implied,
        );
    trace?.finish(
      "skip",
      explainAllowArbRejection({
        betBothLegs,
        singleLegByRate,
        accountA,
        accountB,
        legA,
        legB,
        missingAReason,
        missingBReason,
      }),
    );
    return null;
  }

  let singleLeg9999MapReserved = false;
  let singleLeg9999MapKeys: string[] | undefined;
  if (singleLegByRate) {
    trace?.event("模式", "比例 9999 单边（本侧仅预检不下单）");
    const prefs = userStore.extensionPrefs;
    const maxPerMap = Number(prefs.singleLeg9999MaxPerMap) || 1;
    const liveSide = resolve9999LiveSide(accountA, accountB);
    const liveLeg = liveSide === "A" ? legA : liveSide === "B" ? legB : undefined;
    const liveSourceKey = liveLeg
      ? singleLeg9999SourceMarketKey(liveLeg.type, liveLeg.matchId, liveLeg.betId)
      : null;
    const liveSideKey = singleLeg9999SourceSideKey(liveSourceKey, liveLeg?.target ?? "");
    if (liveLeg && hasSingleLeg9999OppositeSourceSide(liveSourceKey, liveLeg.target)) {
      trace?.finish("skip", "9999 同盘口已下过对侧");
      return null;
    }
    singleLeg9999MapKeys = [
      singleLeg9999MapKey(match.id, bet.round),
      singleLeg9999SourceMarketKey(legA.type, legA.matchId, legA.betId),
      singleLeg9999SourceMarketKey(legB.type, legB.matchId, legB.betId),
      liveSideKey,
    ].filter(Boolean) as string[];
    const mapCount = getSingleLeg9999MapCountForKeys(singleLeg9999MapKeys);
    if (mapCount >= maxPerMap) {
      trace?.finish("skip", `9999 同图次数已满（${mapCount}/${maxPerMap}）`);
      return null;
    }
    singleLeg9999MapReserved = reserveSingleLeg9999MapFillKeys(singleLeg9999MapKeys, maxPerMap);
    if (!singleLeg9999MapReserved) {
      trace?.finish("skip", `9999 同图次数已满（${maxPerMap}/${maxPerMap}）`);
      return null;
    }
    const stake = applyValueBetMoneyTo9999LiveLeg({
      singleLegByRate,
      enabled: prefs.singleLeg9999UseValueBetMoney === true,
      config,
      legA,
      legB,
      liveSide,
    });
    if (stake != null) {
      trace?.event("注码", `9999 真下单腿改用正EV金额 ¥${stake}`);
      const liveAcc = liveSide === "A" ? accountA : accountB;
      const bal = liveAcc?.getBalance();
      if (bal !== undefined && liveLeg && bal < liveLeg.betMoney) {
        releaseSingleLeg9999MapFillKeys(singleLeg9999MapKeys);
        trace?.finish(
          "fail",
          `正EV金额余额不足（${Math.floor(bal)} < ${Math.ceil(liveLeg.betMoney)}）`,
        );
        return null;
      }
    }
  }

  const { checkAccountA, checkAccountB } = resolveSingleLegCheckAccounts({
    singleLegByRate,
    precheck9999Leg: userStore.extensionPrefs.singleLeg9999Precheck,
    accountA,
    accountB,
    legA,
    legB,
    bet,
    match,
    accounts: accountStore.accounts,
    excludeA,
    excludeB,
    matchStore,
    implied,
  });

  const linkId = createArbLinkId(singleLegByRate, linkTs);
  syncActiveBetBegin({
    match,
    bet,
    legA,
    legB,
    accountA,
    accountB,
    checkAccountA,
    checkAccountB,
    linkId,
    betBothLegs,
  });

  return {
    legA,
    legB,
    accountA,
    accountB,
    checkAccountA,
    checkAccountB,
    implied,
    betBothLegs,
    singleLegByRate,
    singleLeg9999MapReserved,
    singleLeg9999MapKeys,
    linkId,
    stakeScale,
  };
}
