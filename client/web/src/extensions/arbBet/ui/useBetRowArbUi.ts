import type { MaybeRefOrGetter } from "vue";
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import { computed, ref, toValue } from "vue";
import { detectArbLegs } from "@changmen/arb-core";
import { useArbLineOverlay, useOddsAnchorMap } from "@/extensions/arbBet/ui/useArbLineOverlay";
import { useOddsFlashCell } from "@/extensions/arbBet/ui/useOddsFlash";
import { percent } from "@changmen/client-core/shared/format";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";
import { filterArbProviderKeys } from "@/types/extensionPrefs";

/**
 * [changmen 扩展] BetRow 消费可用账号与白名单范围的共享检测快照；买入开关只控制执行。
 * A8 默认 BetRow 仅标题 implied；本 composable 集中扩展展示逻辑。
 */
export function useBetRowArbUi(
  match: MaybeRefOrGetter<ViewMatch>,
  bet: MaybeRefOrGetter<ViewBet>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const active = computed(() => toValue(enabled) !== false);
  const user = useUserStore();
  const accountStore = useAccountStore();
  const itemsContainerRef = ref<HTMLElement | null>(null);
  const anchorMap = useOddsAnchorMap();
  const flash = useOddsFlashCell(enabled);

  const legs = computed(() => {
    if (!active.value)
      return null;
    void user.extensionPrefs.pmArbPriceBuffer.enabled;
    void user.extensionPrefs.pmArbPriceBuffer.multiplier;
    void user.extensionPrefs.pfArbPriceBuffer.enabled;
    void user.extensionPrefs.pfArbPriceBuffer.multiplier;
    const b = toValue(bet);
    const m = toValue(match);
    const providerKeys = filterArbProviderKeys([...accountStore.getProviders(
      user.config.betMoneyMode === "total" ? 0 : user.config.betMoney,
    ).keys()], user.extensionPrefs.arbAllowedPlatforms);
    return detectArbLegs(
      b,
      user.config,
      providerKeys,
      accountStore.accounts,
      m.game,
    );
  });

  const overlayLabel = computed(() => {
    const L = legs.value;
    return L ? percent(L.implied) : undefined;
  });

  function isArbLeg(item: ViewBetItem, side: BetSide): boolean {
    if (!active.value)
      return false;
    const detected = legs.value;
    if (!detected) return false;
    return side === "Home"
      ? detected.homeItem.type === item.type && detected.homeItemId === item.homeId
      : detected.awayItem.type === item.type && detected.awayItemId === item.awayId;
  }

  function bindOddsAnchor(item: ViewBetItem, side: BetSide) {
    if (!active.value)
      return undefined;
    return anchorMap.bind(item.type, side, side === "Home" ? item.homeId : item.awayId);
  }

  const { line, badge } = useArbLineOverlay(
    itemsContainerRef,
    () => {
      if (!active.value)
        return null;
      const L = legs.value;
      if (!L)
        return null;
      return {
        home: anchorMap.get(L.homeItem.type, "Home", L.homeItemId),
        away: anchorMap.get(L.awayItem.type, "Away", L.awayItemId),
      };
    },
    [legs, active, anchorMap.version,
      () => toValue(bet).items.map(item => `${item.type}:${item.homeId}:${item.awayId}`).join("|")],
    enabled,
  );

  return {
    itemsContainerRef,
    detection: legs,
    line,
    badge,
    overlayLabel,
    isArbLeg,
    bindOddsAnchor,
    ...flash,
  };
}
