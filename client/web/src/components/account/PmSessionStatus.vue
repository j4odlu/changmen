<script setup lang="ts">
import { computed, ref } from "vue";
import { useUserStore } from "@/stores/userStore";
import { retainedPmSessionUi, revokeRetainedPmSession, setRetainedPmEnabled } from "@/security/pmVault/retainedPmSession";
const user = useUserStore();
const open = ref(false);
const busy = ref(false);
const buttonLabel = computed(() => retainedPmSessionUi.error ? "PM 钱包会话异常" : "PM 钱包已解锁");
const until = computed(() => retainedPmSessionUi.expiresAt
  > 0 ? new Date(retainedPmSessionUi.expiresAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
async function manageSession(action: "lock" | "disable") {
  if (busy.value) return;
  busy.value = true;
  try {
    const confirmed = action === "lock"
      ? await revokeRetainedPmSession(String(user.userId))
      : await setRetainedPmEnabled(false, String(user.userId));
    if (confirmed) open.value = false;
  } finally { busy.value = false; }
}
</script>

<template>
  <div v-if="user.userId && (retainedPmSessionUi.active || retainedPmSessionUi.lockPending || retainedPmSessionUi.error)" class="pm-session-status">
    <el-popover v-model:visible="open" trigger="click" placement="right-start" :width="280" title="PM 钱包">
      <template #reference>
        <el-button size="small" class="am-icon-key" :type="retainedPmSessionUi.error ? 'warning' : 'success'"
          :title="buttonLabel" :aria-label="buttonLabel" :aria-expanded="open" />
      </template>
      <p v-if="retainedPmSessionUi.active" class="pm-session-detail">
        {{ retainedPmSessionUi.expiresAt === -1 ? '保持至浏览器退出，刷新免解锁' : `保持至 ${until}，刷新免解锁` }}
      </p>
      <p v-else class="pm-session-detail">会话保持未生效</p>
      <p v-if="retainedPmSessionUi.error" class="pm-session-error">
        {{ retainedPmSessionUi.error }}<template v-if="retainedPmSessionUi.active">；本页解锁保留，正在重试</template>
      </p>
      <div class="pm-session-actions">
        <el-button v-if="retainedPmSessionUi.lockPending" size="small" :disabled="busy" @click="manageSession('lock')">重试锁定</el-button>
        <el-button v-if="retainedPmSessionUi.active" size="small" :disabled="busy" @click="manageSession('lock')">锁定 PM</el-button>
        <el-button size="small" :disabled="busy" @click="manageSession('disable')">关闭会话保持</el-button>
      </div>
    </el-popover>
  </div>
</template>

<style scoped>
.pm-session-status { display: flex; align-items: center; margin-right: 4px; }
.pm-session-detail { margin: 0 0 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.pm-session-error { margin: 0 0 12px; font-size: 12px; color: var(--el-color-warning); overflow-wrap: anywhere; }
.pm-session-actions { display: flex; align-items: center; }
</style>
