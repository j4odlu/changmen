<script setup lang="ts">
import { onClickOutside } from "@vueuse/core";
import { computed, ref } from "vue";
import { formatOrderTime, isLowOddsSingleLink } from "@changmen/client-core/shared/format";
import { pendingSingleLegPositions } from "@/runtime/singleLegStrategy";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

const user = useUserStore();
const accounts = useAccountStore();
const menu = ref<HTMLDetailsElement>();
const visible = computed(() => user.isLoggedIn && user.userId && !accounts.adminWorkspacePreview);
const orders = computed(() => [...pendingSingleLegPositions.value].sort((a, b) => Number(b.CreateAt ?? 0) - Number(a.CreateAt ?? 0)));
const close = () => { if (menu.value) menu.value.open = false; };
const numberText = (value: unknown, digits = 2) => value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
onClickOutside(menu, close);
</script>

<template>
  <details v-if="visible" ref="menu" class="single-leg-monitor" @keydown.esc="close">
    <summary class="single-leg-monitor__trigger" :aria-label="`9999 / LOS 待处理订单 ${orders.length} 笔`" aria-controls="single-leg-monitor-list">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20V10m5 10V4m5 16v-7m5 7V7M2 20h20" /></svg>
      <span>9999 / LOS</span>
      <span class="single-leg-monitor__count">{{ orders.length }}</span>
    </summary>
    <section id="single-leg-monitor-list" class="single-leg-monitor__panel" aria-label="待处理的9999和LOS订单">
      <div class="single-leg-monitor__header">
        <div><strong>待处理仓位</strong><span>{{ orders.length }} 笔 · 9999 / LOS</span></div>
        <button type="button" aria-label="收起待处理订单" @click="close">×</button>
      </div>
      <div v-if="!orders.length" class="single-leg-monitor__empty">暂无需要处理的 9999 / LOS 订单</div>
      <ul v-else class="single-leg-monitor__list">
        <li v-for="order in orders" :key="JSON.stringify([order.PlayerID, order.Type, order.OrderID])" class="single-leg-monitor__order">
          <div class="single-leg-monitor__meta">
            <span class="single-leg-monitor__mode">{{ isLowOddsSingleLink(order.Link) ? 'LOS' : '9999' }}</span>
            <span>{{ order.Type }} · {{ order.Player?.UserName || `账号 #${order.PlayerID}` }}</span>
            <span class="single-leg-monitor__status">{{ String(order.Status).toLowerCase() === 'pending' ? '待确认' : order.PmSellState === 'partial' ? '部分减仓' : '待处理' }}</span>
          </div>
          <strong class="single-leg-monitor__match">{{ order.Match || '赛事名称待同步' }}</strong>
          <p>{{ order.Bet || '盘口待同步' }} · {{ order.Item || '方向待同步' }}</p>
          <div class="single-leg-monitor__values"><span>金额 <b>{{ numberText(order.BetMoney) }}</b></span><span>赔率 <b>{{ numberText(order.Odds, 3) }}</b></span></div>
          <footer><time>{{ formatOrderTime(order.CreateAt) || '时间待同步' }}</time><span :title="String(order.OrderID)">{{ order.OrderID }}</span></footer>
        </li>
      </ul>
      <div class="single-leg-monitor__note">当前前端已加载的未结束订单</div>
    </section>
  </details>
</template>

<style scoped>
.single-leg-monitor { position: fixed; right: 16px; bottom: calc(88px + env(safe-area-inset-bottom, 0px)); z-index: 1900; font-size: 12px; color: var(--el-text-color-primary, #e2e8f0); }
.single-leg-monitor__trigger { display: flex; align-items: center; gap: 9px; padding: 12px 15px; list-style: none; border: 1px solid #3d9872; border-radius: 12px; background: #166344; color: #f0fdf4; cursor: pointer; box-shadow: 0 5px 20px #0004; font-weight: 600; }
.single-leg-monitor__trigger::-webkit-details-marker { display: none; }
.single-leg-monitor__trigger:hover { background: #1b7752; }
.single-leg-monitor__trigger:focus-visible { outline: 2px solid var(--cm-color-primary); outline-offset: 3px; }
.single-leg-monitor__trigger svg { width: 19px; height: 19px; }
.single-leg-monitor__count { min-width: 21px; padding: 2px 5px; border-radius: 6px; background: #ffffff24; text-align: center; font-variant-numeric: tabular-nums; }
.single-leg-monitor__panel { position: absolute; right: 0; bottom: calc(100% + 12px); display: flex; flex-direction: column; width: min(420px, calc(100vw - 32px)); max-height: min(580px, calc(100dvh - 184px)); border: 1px solid var(--el-border-color, #334155); border-radius: 12px; background: var(--el-bg-color-overlay, #1e293b); box-shadow: 0 12px 40px #0005; overflow: hidden; }
.single-leg-monitor__header { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--el-border-color-lighter, #334155); }
.single-leg-monitor__header strong { display: block; margin-bottom: 4px; font-size: 15px; }
.single-leg-monitor__header span, .single-leg-monitor__note { color: var(--el-text-color-secondary, #94a3b8); }
.single-leg-monitor__header button { padding: 2px 8px; border: 0; background: transparent; color: inherit; font-size: 24px; line-height: 1; cursor: pointer; }
.single-leg-monitor__list { margin: 0; padding: 0; overflow: auto; min-height: 0; list-style: none; }
.single-leg-monitor__order { padding: 14px 16px; border-bottom: 1px solid var(--el-border-color-lighter, #334155); }
.single-leg-monitor__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-bottom: 9px; color: var(--el-text-color-secondary, #94a3b8); }
.single-leg-monitor__mode { padding: 2px 6px; border-radius: 4px; color: var(--cm-color-success, #67c23a); background: var(--el-color-success-light-9, #67c23a18); font-weight: 600; }
.single-leg-monitor__status { margin-left: auto; color: var(--cm-color-warning, #e6a23c); }
.single-leg-monitor__match { display: block; overflow-wrap: anywhere; font-size: 13px; }
.single-leg-monitor__order p { margin: 6px 0 12px; color: var(--el-text-color-secondary, #94a3b8); overflow-wrap: anywhere; }
.single-leg-monitor__values { display: flex; gap: 22px; color: var(--el-text-color-secondary, #94a3b8); }
.single-leg-monitor__values b { margin-left: 6px; color: var(--el-text-color-primary, #e2e8f0); font-variant-numeric: tabular-nums; }
.single-leg-monitor__order footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; color: var(--el-text-color-placeholder, #94a3b8); font-size: 10px; }
.single-leg-monitor__order footer span { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.single-leg-monitor__empty { padding: 34px 16px; text-align: center; color: var(--el-text-color-secondary, #94a3b8); }
.single-leg-monitor__note { padding: 10px 16px; border-top: 1px solid var(--el-border-color-lighter, #334155); font-size: 11px; }
</style>
