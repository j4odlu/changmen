<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, onUnmounted, ref } from "vue";
import {
  clearLocalSportObSession,
  publicLocalSportObSession,
  saveLocalSportObSessionFromPaste,
} from "@/runtime/obSportSessionLocal";
import { fetchPandaSportTrialPaste } from "@/runtime/obSportTrial";
import { clearObFootballClientCache } from "@/runtime/obSportFootballFetch";
import { notifySportObSessionUpdated, SPORT_OB_SESSION_UPDATED } from "@/runtime/sportObSessionEvents";
import { OB_SPORT_WS_ID, resolveObSportWsUrl } from "@/runtime/obSportWs";
import { getVenueWsStatus, subscribeVenueWsStatus } from "@changmen/venue-browser/adapter/shared";

const props = withDefaults(
  defineProps<{
    layout?: "bar" | "panel" | "chip";
  }>(),
  { layout: "bar" },
);

const emit = defineEmits<{
  saved: [];
  openSettings: [];
}>();

const paste = ref("");
const saving = ref(false);
const fetchingTrial = ref(false);
const configured = ref(false);
const summary = ref("");
const wsStatus = ref(getVenueWsStatus(OB_SPORT_WS_ID));
let unsubWs: (() => void) | undefined;

function wsLabel(status: string) {
  if (status === "connected")
    return "WS 已连接";
  if (status === "connecting")
    return "WS 连接中";
  if (status === "error")
    return "WS 断开";
  return "WS 未连";
}

async function refresh() {
  const info = publicLocalSportObSession();
  configured.value = Boolean(info.configured);
  if (info.configured) {
    const gw = info.gateway ? "有网关" : "无网关（粘贴未带 api.*）";
    const push = resolveObSportWsUrl(info) ? "有推送地址" : "无推送地址";
    summary.value = `${info.tokenMasked || "token"} · ${gw} · ${push} · ${wsLabel(wsStatus.value)}`;
  }
  else {
    summary.value = "未配置（足球页仍显示 PM/PF）";
  }
}

async function fillTrialToken() {
  fetchingTrial.value = true;
  try {
    paste.value = await fetchPandaSportTrialPaste();
    ElMessage.success("已填入试玩 token，请点保存");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
  finally {
    fetchingTrial.value = false;
  }
}

async function save() {
  const raw = paste.value.trim();
  if (!raw)
    return;
  saving.value = true;
  try {
    const info = saveLocalSportObSessionFromPaste(raw);
    clearObFootballClientCache();
    paste.value = "";
    if (info.gateway) {
      ElMessage.success("体育 OB 会话已保存，正在连接推送");
    }
    else {
      ElMessage.warning("token 已保存，但没有网关，无法拉赛程。请从含 api 网关的数据再贴一次。");
    }
    notifySportObSessionUpdated();
    await refresh();
    emit("saved");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
  finally {
    saving.value = false;
  }
}

async function clearSession() {
  saving.value = true;
  try {
    clearLocalSportObSession();
    clearObFootballClientCache();
    ElMessage.success("已清除体育 OB 会话");
    notifySportObSessionUpdated();
    await refresh();
    emit("saved");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
  finally {
    saving.value = false;
  }
}

function onExternalUpdate() {
  void refresh();
  emit("saved");
}

onMounted(() => {
  void refresh();
  unsubWs = subscribeVenueWsStatus(() => {
    wsStatus.value = getVenueWsStatus(OB_SPORT_WS_ID);
    void refresh();
  });
  window.addEventListener(SPORT_OB_SESSION_UPDATED, onExternalUpdate);
});

onUnmounted(() => {
  unsubWs?.();
  window.removeEventListener(SPORT_OB_SESSION_UPDATED, onExternalUpdate);
});
</script>

<template>
  <button
    v-if="props.layout === 'chip'"
    type="button"
    class="ob-sport-session ob-sport-session--chip"
    :class="{ on: configured, live: wsStatus === 'connected' }"
    title="打开足球设置"
    @click="emit('openSettings')"
  >
    足球设置 · {{ summary }}
  </button>
  <div v-else class="ob-sport-session" :class="{ 'ob-sport-session--panel': props.layout === 'panel' }">
    <span
      class="ob-sport-session__status"
      :class="{ on: configured, live: wsStatus === 'connected' }"
    >
      OB 体育采集 · {{ summary }}
    </span>
    <el-input
      v-model="paste"
      class="ob-sport-session__paste"
      type="textarea"
      :autosize="{ minRows: props.layout === 'panel' ? 4 : 2, maxRows: 8 }"
      size="small"
      placeholder="粘贴插件「数据」JSON / base64 / 进馆 URL（kind=sport）。本机保存，页面直连"
    />
    <div class="ob-sport-session__actions">
      <el-button size="small" type="primary" :loading="saving" :disabled="fetchingTrial" @click="save">
        保存
      </el-button>
      <el-button size="small" :loading="fetchingTrial" :disabled="saving" @click="fillTrialToken">
        试玩token
      </el-button>
      <el-button size="small" link :disabled="!configured || saving || fetchingTrial" @click="clearSession">
        清除
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.ob-sport-session {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 8px;
  flex-wrap: wrap;
}
.ob-sport-session--panel {
  margin: 0;
  align-items: stretch;
  flex-direction: column;
}
.ob-sport-session--chip {
  margin: 0 10px 8px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
  text-align: left;
}
.ob-sport-session--chip.on {
  color: #eab308;
}
.ob-sport-session--chip.live {
  color: #67c23a;
}
.ob-sport-session--chip:hover {
  text-decoration: underline;
}
.ob-sport-session__status {
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
}
.ob-sport-session__status.on {
  color: #eab308;
}
.ob-sport-session__status.live {
  color: #67c23a;
}
.ob-sport-session__paste {
  flex: 1 1 280px;
  min-width: 180px;
  max-width: 520px;
}
.ob-sport-session--panel .ob-sport-session__paste {
  max-width: none;
  flex: 1 1 auto;
}
.ob-sport-session__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
</style>
