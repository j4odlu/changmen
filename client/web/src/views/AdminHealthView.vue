<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import AdminLayout from "@/components/admin/AdminLayout.vue";
import { authHeaders } from "@/api/client";
import { getApiBase } from "@/config/apiBase";
import { useUserStore } from "@/stores/userStore";
import {
  getPmExecutionMetricsSummary,
  getPmMarketClientMetricsSnapshot,
  type PmExecutionMetricsSummary,
  type PmExecutionMetricKind,
  type PmExecutionKindSummary,
  type PmMarketClientMetricsSnapshot,
} from "@changmen/venue-adapter/polymarket";

const router = useRouter();
const user = useUserStore();

interface PoolStats { total: number; idle: number; waiting: number }
interface PlatformStat {
  active: number;
  totalConnections: number;
  lastConnectedAt: number;
  lastError: string;
  lastErrorAt: number;
}
interface EsportActionStat {
  action: string;
  count: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
  lastAt: number;
}
interface EsportSlowRow {
  action: string;
  durationMs: number;
  at: number;
}
interface EsportApiHealth {
  counter: number;
  lastDelayMs: number;
  lastAction: string;
  lastAt: number;
  slowRecent: EsportSlowRow[];
  byAction: EsportActionStat[];
}
interface PmMarketHubClient {
  id: number;
  userId?: string;
  userName?: string;
  assetCount: number;
  connectedForSec: number;
  idleSubscribeSec: number | null;
  lastBufferedAmount: number;
  droppedToClient: number;
  coalescedToClient?: number;
  softSkipToClient?: number;
  hardSkipToClient?: number;
  pendingAssets?: number;
  pendingAgeMs?: number;
  sentToClient: number;
  remoteAddress: string;
  xForwardedFor?: string;
  userAgent: string;
}
interface PmMarketHubStatus {
  activeClients: number;
  subscribedAssets: number;
  upstreamConnected: boolean;
  pendingFlushMs?: number;
  softBufferedBytes?: number;
  thinFrames?: boolean;
  softSkipTotal?: number;
  hardSkipTotal?: number;
  pendingMaxAgeMs?: number;
  slowClients: PmMarketHubClient[];
}
interface HealthData {
  status: string;
  uptime: number;
  version: string;
  db: { connected: boolean; latencyMs: number; pool: PoolStats };
  memory: { rss: number; heapUsed: number; heapTotal: number };
  data: { users: number; accounts: number; clientMatches: number };
  wsForward: {
    enabled: boolean;
    platforms: string[];
    platformStats?: Record<string, PlatformStat>;
    hubs?: {
      pmMarket?: PmMarketHubStatus;
      pmMarketSecondary?: PmMarketHubStatus | null;
    } | null;
  };
  esportApi?: EsportApiHealth;
}
interface ProbeStep {
  name: string;
  ok: boolean | null;
  skipped?: boolean;
  latencyMs?: number;
  status?: number;
  error?: string;
  reason?: string;
}
interface PmMarketObservability {
  status: string;
  checkedAt: string;
  timeoutMs: number;
  upstream: {
    clobOrigin: string;
    marketWsUrl: string;
    dns: { clob: ProbeStep; marketWs: ProbeStep };
    marketWs: { tcp: ProbeStep; tls: ProbeStep };
    clob: { origin: string; time: ProbeStep; book: ProbeStep };
  };
  hub: {
    source: string;
    localUrl: string;
    publicUrl: string;
    selected: PmMarketHubStatus | null;
  };
  summary: {
    failedChecks: string[];
    activeClients: number;
    subscribedAssets: number;
    upstreamConnected: boolean;
    pendingMaxAgeMs: number;
    softSkipTotal: number;
    hardSkipTotal: number;
    bookProbeEnabled: boolean;
  };
}

const health = ref<HealthData | null>(null);
const pmMarketObs = ref<PmMarketObservability | null>(null);
const pmMarketClientMetrics = ref<PmMarketClientMetricsSnapshot>(getPmMarketClientMetricsSnapshot());
const pmExecutionMetrics = ref<PmExecutionMetricsSummary>(getPmExecutionMetricsSummary());
const error = ref("");
const pmMarketObsError = ref("");
const loading = ref(false);
const pmMarketObsLoading = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
let pmMarketObsTimer: ReturnType<typeof setInterval> | null = null;
let pmMarketClientMetricsTimer: ReturnType<typeof setInterval> | null = null;

const pmHubSites = computed(() => {
  const hubs = health.value?.wsForward.hubs;
  return [
    { id: "202", label: "ws", hub: hubs?.pmMarket ?? null },
  ];
});

const pmHubClientRows = computed(() => {
  return pmHubSites.value.flatMap((site) =>
    (site.hub?.slowClients ?? []).map(row => ({
      ...row,
      siteId: site.id,
      siteLabel: site.label,
    })),
  );
});

const pmSubmitStatusText = computed(() => topReasonText(pmExecutionMetrics.value.execution.submitStatuses));

function isFullHealthData(v: unknown): v is HealthData {
  if (!v || typeof v !== "object")
    return false;
  const o = v as Partial<HealthData>;
  return typeof o.uptime === "number"
    && o.db != null
    && o.memory != null
    && o.data != null
    && o.wsForward != null;
}

async function fetchHealth() {
  loading.value = true;
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/health`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...authHeaders() },
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      throw new Error(`后端返回非 JSON（${res.status}），请确认 /health 代理已配置`);
    }
    const payload: unknown = await res.json();
    if (!isFullHealthData(payload)) {
      const failure = payload as { msg?: string; error?: string } | null;
      if (!res.ok)
        throw new Error(failure?.msg || failure?.error || `健康检查接口异常（${res.status}）`);
      throw new Error("健康检查数据不完整：请确认已用管理员或团队长账号登录，且后端已部署 /health 鉴权");
    }
    health.value = payload;
    error.value = "";
  }
  catch (e) {
    health.value = null;
    error.value = e instanceof Error ? e.message : String(e);
  }
  finally {
    loading.value = false;
  }
}

function isPmMarketObservability(v: unknown): v is PmMarketObservability {
  if (!v || typeof v !== "object")
    return false;
  const o = v as Partial<PmMarketObservability>;
  return typeof o.status === "string"
    && typeof o.checkedAt === "string"
    && o.upstream != null
    && o.hub != null
    && o.summary != null;
}

async function fetchPmMarketObservability() {
  if (!user.canAccessAdmin)
    return;
  pmMarketObsLoading.value = true;
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/health/pm-market`, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...authHeaders() },
    });
    const payload: unknown = await res.json();
    if (!isPmMarketObservability(payload))
      throw new Error((payload as { msg?: string; error?: string })?.msg || (payload as { error?: string })?.error || `PM-M 观测接口异常（${res.status}）`);
    pmMarketObs.value = payload;
    pmMarketObsError.value = "";
  }
  catch (e) {
    pmMarketObsError.value = e instanceof Error ? e.message : String(e);
  }
  finally {
    pmMarketObsLoading.value = false;
  }
}

function uptimeStr(sec: number): string {
  if (sec >= 86400)
    return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
  if (sec >= 3600)
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function agoStr(ts: number): string {
  if (!ts)
    return "";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec > 3600)
    return `${Math.floor(sec / 3600)}h ago`;
  if (sec > 60)
    return `${Math.floor(sec / 60)}m ago`;
  return `${sec}s ago`;
}

function heapPct(d: HealthData): number {
  return d.memory.heapTotal ? Math.round((d.memory.heapUsed / d.memory.heapTotal) * 100) : 0;
}

function poolActivePct(d: HealthData): number {
  const active = d.db.pool.total - d.db.pool.idle;
  return d.db.pool.total ? Math.round((active / d.db.pool.total) * 100) : 0;
}

function delayColor(ms: number): string {
  if (ms < 100)
    return "health-val--ok";
  if (ms < 500)
    return "health-val--warn";
  return "health-val--bad";
}

function probeTagType(step?: ProbeStep | null): "success" | "danger" | "warning" | "info" {
  if (!step)
    return "info";
  if (step.skipped || step.ok == null)
    return "info";
  return step.ok ? "success" : "danger";
}

function probeText(step?: ProbeStep | null): string {
  if (!step)
    return "—";
  if (step.skipped)
    return step.reason || "skipped";
  const bits = [
    step.ok ? "OK" : "FAIL",
    step.status ? `HTTP ${step.status}` : "",
    typeof step.latencyMs === "number" ? `${step.latencyMs}ms` : "",
    step.error || "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function msText(ms: number | null): string {
  return typeof ms === "number" && Number.isFinite(ms) ? `${ms}ms` : "—";
}

function rateText(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function numberText(value: number | null, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function priceText(value: number | null): string {
  return numberText(value, 4);
}

function kindLatencyText(row: PmExecutionKindSummary | undefined): string {
  if (!row || row.count <= 0)
    return "—";
  return `p50 ${msText(row.p50Ms)} · p90 ${msText(row.p90Ms)} · p95 ${msText(row.p95Ms)}`;
}

function kindCountText(kind: PmExecutionMetricKind): string {
  const row = pmExecutionMetrics.value.byKind[kind];
  if (!row || row.count <= 0)
    return "0";
  return `${row.count} / 成功 ${row.success} / 失败 ${row.fail}`;
}

function topReasonText(reasons: Record<string, number>): string {
  const rows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (!rows.length)
    return "—";
  return rows.slice(0, 3).map(([key, count]) => `${key} ${count}`).join(" · ");
}

function refreshPmMarketClientMetrics() {
  pmMarketClientMetrics.value = getPmMarketClientMetricsSnapshot();
  pmExecutionMetrics.value = getPmExecutionMetricsSummary();
}

onMounted(async () => {
  if (!user.ready) {
    try { await user.fetchUserInfo(); }
    catch {
      sessionStorage.setItem("gamebet:postLoginRedirect", "/admin/health");
      await router.replace({ name: "home" });
      return;
    }
  }
  if (!user.canAccessAdmin) { await router.replace({ name: "home" }); return; }
  await Promise.all([
    fetchHealth(),
    fetchPmMarketObservability(),
  ]);
  timer = setInterval(fetchHealth, 5000);
  pmMarketObsTimer = setInterval(fetchPmMarketObservability, 30000);
  pmMarketClientMetricsTimer = setInterval(refreshPmMarketClientMetrics, 1000);
});

onUnmounted(() => {
  if (timer)
    clearInterval(timer);
  if (pmMarketObsTimer)
    clearInterval(pmMarketObsTimer);
  if (pmMarketClientMetricsTimer)
    clearInterval(pmMarketClientMetricsTimer);
});
</script>

<template>
  <AdminLayout title="系统健康" subtitle="服务状态、数据库、内存与 WebSocket 实时监控">
    <div v-if="error" class="health-error">
      <el-alert type="error" :closable="false" :title="error" />
    </div>
    <div v-if="health" class="health-grid">
      <!-- Status banner -->
      <div class="health-banner" :class="health.status === 'ok' ? 'health-banner--ok' : 'health-banner--bad'">
        <span class="health-dot" />
        <span class="health-banner-text">{{ health.status === 'ok' ? '系统正常' : '系统异常' }}</span>
        <span class="health-banner-meta">v{{ health.version }} · uptime {{ uptimeStr(health.uptime) }}</span>
      </div>

      <!-- Database -->
      <div class="health-card">
        <div class="health-card__title">
          数据库
        </div>
        <div class="health-row">
          <span>连接状态</span>
          <el-tag :type="health.db.connected ? 'success' : 'danger'" size="small" effect="dark">
            {{ health.db.connected ? '已连接' : '断开' }}
          </el-tag>
        </div>
        <div class="health-row">
          <span>查询延迟</span>
          <span class="health-val" :class="{ 'health-val--warn': health.db.latencyMs > 10, 'health-val--bad': health.db.latencyMs > 50 }">
            {{ health.db.latencyMs }}ms
          </span>
        </div>
        <div class="health-row">
          <span>连接池</span>
          <span class="health-val">{{ health.db.pool.total - health.db.pool.idle }} / {{ health.db.pool.total }} active</span>
        </div>
        <el-progress
          :percentage="poolActivePct(health)"
          :stroke-width="6"
          :show-text="false"
          :color="poolActivePct(health) > 80 ? '#f56c6c' : '#409eff'"
        />
        <div v-if="health.db.pool.waiting" class="health-row">
          <span>等待队列</span>
          <span class="health-val health-val--warn">{{ health.db.pool.waiting }}</span>
        </div>
      </div>

      <!-- Memory -->
      <div class="health-card">
        <div class="health-card__title">
          内存
        </div>
        <div class="health-row">
          <span>RSS</span>
          <span class="health-val">{{ health.memory.rss }} MB</span>
        </div>
        <div class="health-row">
          <span>Heap</span>
          <span class="health-val">{{ health.memory.heapUsed }} / {{ health.memory.heapTotal }} MB</span>
        </div>
        <el-progress
          :percentage="heapPct(health)"
          :stroke-width="6"
          :show-text="false"
          :color="heapPct(health) > 85 ? '#f56c6c' : heapPct(health) > 60 ? '#e6a23c' : '#67c23a'"
        />
      </div>

      <!-- Data -->
      <div class="health-card">
        <div class="health-card__title">
          数据缓存
        </div>
        <div class="health-row">
          <span>在线用户</span>
          <span class="health-val">{{ health.data.users }}</span>
        </div>
        <div class="health-row">
          <span>操盘账号</span>
          <span class="health-val">{{ health.data.accounts }}</span>
        </div>
        <div class="health-row">
          <span>活跃比赛</span>
          <span class="health-val">{{ health.data.clientMatches }}</span>
        </div>
      </div>

      <!-- Esport API timing -->
      <div v-if="health.esportApi" class="health-card health-card--wide">
        <div class="health-card__title">
          Esport API 延迟（服务端）
        </div>
        <div class="health-row">
          <span>最近请求</span>
          <span class="health-val" :class="delayColor(health.esportApi.lastDelayMs)">
            {{ health.esportApi.lastDelayMs }}ms
            <span class="health-sub"> · {{ health.esportApi.lastAction || "—" }}</span>
          </span>
        </div>
        <div class="health-row">
          <span>累计 POST</span>
          <span class="health-val">{{ health.esportApi.counter }}</span>
        </div>
        <div v-if="health.esportApi.lastAt" class="health-row health-row--sub">
          <span />
          <span class="health-sub">最近完成: {{ agoStr(health.esportApi.lastAt) }}</span>
        </div>
        <div v-if="health.esportApi.byAction.length" class="health-api-table-wrap">
          <table class="health-api-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>次数</th>
                <th>均耗</th>
                <th>最大</th>
                <th>最近</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in health.esportApi.byAction" :key="row.action">
                <td>{{ row.action }}</td>
                <td>{{ row.count }}</td>
                <td>{{ row.avgMs }}ms</td>
                <td :class="delayColor(row.maxMs)">
                  {{ row.maxMs }}ms
                </td>
                <td>{{ row.lastMs }}ms</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="health.esportApi.slowRecent.length" class="health-slow-list">
          <div class="health-sub">
            慢请求（≥500ms）
          </div>
          <div
            v-for="(row, idx) in health.esportApi.slowRecent"
            :key="`${row.action}-${row.at}-${idx}`"
            class="health-row health-row--sub"
          >
            <span class="health-sub">{{ row.action }}</span>
            <span class="health-val" :class="delayColor(row.durationMs)">
              {{ row.durationMs }}ms · {{ agoStr(row.at) }}
            </span>
          </div>
        </div>
      </div>

      <!-- WebSocket Forward -->
      <div class="health-card health-card--wide">
        <div class="health-card__title">
          WebSocket 转发
        </div>
        <div class="health-row">
          <span>中继服务</span>
          <el-tag :type="health.wsForward.enabled ? 'success' : 'danger'" size="small" effect="dark">
            {{ health.wsForward.enabled ? '已启用' : '未启用' }}
          </el-tag>
        </div>
        <div
          v-for="pid in health.wsForward.platforms"
          :key="pid"
          class="health-platform"
        >
          <div class="health-row">
            <span class="health-platform-name">
              <span
                class="health-platform-dot"
                :class="{
                  'health-platform-dot--active': health.wsForward.platformStats?.[pid]?.active,
                  'health-platform-dot--error': health.wsForward.platformStats?.[pid]?.lastError && Date.now() - (health.wsForward.platformStats?.[pid]?.lastErrorAt ?? 0) < 600000,
                }"
              />
              {{ pid }}
            </span>
            <span v-if="health.wsForward.platformStats?.[pid]" class="health-val">
              {{ health.wsForward.platformStats[pid].active }} 连接
              <span class="health-sub">(累计 {{ health.wsForward.platformStats[pid].totalConnections }})</span>
            </span>
            <span v-else class="health-val health-sub">idle</span>
          </div>
          <div v-if="health.wsForward.platformStats?.[pid]?.lastConnectedAt" class="health-row health-row--sub">
            <span />
            <span class="health-sub">最近连接: {{ agoStr(health.wsForward.platformStats[pid].lastConnectedAt) }}</span>
          </div>
          <div
            v-if="health.wsForward.platformStats?.[pid]?.lastError && Date.now() - (health.wsForward.platformStats?.[pid]?.lastErrorAt ?? 0) < 600000"
            class="health-row health-row--sub"
          >
            <span />
            <span class="health-val--bad">{{ health.wsForward.platformStats[pid].lastError }}</span>
          </div>
        </div>
      </div>

      <!-- PM-MARKET Hub 连接监测 -->
      <div
        v-if="health.wsForward.hubs?.pmMarket"
        class="health-card health-card--wide"
      >
        <div class="health-card__title">
          PM-MARKET Hub
        </div>
        <div
          v-for="site in pmHubSites"
          :key="site.id"
          class="health-platform"
        >
          <div class="health-row">
            <span>{{ site.label }}</span>
            <template v-if="site.hub">
              <el-tag
                :type="site.hub.upstreamConnected ? 'success' : 'info'"
                size="small"
                effect="dark"
              >
                {{ site.hub.upstreamConnected ? '上游已连' : '上游未连' }}
              </el-tag>
            </template>
            <el-tag v-else type="info" size="small">
              不可达
            </el-tag>
          </div>
          <div v-if="site.hub" class="health-row health-row--sub">
            <span />
            <span class="health-val">
              {{ site.hub.activeClients }} 连接
              <span class="health-sub">
                · 订阅 {{ site.hub.subscribedAssets }} assets
                · soft-skip {{ site.hub.softSkipTotal ?? 0 }}
                · hard-skip {{ site.hub.hardSkipTotal ?? 0 }}
              </span>
            </span>
          </div>
        </div>
        <div
          v-if="pmHubClientRows.length"
          class="health-api-table-wrap"
        >
          <table class="health-api-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>用户</th>
                <th>IP</th>
                <th>assets</th>
                <th>drop</th>
                <th>soft</th>
                <th>coalesced</th>
                <th>pending</th>
                <th>age</th>
                <th>buf</th>
                <th>时长</th>
                <th>UA</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in pmHubClientRows"
                :key="`${row.siteId}-${row.id}`"
              >
                <td>{{ row.siteLabel }}</td>
                <td :title="row.userId || undefined">
                  {{ row.userName || row.userId || '未鉴权' }}
                </td>
                <td>{{ row.remoteAddress || '—' }}</td>
                <td>{{ row.assetCount }}</td>
                <td :class="{ 'health-val--bad': row.droppedToClient > 0 }">
                  {{ row.droppedToClient }}
                </td>
                <td :class="{ 'health-val--warn': (row.softSkipToClient ?? 0) > 0 }">
                  {{ row.softSkipToClient ?? 0 }}
                </td>
                <td>{{ row.coalescedToClient ?? 0 }}</td>
                <td :class="{ 'health-val--warn': (row.pendingAssets ?? 0) > 0 }">
                  {{ row.pendingAssets ?? 0 }}
                </td>
                <td :class="{ 'health-val--warn': (row.pendingAgeMs ?? 0) > 500 }">
                  {{ row.pendingAgeMs ?? 0 }}ms
                </td>
                <td>{{ row.lastBufferedAmount }}</td>
                <td>{{ row.connectedForSec }}s</td>
                <td class="health-sub">
                  {{ row.userAgent || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-else
          class="health-row health-row--sub"
        >
          <span class="health-sub">暂无客户端连接</span>
        </div>
      </div>

      <div class="health-card health-card--wide">
        <div class="health-card__title health-card__title-row">
          <span>PM-M 生产观测</span>
          <el-button size="small" :loading="pmMarketObsLoading" @click="fetchPmMarketObservability">
            刷新
          </el-button>
        </div>
        <el-alert
          v-if="pmMarketObsError"
          type="error"
          :closable="false"
          :title="pmMarketObsError"
          class="health-error"
        />
        <template v-if="pmMarketObs">
          <div class="health-row">
            <span>总状态</span>
            <el-tag :type="pmMarketObs.status === 'ok' ? 'success' : 'danger'" size="small" effect="dark">
              {{ pmMarketObs.status }}
            </el-tag>
          </div>
          <div class="health-row health-row--sub">
            <span />
            <span class="health-sub">
              {{ new Date(pmMarketObs.checkedAt).toLocaleString("zh-CN", { hour12: false }) }}
              · timeout {{ pmMarketObs.timeoutMs }}ms
            </span>
          </div>
          <div class="health-row">
            <span>CLOB</span>
            <span class="health-val">{{ pmMarketObs.upstream.clobOrigin }}</span>
          </div>
          <div class="health-row health-row--sub">
            <span>time</span>
            <el-tag :type="probeTagType(pmMarketObs.upstream.clob.time)" size="small">
              {{ probeText(pmMarketObs.upstream.clob.time) }}
            </el-tag>
          </div>
          <div class="health-row health-row--sub">
            <span>book</span>
            <el-tag :type="probeTagType(pmMarketObs.upstream.clob.book)" size="small">
              {{ probeText(pmMarketObs.upstream.clob.book) }}
            </el-tag>
          </div>
          <div class="health-row">
            <span>官方 Market WS</span>
            <span class="health-val">{{ pmMarketObs.upstream.marketWsUrl }}</span>
          </div>
          <div class="health-row health-row--sub">
            <span>DNS / TCP / TLS</span>
            <span class="health-probe-tags">
              <el-tag :type="probeTagType(pmMarketObs.upstream.dns.marketWs)" size="small">
                DNS {{ probeText(pmMarketObs.upstream.dns.marketWs) }}
              </el-tag>
              <el-tag :type="probeTagType(pmMarketObs.upstream.marketWs.tcp)" size="small">
                TCP {{ probeText(pmMarketObs.upstream.marketWs.tcp) }}
              </el-tag>
              <el-tag :type="probeTagType(pmMarketObs.upstream.marketWs.tls)" size="small">
                TLS {{ probeText(pmMarketObs.upstream.marketWs.tls) }}
              </el-tag>
            </span>
          </div>
          <div class="health-row">
            <span>Hub 来源</span>
            <span class="health-val">{{ pmMarketObs.hub.source }}</span>
          </div>
          <div class="health-row health-row--sub">
            <span />
            <span class="health-val">
              {{ pmMarketObs.summary.activeClients }} 连接
              <span class="health-sub">
                · 订阅 {{ pmMarketObs.summary.subscribedAssets }}
                · 上游 {{ pmMarketObs.summary.upstreamConnected ? "已连" : "未连" }}
                · pending {{ pmMarketObs.summary.pendingMaxAgeMs }}ms
              </span>
            </span>
          </div>
          <div v-if="pmMarketObs.summary.failedChecks.length" class="health-row health-row--sub">
            <span>失败项</span>
            <span class="health-val--bad">{{ pmMarketObs.summary.failedChecks.join(", ") }}</span>
          </div>
          <div class="health-row">
            <span>当前浏览器</span>
            <span class="health-val">{{ pmMarketClientMetrics.mode }}</span>
          </div>
          <div class="health-row health-row--sub">
            <span />
            <span class="health-val">
              connect {{ msText(pmMarketClientMetrics.connectMs) }}
              <span class="health-sub">
                · frame {{ msText(pmMarketClientMetrics.firstFrameMs) }}
                · quote {{ msText(pmMarketClientMetrics.firstQuoteMs) }}
                · fresh {{ msText(pmMarketClientMetrics.quoteFreshMs) }}
              </span>
            </span>
          </div>
          <div class="health-row">
            <span>PM 执行窗口</span>
            <span class="health-val">
              {{ pmExecutionMetrics.total }} / {{ pmExecutionMetrics.windowSize }}
              <span class="health-sub">
                · book {{ kindLatencyText(pmExecutionMetrics.byKind.book) }}
              </span>
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span>book 来源</span>
            <span class="health-sub">
              direct {{ pmExecutionMetrics.book.directLive }}
              · fallback {{ pmExecutionMetrics.book.vpsFallback }}
              · direct率 {{ rateText(pmExecutionMetrics.book.directLiveRate) }}
              · fallback率 {{ rateText(pmExecutionMetrics.book.fallbackRate) }}
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span>book 复用</span>
            <span class="health-sub">
              {{ pmExecutionMetrics.bookReuse.hit }}/{{ pmExecutionMetrics.bookReuse.observed }}
              · 命中 {{ rateText(pmExecutionMetrics.bookReuse.hitRate) }}
              · age p90 {{ msText(pmExecutionMetrics.bookReuse.ageP90Ms) }}
              · 拒因 {{ topReasonText(pmExecutionMetrics.bookReuse.rejectReasons) }}
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span>sign / submit</span>
            <span class="health-sub">
              sign {{ kindLatencyText(pmExecutionMetrics.byKind.sign) }}
              · cache {{ rateText(pmExecutionMetrics.sign.cacheHitRate) }}
              · submit {{ kindLatencyText(pmExecutionMetrics.byKind.submit) }}
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span>执行价格</span>
            <span class="health-sub">
              样本 {{ pmExecutionMetrics.execution.observed }}
              · 检测cap p50 {{ priceText(pmExecutionMetrics.execution.detectionMaxPriceP50) }}
              · book p50 {{ priceText(pmExecutionMetrics.execution.bookPriceP50) }}
              · fill p50 {{ priceText(pmExecutionMetrics.execution.fillPriceP50) }}
              · limit p50 {{ priceText(pmExecutionMetrics.execution.limitPriceP50) }}
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span>可成交深度</span>
            <span class="health-sub">
              预算 p50 {{ numberText(pmExecutionMetrics.execution.apiBetMoneyP50) }}
              · cap内深度 p50 {{ numberText(pmExecutionMetrics.execution.depthAvailableAtCapP50) }}
              · 需求 p50 {{ numberText(pmExecutionMetrics.execution.depthNeedUsdcP50) }}
              · submit {{ pmSubmitStatusText }}
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span>quote→fo</span>
            <span class="health-sub">
              {{ kindCountText("quote_to_fo") }}
              · 成功率 {{ rateText(pmExecutionMetrics.quoteToFo.successRate) }}
              · 拒因 {{ topReasonText(pmExecutionMetrics.quoteToFo.rejectReasons) }}
            </span>
          </div>
          <div class="health-row health-row--sub">
            <span />
            <span class="health-sub">
              assets {{ pmMarketClientMetrics.assetCount }}
              · attempts {{ pmMarketClientMetrics.connectionAttemptCount }}
              · reconnect {{ pmMarketClientMetrics.reconnectCount }}
              · empty-book {{ pmMarketClientMetrics.emptyBookCount }}
              <template v-if="pmMarketClientMetrics.fallbackReason">
                · fallback {{ pmMarketClientMetrics.fallbackReason }}
              </template>
            </span>
          </div>
        </template>
        <div v-else class="health-row health-row--sub">
          <span class="health-sub">等待观测数据</span>
        </div>
      </div>
    </div>
    <div v-else-if="loading" class="health-loading">
      加载中...
    </div>
  </AdminLayout>
</template>

<style scoped>
.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}
.health-banner {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
}
.health-banner--ok { background: rgba(103, 194, 58, 0.1); color: #67c23a; }
.health-banner--bad { background: rgba(245, 108, 108, 0.1); color: #f56c6c; }
.health-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: currentColor;
  animation: pulse 2s infinite;
}
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
.health-banner-meta { margin-left: auto; font-size: 13px; font-weight: 400; opacity: .7; }
.health-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 18px;
}
.health-card--wide { grid-column: 1 / -1; }
.health-route { margin-bottom: 16px; }
.health-route__row { margin: 10px 0; }
.health-route__label {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.health-route__origins { display: flex; gap: 16px; flex-wrap: wrap; }
.health-card__title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
  font-weight: 600;
}
.health-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.health-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.health-row--sub { padding: 0 0 4px; }
.health-val { font-weight: 500; font-variant-numeric: tabular-nums; }
.health-val--ok { color: #67c23a; }
.health-val--warn { color: #e6a23c; }
.health-val--bad { color: #f56c6c; }
.health-api-table-wrap { margin-top: 10px; overflow-x: auto; }
.health-api-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.health-api-table th,
.health-api-table td {
  padding: 4px 8px;
  text-align: left;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.health-api-table th {
  color: var(--el-text-color-secondary);
  font-weight: 600;
}
.health-slow-list { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--el-border-color-extra-light); }
.health-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.health-platform { border-top: 1px solid var(--el-border-color-extra-light); padding-top: 6px; margin-top: 6px; }
.health-platform:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
.health-platform-name { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.health-platform-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--el-text-color-placeholder);
}
.health-platform-dot--active { background: #67c23a; }
.health-platform-dot--error { background: #f56c6c; }
.health-probe-tags { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.health-error { margin-bottom: 16px; }
.health-loading { text-align: center; padding: 40px; color: var(--el-text-color-secondary); }
</style>
