<script setup lang="ts">
import type { OrderRow } from "@/types/order";
import type { OrderListEntry } from "./orderListTypes";
export type { OrderListEntry } from "./orderListTypes";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import OrderModeDetails from "@/orderModes/OrderDetails.vue";
import OrderProfitLine from "./presentation/OrderProfitLine.vue";
import OrderQuoteLine from "./presentation/OrderQuoteLine.vue";
import OrderMarketDetails from "./presentation/OrderMarketDetails.vue";
import OrderStatusBadge from "./presentation/OrderStatusBadge.vue";
import OrderTag from "./presentation/OrderTag.vue";
import OrderLiveQuoteLine from "./presentation/OrderLiveQuoteLine.vue";
import { formatDisplayOdds, formatOrderTime, toFixed } from "@changmen/client-core/shared/format";
import { isPmBuyOrderListRow, isPmSellOrderListRow, pmBuyLifecycleTagText, pmOrderSideTagText } from "@/shared/pmOrderDisplay";
import { isPfOrderListRow, isPfSellOrderListRow, pfOrderSideTagText } from "@/shared/pfOrderDisplay";
import { isArbGroup, orderLegendModifier, orderLegendText } from "@/shared/orderDisplay";
import { groupHasUnboundPlaceholder } from "@/shared/linkDisplay";
import { isMakeupCancelledOrderRow, isMakeupPendingOrderRow, isRebindableOrderRow,
  makeupPendingProfitLabel, orderListDisplayBlocks, orderListDisplayRows } from "@/shared/orderLink";
import { isUnifiedFootballOrderRow as isFootballPodOrder } from "@/shared/orderDomain";
import { orderItemText, isPendingRow } from "./orderListPresentation";
import { predictionDisplay } from "./orderListPredictionPresentation";
import { useOrderListActions } from "./controllers/useOrderListActions";
import { useOrderListLiveQuotes } from "./controllers/useOrderListLiveQuotes";
import { useOrderLinkRebind } from "./controllers/useOrderLinkRebind";
import { useOrderListLabels } from "./controllers/useOrderListLabels";
import { useRayOrderDisplay } from "./controllers/useRayOrderDisplay";

const props = withDefaults(
  defineProps<{
    orderEntries: ReadonlyArray<OrderListEntry>;
    /** 管理端仅展示订单记录，不订阅行情或显示实时估值。 */
    liveQuotes?: boolean;
    loading?: boolean;
    playerLabel?: (row: OrderRow) => string;
    platformClass?: (row: OrderRow) => string | undefined;
    /** [changmen 扩展] 用户侧栏允许场馆徽章拖放改绑 Link */
    allowLinkRebind?: boolean;
    /** [changmen 扩展] PM 买单行显示「卖出」 */
    allowPmSell?: boolean;
    /** [changmen 扩展] PF 买单行显示「卖出」 */
    allowPfSell?: boolean;
  }>(),
  {
    loading: false,
    liveQuotes: true,
    playerLabel: () => "",
    platformClass: () => undefined,
    allowLinkRebind: false,
    allowPmSell: false,
    allowPfSell: false,
  },
);

const emit = defineEmits<{
  cancelMakeup: [betId: number];
  linkRebindDone: [];
}>();

const { pfMatchText, pfBetText, pfItemText, peObserveTag } = useOrderListLabels(props);
const { statusClass, showPmSellButton, showPfSellButton, onPmSell, onPfSell, onCancelMakeup,
  isPmManualSellInFlight, isPfManualSellInFlight } = useOrderListActions(props, betId => emit("cancelMakeup", betId));
const liveQuotes = useOrderListLiveQuotes(props);
const rayStatusClass = useRayOrderDisplay();
const { drag, badgeClass, badgeTitle, onBadgePointerDown, onBadgePointerMove,
  onBadgePointerUp, onBadgePointerCancel } = useOrderLinkRebind(props, () => emit("linkRebindDone"));

function displayBlocks(rows: OrderRow[]) {
  return orderListDisplayBlocks(rows).map(block => ({ ...block, prediction: predictionDisplay(block.row, rows, liveQuotes) }));
}
</script>

<template>
  <div class="orders" :class="{ loading, 'orders--rebind-active': !!drag }">
    <template v-for="[link, rows] in orderEntries" :key="link">
      <fieldset
        v-if="orderListDisplayRows(rows).length"
        class="orderlink"
        :class="{
          'orderlink--paired': isArbGroup(rows),
          'orderlink--unbound': groupHasUnboundPlaceholder(rows),
        }"
        :data-link-id="link"
      >
        <legend :class="orderLegendModifier(rows)">
          <span
            v-if="groupHasUnboundPlaceholder(rows)"
            class="orderlink__tag orderlink__tag--hash"
            title="本组仍有占位 Link，绑单确认前短暂态"
          >未绑单</span>
          {{ orderLegendText(rows) }}
        </legend>
        <div
          v-for="block in displayBlocks(rows)"
          :key="block.key"
          class="order"
          :class="{ 'order--sell-attach': block.attach }"
        >
          <div
            v-if="block.attach"
            class="order__attach-label"
          >
            卖出记录
          </div>
          <div
            v-if="isMakeupPendingOrderRow(block.row)"
            class="order__status-anchor"
          >
            <i
              class="order__makeup-close"
              title="取消补单"
              role="button"
              @click="onCancelMakeup(block.row)"
            />
            <OrderStatusBadge :status-class="block.row.Status" />
          </div>
          <OrderStatusBadge v-else :status-class="rayStatusClass(block.row) ?? statusClass(block.row)" />
          <div class="platform flex" :class="platformClass(block.row)">
            <span
              :class="badgeClass(block.row)"
              :data-rebind-order-id="isRebindableOrderRow(block.row) ? String(block.row.OrderID) : undefined"
              :title="badgeTitle(block.row)"
              @pointerdown="onBadgePointerDown($event, block.row)"
              @pointermove="onBadgePointerMove"
              @pointerup="onBadgePointerUp"
              @pointercancel="onBadgePointerCancel"
            >
              <PlatformIcon :platform="block.row.Type ?? ''" />
            </span>
            <div class="player">
              {{ playerLabel(block.row) }}
            </div>
            <OrderTag
              v-if="isFootballPodOrder(block.row)"
              class-name="order__pm-tag--football"
              title="POD 足球跟单"
              text="足球"
            />
            <OrderTag
              v-if="pmOrderSideTagText(block.row) || pfOrderSideTagText(block.row)"
              :class-name="(isPmSellOrderListRow(block.row) || isPfSellOrderListRow(block.row)) ? 'order__pm-tag--side order__pm-tag--sell' : 'order__pm-tag--side order__pm-tag--buy'"
              :text="pmOrderSideTagText(block.row) || pfOrderSideTagText(block.row)"
            />
            <OrderTag
              v-if="isPmBuyOrderListRow(block.row) && block.row.PmMatchResult === 'EqualSplit'"
              title="官方最终赛果：每份兑付 $0.50；右侧输赢角标表示订单盈亏"
              :text="pmBuyLifecycleTagText(block.row)"
            />
            <OrderTag
              v-if="block.attach && block.sellSource"
              :class-name="block.sellSource === 'event' ? 'order__pm-tag--pe order__pm-tag--pe-event' : 'order__pm-tag--pe order__pm-tag--pe-row'"
              :title="block.sellSource === 'event' ? '展示来自买单 positionEvents' : '展示来自独立卖单行（事件缺失或未回填）'"
              :text="block.sellSource === 'event' ? '事件' : '卖单'"
            />
            <template v-for="pe in [block.attach ? null : peObserveTag(block.row)]" :key="`pe-wrap-${block.key}`">
              <OrderTag
                v-if="pe"
                :class-name="`order__pm-tag--pe ${pe.className}`"
                :title="pe.title"
                :text="pe.text"
              />
            </template>
          </div>
          <OrderMarketDetails
            v-if="isPfOrderListRow(block.row)"
            :match-text="pfMatchText(block.row)"
            :bet-text="pfBetText(block.row)"
            :item-text="pfItemText(block.row)"
          />
          <OrderMarketDetails v-else :item-text="orderItemText(block.row)">
            <template #match><div class="match" v-html="block.row.Match" /></template>
            <template #bet><span v-html="block.row.Bet" /></template>
          </OrderMarketDetails>
          <div class="profit">
            <template v-if="block.prediction">
              <template v-if="block.prediction.side === 'sell'">
                <div class="order__profit-line">
                  <span v-if="block.prediction.amount.sharesText">份额：{{ block.prediction.amount.sharesText }} </span>
                  <span>{{ block.prediction.amount.amountLabel }}：{{ block.prediction.amount.amountText }}</span>
                </div>
                <OrderQuoteLine v-bind="block.prediction.quote" />
              </template>
              <template v-else>
                <OrderQuoteLine v-bind="block.prediction.quote" />
                <OrderProfitLine v-bind="block.prediction.profit">
                  <template v-if="block.prediction.venue === 'pm'" #amount>
                    <slot name="buy-amount" :row="block.row">{{ block.prediction.profit.amountText }}</slot>
                  </template>
                </OrderProfitLine>
                <div class="order__profit-line order__profit-line--sell-row">
                  <OrderLiveQuoteLine v-bind="block.prediction.live" />
                  <template v-if="block.prediction.venue === 'pm'">
                  <button
                    v-if="showPmSellButton(block.row)"
                    type="button"
                    class="order__sell-btn"
                    :disabled="isPmManualSellInFlight(block.row.OrderID)"
                    @click="onPmSell(block.row)"
                  >
                    {{ isPmManualSellInFlight(block.row.OrderID) ? "卖出中…" : "卖出" }}
                  </button>
                  </template>
                  <template v-else>
                  <button
                    v-if="showPfSellButton(block.row)"
                    type="button"
                    class="order__sell-btn"
                    :disabled="isPfManualSellInFlight(block.row.OrderID)"
                    @click="onPfSell(block.row)"
                  >
                    {{ isPfManualSellInFlight(block.row.OrderID) ? "卖出中…" : "卖出" }}
                  </button>
                  </template>
                </div>
              </template>
            </template>
            <template v-else>
              买入金额：{{ toFixed(Number(block.row.BetMoney) || 0, 0) }} {{ block.row.MakeupOddsBand ? "打平赔率" : "赔率" }}：<span class="order__odds">{{
                formatDisplayOdds(Number(block.row.Odds) || 0)
              }}</span>
              <template v-if="isMakeupPendingOrderRow(block.row)">
                盈亏：{{ makeupPendingProfitLabel(block.row) }}
              </template>
              <template v-else-if="isMakeupCancelledOrderRow(block.row)">
                盈亏：补单已手动取消
              </template>
              <template v-else-if="['Reject', 'Return', 'RaySettled'].includes(rayStatusClass(block.row) ?? '') && ['None', 'Pending', 'RayConfirming'].includes(String(block.row.Status))">
                盈亏：{{ rayStatusClass(block.row) === 'Reject' ? '拒单' : rayStatusClass(block.row) === 'Return' ? '退回' : '已结算' }}
              </template>
              <template v-else-if="isPendingRow(block.row) || ['RayPending', 'None'].includes(rayStatusClass(block.row) ?? '')">
                盈亏：{{ rayStatusClass(block.row) === "RayPending" ? "待确认" : "待结算" }}
              </template>
              <template v-else>
                盈亏：{{ toFixed(Number(block.row.Money) || 0, 0) }}
              </template>
            </template>
          </div>
          <div
            v-if="isMakeupPendingOrderRow(block.row) && block.row.MakeupOddsBand"
            class="order__makeup-band"
            :title="block.row.MakeupOddsBand.approximate
              ? '上下沿赔率按等返还金额折算，仅供参考；实际按取整后的补单金额计算总体保底利润率。'
              : '最高候选赔率严格低于下沿或高于上沿才补单；等于边界或处于区间内不补单。'"
          >
            <span>
              下沿赔率：<span v-if="block.row.MakeupOddsBand.lowerOdds != null" class="order__odds">{{ block.row.MakeupOddsBand.approximate ? "约 " : "" }}{{ formatDisplayOdds(block.row.MakeupOddsBand.lowerOdds) }}</span><span v-else>{{ block.row.MakeupOddsBand.approximate ? "不可达" : "已关闭" }}</span>
            </span>
            <span>
              上沿赔率：<span v-if="block.row.MakeupOddsBand.upperOdds != null" class="order__odds">{{ block.row.MakeupOddsBand.approximate ? "约 " : "" }}{{ formatDisplayOdds(block.row.MakeupOddsBand.upperOdds) }}</span><span v-else>不可达</span>
            </span>
          </div>
          <div class="time">
            买入时间：{{ formatOrderTime(block.row.CreateAt || 0) }}
          </div>
          <slot name="row-monitor" :row="block.row" :link="link" :rows="rows" />
          <div v-if="$slots['row-actions']" class="order-list__row-actions">
            <slot name="row-actions" :row="block.row" :link="link" :rows="rows" />
          </div>
          <OrderModeDetails v-if="block.row.PmGtcExecutionId && !$slots['row-actions']" :row="block.row" :readonly="!allowPmSell && !allowPfSell" />
        </div>
        <div v-if="$slots['group-monitor']" class="order-list__group-monitor">
          <slot name="group-monitor" :link="link" :rows="rows" />
        </div>
        <div v-if="$slots['group-actions']" class="order-list__group-actions">
          <slot name="group-actions" :link="link" :rows="rows" />
        </div>
      </fieldset>
    </template>
  </div>
</template>

<style scoped>
.order__makeup-band {
  display: flex;
  flex-wrap: wrap;
  column-gap: 12px;
}

.order__makeup-band > span {
  white-space: nowrap;
}

.order__makeup-band .order__odds {
  color: var(--cm-color-odds);
}
</style>
