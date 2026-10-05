<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { DirectRealtimeStatus } from "@changmen/venue-adapter/shared";
import { useDirectRealtimeStatus } from "@/composables/useDirectRealtimeStatus";
import {
  listVenueWsStatuses,
  subscribeVenueWsStatus,
  type VenueWsStatusEntry,
} from "@changmen/venue-adapter/shared";
import {
  getObMqttSourceMode,
  cycleObMqttSourceModeAndReconnect,
  obMqttSourceModeLabel,
  type ObMqttSourceMode,
} from "@changmen/venue-adapter/ob";
import {
  cycleRayWsSourceModeAndReconnect,
  getRayWsSourceMode,
  rayWsSourceModeLabel,
  type RayWsSourceMode,
} from "@changmen/venue-adapter/ray";
import {
  cyclePmUserWsSourceModeAndReconnect,
  applyPmAutoTransportOnLogin,
  cyclePmRoutingPreference,
  getPmMarketWsSourceMode,
  getPmRoutingPreference,
  getPmUserWsSourceMode,
  markPmTransportManualOverride,
  onPmAutoTransportApplied,
  pmMarketWsSourceModeLabel,
  pmRoutingPreferenceLabel,
  pmUserWsSourceModeLabel,
  setPmMarketWsSourceModeAndReconnect,
  setPmRoutingPreference,
  setPmUserWsSourceMode,
  sourceModeForPmRoutingPreference,
  type PmMarketWsSourceMode,
  type PmRoutingPreference,
  type PmUserWsSourceMode,
} from "@changmen/venue-adapter/polymarket";
import {
  cyclePredictFunMarketWsSourceModeAndReconnect,
  getPfMarketWsSourceMode,
  markPfTransportManualOverride,
  onPfAutoTransportApplied,
  pfMarketWsSourceModeLabel,
  type PfMarketWsSourceMode,
} from "@changmen/venue-adapter/predictfun";
import {
  countPbWsShadowBySource,
  getPbWsPageDetect,
  isPbWsShadowUiAllowed,
} from "@changmen/venue-adapter/pb";
import { ElMessage } from "element-plus";
import { startPmMaintenanceFeed, usePmMaintenance } from "@/services/pmMaintenanceRealtime";

const props = withDefaults(defineProps<{
  /** esport：显示 PM-M；sports：显示 PM-S / OB-S（体育独立推送） */
  workspace?: "esport" | "sports";
}>(), {
  workspace: "esport",
});

const SPORTS_VENUE_WS_IDS = new Set(["pm-sport-market", "ob-sport", "cm-hub"]);
const { statuses } = useDirectRealtimeStatus();
const pmOfficial = usePmMaintenance();

const venueWsStatuses = ref<VenueWsStatusEntry[]>(listVenueWsStatuses());
const obSourceMode = ref<ObMqttSourceMode>(getObMqttSourceMode());
const raySourceMode = ref<RayWsSourceMode>(getRayWsSourceMode());
const pmMarketWsSourceMode = ref<PmMarketWsSourceMode>(getPmMarketWsSourceMode());
const pmRoutingPreference = ref<PmRoutingPreference>(getPmRoutingPreference());
const pmSettingsVisible = ref(false);
const pmSettingsBusy = ref(false);
const pmConnectionStatus = computed(() => {
  const entry = venueWsStatuses.value.find(row => row.id === (props.workspace === "sports" ? "pm-sport-market" : "pm-market"));
  if (!entry || entry.status === "disconnected") return "未连接";
  if (entry.status === "error") return "连接异常";
  if (entry.status !== "connected") return "连接中";
  if (props.workspace === "sports") return "体育行情 VPS 已连接（独立通道）";
  const viaVps = pmMarketWsSourceMode.value === "changmen";
  return viaVps ? (pmRoutingPreference.value === "relay" ? "VPS 已连接" : "已回退 VPS") : "官网已连接";
});

async function selectPmConnectionMode(preference: "auto" | "relay"): Promise<void> {
  if (pmSettingsBusy.value) return;
  pmSettingsBusy.value = true;
  try {
    const previousUserMode = getPmUserWsSourceMode();
    pmRoutingPreference.value = setPmRoutingPreference(preference);
    const result = await applyPmAutoTransportOnLogin();
    if (previousUserMode !== result.userWsMode) {
      // The existing cycle API switches between the two sources and reconnects once.
      setPmUserWsSourceMode(previousUserMode);
      cyclePmUserWsSourceModeAndReconnect();
    }
    pmMarketWsSourceMode.value = setPmMarketWsSourceModeAndReconnect(result.marketWsMode, `user_${preference}`);
    pmUserWsSourceMode.value = getPmUserWsSourceMode();
    ElMessage.success("PM 连接模式已保存");
  }
  catch {
    ElMessage.error("连接模式应用失败，请重试");
  }
  finally {
    pmSettingsBusy.value = false;
  }
}
const pmUserWsSourceMode = ref<PmUserWsSourceMode>(getPmUserWsSourceMode());
const pfMarketWsSourceMode = ref<PfMarketWsSourceMode>(getPfMarketWsSourceMode());
let venueWsUnsub: (() => void) | undefined;
let pmTransportUnsub: (() => void) | undefined;
let pfTransportUnsub: (() => void) | undefined;

/** 第二行：Polymarket / Predict.fun / DEX / Limitless / SXBet WS */
const VENUE_WS_SECOND_ROW_IDS = new Set([
  "pm-market",
  "pm-sport-market",
  "pm-user",
  "predictfun-market",
  "dex",
  "lm-market",
  "sx-market",
  "ob-sport",
]);

const venueWsPb = computed(() => {
  const entry = venueWsStatuses.value.find(entry => entry.id === "pb") ?? null;
  if (!entry)
    return null;
  const page = getPbWsPageDetect();
  return {
    ...entry,
    label: page.detected ? "PB页" : "PB",
    pageDetected: page.detected,
    pageCount: page.count,
  };
});
const venueWsFirstRow = computed(() =>
  venueWsStatuses.value.filter(
    entry => entry.id !== "pb" && !VENUE_WS_SECOND_ROW_IDS.has(entry.id),
  ),
);
const venueWsSecondRow = computed(() =>
  venueWsStatuses.value.filter((entry) => {
    if (!VENUE_WS_SECOND_ROW_IDS.has(entry.id))
      return false;
    // 电竞页只看 PM-M；体育页只看 PM-S / OB-S（避免闲置电竞角标误导）
    if (props.workspace === "sports" && entry.id === "pm-market")
      return false;
    if (props.workspace !== "sports" && entry.id === "pm-sport-market")
      return false;
    if (props.workspace !== "sports" && entry.id === "ob-sport")
      return false;
    return true;
  }),
);
const PM_STATUS_PAGE_URL = "https://status.polymarket.com";

const pmOfficialState = computed(() => pmOfficial.state.value);
const pmOfficialDetail = computed(() => pmOfficial.detail.value);
const pmOfficialDotClass = computed(() => {
  switch (pmOfficialState.value) {
    case "operational": return "ok-official";
    case "maintenance": return "pm-maint";
    case "incident": return "page";
    default: return "idle";
  }
});
const pmOfficialText = computed(() => {
  switch (pmOfficialState.value) {
    case "operational": return "PM 官网";
    case "maintenance": return "PM 维护中";
    case "incident": return "PM 官网异常";
    default: return "PM 官网 · 未知";
  }
});

function pmOfficialTooltip(): string {
  const lines = ["Polymarket 官网状态（status.polymarket.com 官方状态页）"];
  switch (pmOfficialState.value) {
    case "operational":
      lines.push("正常运行");
      break;
    case "maintenance":
      lines.push("⚠ 维护中：赔率可能停止更新，注意套利误判");
      break;
    case "incident":
      lines.push("⚠ 异常/事故：部分组件不可用");
      break;
    default:
      lines.push(pmOfficialDetail.value?.error
        ? "未知：服务端无法获取官方状态页"
        : "未知：等待服务端检测数据");
  }
  const detail = pmOfficialDetail.value;
  if (detail?.pageStatus)
    lines.push(`页面状态：${detail.pageStatus}`);
  if (detail?.affected?.length)
    lines.push(...detail.affected.map(a => `· ${a}`));
  if (detail?.error)
    lines.push(`检测错误：${detail.error}`);
  if (detail?.checkedAt)
    lines.push(`检测于：${formatAgo(detail.checkedAt)}`);
  lines.push("点击打开官方状态页");
  return lines.join("\n");
}

function openPmStatusPage(): void {
  window.open(PM_STATUS_PAGE_URL, "_blank", "noopener,noreferrer");
}

const venueWsSports = computed(() =>
  venueWsStatuses.value.filter(entry => SPORTS_VENUE_WS_IDS.has(entry.id)),
);
const raySportStatus = computed(() =>
  statuses.value.find(status => status.platform === "RAY") ?? null,
);

onMounted(() => {
  void startPmMaintenanceFeed();
  venueWsUnsub = subscribeVenueWsStatus(() => {
    venueWsStatuses.value = listVenueWsStatuses();
    pmMarketWsSourceMode.value = getPmMarketWsSourceMode();
    pmUserWsSourceMode.value = getPmUserWsSourceMode();
  });
  pmTransportUnsub = onPmAutoTransportApplied(() => {
    pmMarketWsSourceMode.value = getPmMarketWsSourceMode();
    pmRoutingPreference.value = getPmRoutingPreference();
    pmUserWsSourceMode.value = getPmUserWsSourceMode();
  });
  pfTransportUnsub = onPfAutoTransportApplied(() => {
    pfMarketWsSourceMode.value = getPfMarketWsSourceMode();
  });
});
onUnmounted(() => {
  venueWsUnsub?.();
  pmTransportUnsub?.();
  pfTransportUnsub?.();
});

function dotClass(status: DirectRealtimeStatus): string {
  if (status.upstreamConnected) {
    if (status.upstreamRoute === "a8")
      return "ok-a8";
    if (status.upstreamRoute === "changmen")
      return "ok-changmen";
    return "ok-official";
  }
  if (status.lastError)
    return "err";
  return "idle";
}

function venueWsDotClass(entry: VenueWsStatusEntry): string {
  if (entry.id === "pm-sport-market") {
    // 体育固定走 CHANGMEN PM-SPORT-MARKET hub
    switch (entry.status) {
      case "connected": return "ok-changmen";
      case "detected": return "page";
      case "connecting": return "connecting";
      case "error": return "err";
      default: return "idle";
    }
  }
  if (entry.id === "pm-market" || entry.id === "pm-user") {
    const mode = entry.id === "pm-market" ? pmMarketWsSourceMode.value : pmUserWsSourceMode.value;
    switch (entry.status) {
      case "connected":
        return mode === "changmen" ? "ok-changmen" : "ok-official";
      case "detected": return "page";
      case "connecting": return "connecting";
      case "error": return "err";
      default: return "idle";
    }
  }
  if (entry.id === "predictfun-market") {
    const mode = pfMarketWsSourceMode.value;
    switch (entry.status) {
      case "connected":
        return mode === "changmen" ? "ok-changmen" : "ok-official";
      case "detected": return "page";
      case "connecting": return "connecting";
      case "error": return "err";
      default: return "idle";
    }
  }
  switch (entry.status) {
    case "connected": return "ok-official";
    case "detected": return "page";
    case "connecting": return "connecting";
    case "error": return "err";
    default: return "idle";
  }
}

function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60)
    return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60)
    return `${min}分钟前`;
  return `${Math.floor(min / 60)}小时前`;
}

function venueWsTooltip(entry: VenueWsStatusEntry): string {
  const names: Record<string, string> = {
    "pm-market": "Polymarket Market WS（电竞赔率采集）",
    "pm-sport-market": "Polymarket Sport Market WS（体育赔率 · PM-SPORT-MARKET）",
    "pm-user": "Polymarket User WS（订单/拒单检测；登录后预连）",
    "lm-market": "Limitless Market WS（orderbook 推送）",
    "predictfun-market": "Predict.fun Market WS（orderbook 推送）",
    "sx-market": "SX Bet Market WS（best_odds Centrifugo）",
    "dex": "DexSport WS",
    "cm-hub": "Changmen 实时 Hub（Socket.IO / pm_sport）",
    "ob-sport": "OB 体育推送（足球实时赔率 · 独立于电竞 MQTT）",
  };
  const label = names[entry.id] ?? entry.label;
  const lines: string[] = [entry.id === "pb" ? "PB sports-websocket 观测" : label];
  if (entry.id === "pb") {
    const page = getPbWsPageDetect();
    if (page.detected)
      lines.push(`已检测到平博网页 ×${page.count || 1}`);
    else
      lines.push("未检测到平博网页");
  }
  switch (entry.status) {
    case "connected":
      lines.push(entry.id === "pb" ? "WS 已连接 · 实时推送中" : "已连接 · 实时推送中");
      break;
    case "detected":
      lines.push(entry.id === "pb" ? "网页在 · 观测已挂上" : "已检测到");
      break;
    case "connecting":
      lines.push(entry.id === "pb" ? "网页在 · WS 握手中" : "连接中...");
      break;
    case "error":
      lines.push("断开 · 正在重连...");
      break;
    default:
      lines.push(entry.id === "pb" ? "没有可观测的 PB 页" : "未连接");
  }
  if (entry.id === "pb") {
    const dbg = (globalThis as { __CM_PB_SHADOW_DEBUG__?: Record<string, unknown> }).__CM_PB_SHADOW_DEBUG__;
    const bySource = countPbWsShadowBySource();
    lines.push(`影子开关：${isPbWsShadowUiAllowed() ? "开" : "关"}`);
    if (dbg && typeof dbg === "object") {
      const reason = String(dbg.reason || "");
      const cards = dbg.cardCount != null ? Number(dbg.cardCount) : 0;
      lines.push(`灌入：${reason || "—"} · 板=${Number.isFinite(cards) ? cards : 0} · M=${bySource.M}`);
      if (reason === "prefs_shadow_off")
        lines.push("用户中心 → 赛事采集 → 先开「PB changmen 扩展」再开「PB WS 影子价」；然后硬刷新本页");
    }
  }
  if (entry.id === "pm-market") {
    lines.push(`当前选择：${pmMarketWsSourceModeLabel(pmMarketWsSourceMode.value)}`);
    lines.push(`用户模式：${pmRoutingPreferenceLabel(pmRoutingPreference.value)}`);
    if (entry.meta?.reason)
      lines.push(`选择原因：${entry.meta.reason}`);
    if (typeof entry.meta?.assetCount === "number")
      lines.push(`订阅 asset：${entry.meta.assetCount}`);
    if (typeof entry.meta?.connectMs === "number")
      lines.push(`连接耗时：${entry.meta.connectMs}ms`);
    if (typeof entry.meta?.firstFrameMs === "number")
      lines.push(`首帧：${entry.meta.firstFrameMs}ms`);
    if (typeof entry.meta?.firstQuoteMs === "number")
      lines.push(`首个有效报价：${entry.meta.firstQuoteMs}ms`);
    if (typeof entry.meta?.quoteFreshMs === "number")
      lines.push(`报价新鲜度：${entry.meta.quoteFreshMs}ms`);
    if (typeof entry.meta?.connectionAttemptCount === "number")
      lines.push(`连接尝试：${entry.meta.connectionAttemptCount}`);
    if (typeof entry.meta?.reconnectCount === "number")
      lines.push(`重连次数：${entry.meta.reconnectCount}`);
    if (typeof entry.meta?.emptyBookCount === "number" && entry.meta.emptyBookCount > 0)
      lines.push(`空盘口次数：${entry.meta.emptyBookCount}`);
    if (entry.meta?.fallbackReason)
      lines.push(`降级原因：${entry.meta.fallbackReason}`);
    if (entry.meta?.lastMessageAt)
      lines.push(`最近 book：${formatAgo(entry.meta.lastMessageAt)}`);
    if (entry.meta?.lastError)
      lines.push(`错误：${entry.meta.lastError}`);
    lines.push("点击切换：自动 / 官方 / relay");
  }
  if (entry.id === "pm-sport-market") {
    lines.push("固定 CHANGMEN 体育 hub（:3459）");
  }
  if (entry.id === "pm-user") {
    lines.push(`当前选择：${pmUserWsSourceModeLabel(pmUserWsSourceMode.value)}`);
    lines.push("点击切换 CHANGMEN / 官方");
  }
  if (entry.id === "predictfun-market") {
    lines.push(`当前选择：${pfMarketWsSourceModeLabel(pfMarketWsSourceMode.value)}`);
    lines.push("点击切换 CHANGMEN / 官方");
  }
  return lines.join("\n");
}

function tooltip(status: DirectRealtimeStatus): string {
  const lines = [props.workspace === "sports" && status.platform === "RAY" ? "RAY-S 足球实时赔率 WS" : status.platform];
  if (status.upstreamConnected) {
    if (status.upstreamRoute === "a8")
      lines.push("已连接聚合通道");
    else if (status.upstreamRoute === "changmen")
      lines.push("已连接 CHANGMEN 转发");
    else lines.push("已连接官方上游");
  }
  else {
    lines.push("未连接上游");
  }
  if (status.lastError)
    lines.push(`错误：${status.lastError}`);
  if (status.messagesReceived)
    lines.push(`已收 ${status.messagesReceived} 条推送`);
  if (status.lastUpstreamAt)
    lines.push(`最近推送：${formatAgo(status.lastUpstreamAt)}`);
  if (status.forwardedTopics)
    lines.push(`MQTT 订阅 ${status.forwardedTopics} 个 topic`);
  if (status.platform === "OB") {
    lines.push(`当前选择：${obMqttSourceModeLabel(obSourceMode.value)}`);
    lines.push("点击切换 官方 / CHANGMEN");
  }
  if (status.platform === "RAY") {
    lines.push(`当前选择：${rayWsSourceModeLabel(raySourceMode.value)}`);
    lines.push("点击切换 官方 / CHANGMEN");
  }
  return lines.join("\n");
}

function isClickablePlatform(platform: string): boolean {
  return platform === "OB" || platform === "RAY";
}

function itemClass(status: DirectRealtimeStatus): Record<string, boolean> {
  return {
    "direct-realtime-item--clickable": isClickablePlatform(status.platform),
  };
}

function isClickableVenueWs(entry: VenueWsStatusEntry): boolean {
  return entry.id === "pm-market" || entry.id === "pm-user" || entry.id === "predictfun-market";
}

function venueWsItemClass(entry: VenueWsStatusEntry): Record<string, boolean> {
  return {
    "direct-realtime-item--clickable": isClickableVenueWs(entry),
  };
}

function handleVenueWsClick(entry: VenueWsStatusEntry): void {
  if (entry.id === "pm-market") {
    pmRoutingPreference.value = cyclePmRoutingPreference();
    const mode = sourceModeForPmRoutingPreference(pmRoutingPreference.value);
    if (mode)
      pmMarketWsSourceMode.value = setPmMarketWsSourceModeAndReconnect(mode, `user_${pmRoutingPreference.value}`);
    else
      void applyPmAutoTransportOnLogin().then(() => {
        pmMarketWsSourceMode.value = getPmMarketWsSourceMode();
        pmRoutingPreference.value = getPmRoutingPreference();
      });
    ElMessage({
      message: `PM-M 已切换到${pmRoutingPreferenceLabel(pmRoutingPreference.value)}`,
      type: "success",
      plain: true,
    });
    return;
  }
  if (entry.id === "pm-user") {
    markPmTransportManualOverride();
    pmUserWsSourceMode.value = cyclePmUserWsSourceModeAndReconnect();
    ElMessage({
      message: `PM-U WS 已切换到${pmUserWsSourceModeLabel(pmUserWsSourceMode.value)}，正在重连`,
      type: "success",
      plain: true,
    });
    return;
  }
  if (entry.id === "predictfun-market") {
    markPfTransportManualOverride();
    pfMarketWsSourceMode.value = cyclePredictFunMarketWsSourceModeAndReconnect();
    ElMessage({
      message: `PF WS 已切换到${pfMarketWsSourceModeLabel(pfMarketWsSourceMode.value)}，正在重连`,
      type: "success",
      plain: true,
    });
  }
}

function handleStatusClick(status: DirectRealtimeStatus): void {
  if (status.platform === "OB") {
    obSourceMode.value = cycleObMqttSourceModeAndReconnect();
    ElMessage({
      message: `OB MQTT 已切换到${obMqttSourceModeLabel(obSourceMode.value)}，正在重连`,
      type: "success",
      plain: true,
    });
    return;
  }
  if (status.platform === "RAY") {
    raySourceMode.value = cycleRayWsSourceModeAndReconnect();
    ElMessage({
      message: `RAY WS 已切换到${rayWsSourceModeLabel(raySourceMode.value)}，正在重连`,
      type: "success",
      plain: true,
    });
  }
}
</script>

<template>
  <div
    class="direct-realtime-bar"
    :aria-label="workspace === 'sports'
      ? 'PM 官网维护检测；体育推送状态 PM-S OB-S RAY-S HUB'
      : 'PM 官网维护检测；直连推送状态 PB IA OB RAY HUB；第二行 PM PF DEX LM'"
  >
    <div class="direct-realtime-row direct-realtime-row--pm-official">
      <span
        class="direct-realtime-item direct-realtime-item--clickable"
        :title="pmOfficialTooltip()"
        role="button"
        tabindex="0"
        @click="openPmStatusPage"
        @keydown.enter.prevent="openPmStatusPage"
        @keydown.space.prevent="openPmStatusPage"
      >
        <span class="direct-realtime-dot" :class="pmOfficialDotClass" />
        {{ pmOfficialText }}
      </span>
      <el-popover v-model:visible="pmSettingsVisible" placement="bottom-end" :width="320" trigger="click">
        <div class="pm-connection-panel">
          <strong>PM 连接设置</strong>
          <div class="pm-connection-options" role="group" aria-label="PM 连接模式">
            <button type="button" :aria-pressed="pmRoutingPreference !== 'relay'" :disabled="pmSettingsBusy" @click="selectPmConnectionMode('auto')">官网优先</button>
            <button type="button" :aria-pressed="pmRoutingPreference === 'relay'" :disabled="pmSettingsBusy" @click="selectPmConnectionMode('relay')">仅 VPS</button>
          </div>
          <p>行情连接：{{ pmConnectionStatus }}</p>
          <p>官网优先：网络失败或超时回退 VPS。仅 VPS：固定代理。</p>
          <p>控制行情和查询；下注、撤单仍走 VPS。设置保存在当前浏览器。</p>
          <button type="button" @click="openPmStatusPage">查看 PM 官网服务状态</button>
        </div>
        <template #reference><button type="button" class="pm-config-button" aria-label="PM 连接配置">⚙ PM 配置</button></template>
      </el-popover>
    </div>
    <div v-if="workspace === 'sports'" class="direct-realtime-row">
      <span
        v-for="entry in venueWsSports"
        :key="entry.id"
        class="direct-realtime-item"
        :title="venueWsTooltip(entry)"
      >
        <span class="direct-realtime-dot" :class="venueWsDotClass(entry)" />
        {{ entry.label }}
      </span>
      <span
        v-if="raySportStatus"
        class="direct-realtime-item"
        :class="itemClass(raySportStatus)"
        :title="tooltip(raySportStatus)"
        role="button"
        tabindex="0"
        @click="handleStatusClick(raySportStatus)"
        @keydown.enter.prevent="handleStatusClick(raySportStatus)"
        @keydown.space.prevent="handleStatusClick(raySportStatus)"
      >
        <span class="direct-realtime-dot" :class="dotClass(raySportStatus)" />
        RAY-S
      </span>
    </div>
    <template v-else>
    <div class="direct-realtime-row direct-realtime-row--primary">
      <span
        v-if="venueWsPb"
        class="direct-realtime-item"
        :title="venueWsTooltip(venueWsPb)"
      >
        <span class="direct-realtime-dot" :class="venueWsDotClass(venueWsPb)" />
        {{ venueWsPb.label }}
      </span>
      <span
        v-for="status in statuses"
        :key="status.platform"
        class="direct-realtime-item"
        :class="itemClass(status)"
        :title="tooltip(status)"
        :role="isClickablePlatform(status.platform) ? 'button' : undefined"
        :tabindex="isClickablePlatform(status.platform) ? 0 : undefined"
        @click="handleStatusClick(status)"
        @keydown.enter.prevent="handleStatusClick(status)"
        @keydown.space.prevent="handleStatusClick(status)"
      >
        <span class="direct-realtime-dot" :class="dotClass(status)" />
        {{ status.platform }}
      </span>
      <span
        v-for="entry in venueWsFirstRow"
        :key="entry.id"
        class="direct-realtime-item"
        :title="venueWsTooltip(entry)"
      >
        <span class="direct-realtime-dot" :class="venueWsDotClass(entry)" />
        {{ entry.label }}
      </span>
    </div>
    <div class="direct-realtime-row direct-realtime-row--venue-ws">
      <span
        v-for="entry in venueWsSecondRow"
        :key="entry.id"
        class="direct-realtime-item"
        :class="venueWsItemClass(entry)"
        :title="venueWsTooltip(entry)"
        :role="isClickableVenueWs(entry) ? 'button' : undefined"
        :tabindex="isClickableVenueWs(entry) ? 0 : undefined"
        @click="handleVenueWsClick(entry)"
        @keydown.enter.prevent="handleVenueWsClick(entry)"
        @keydown.space.prevent="handleVenueWsClick(entry)"
      >
        <span class="direct-realtime-dot" :class="venueWsDotClass(entry)" />
        {{ entry.label }}
      </span>
    </div>
    </template>
  </div>
</template>

<style scoped>
.pm-config-button {
  padding: 4px 8px;
  border: 1px solid #ffffff40;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.pm-config-button:hover { background: #ffffff18; }
.pm-connection-panel { display: grid; gap: 12px; }
.pm-connection-panel p { margin: 0; font-size: 13px; line-height: 1.5; }
.pm-connection-options { display: flex; gap: 8px; }
.pm-connection-panel button { cursor: pointer; padding: 7px 12px; border: 1px solid var(--el-border-color); border-radius: 5px; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); }
.pm-connection-options button[aria-pressed="true"] { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.pm-connection-panel button:disabled { cursor: wait; opacity: 0.6; }
.direct-realtime-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: min(96vw, 720px);
  padding: 6px 10px;
  border-radius: 6px;
  background: #00000080;
  border: 1px solid #ffffff1a;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.2;
  color: #ffffffd9;
  user-select: none;
}

.direct-realtime-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.direct-realtime-row--pm-official {
  padding-bottom: 2px;
  border-bottom: 1px solid #ffffff14;
}

.direct-realtime-dot.pm-maint {
  background-color: #f56c6c;
  box-shadow: 0 0 8px #f56c6ccc;
  animation: ws-pulse 1.5s infinite;
}

.direct-realtime-row--venue-ws {
  padding-top: 2px;
  border-top: 1px solid #ffffff14;
}

.direct-realtime-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: default;
  white-space: nowrap;
}

.direct-realtime-item:hover {
  color: #fff;
}

.direct-realtime-item--clickable {
  cursor: pointer;
}

.direct-realtime-item--clickable:hover .direct-realtime-dot {
  transform: scale(1.12);
}

.direct-realtime-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.direct-realtime-dot.ok-official {
  background-color: #67c23a;
  box-shadow: 0 0 8px #67c23acc;
}

.direct-realtime-dot.ok-a8 {
  background-color: #409eff;
  box-shadow: 0 0 8px #409effcc;
}

.direct-realtime-dot.ok-changmen {
  background-color: #a855f7;
  box-shadow: 0 0 8px #a855f7cc;
}

.direct-realtime-dot.err {
  background-color: #f56c6c;
  box-shadow: 0 0 8px #f56c6ccc;
}

.direct-realtime-dot.idle {
  background-color: #ffffff66;
}

.direct-realtime-dot.page {
  background-color: #e6a23c;
  box-shadow: 0 0 8px #e6a23ccc;
}

.direct-realtime-dot.connecting {
  background-color: #e6a23c;
  box-shadow: 0 0 8px #e6a23ccc;
  animation: ws-pulse 1.5s infinite;
}

@keyframes ws-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
