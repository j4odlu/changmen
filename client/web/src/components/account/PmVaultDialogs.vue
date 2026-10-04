<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  completePmVaultSetup,
  completePmVaultUnlock,
  pmVaultUi,
  setupPmVault,
  unlockPmVault,
  retainedPmSessionUi,
  setRetainedPmEnabled,
  setRetainedPmHours,
} from "@/security/pmVault";

const password = ref("");
const password2 = ref("");
const localError = ref("");
function updateRetention(value: unknown) { void setRetainedPmEnabled(Boolean(value), pmVaultUi.userId); }
function updateRetentionHours(value: unknown) { setRetainedPmHours(Number(value)); }

const unlockOpen = computed({
  get: () => pmVaultUi.needUnlock,
  set: (v: boolean) => {
    // 派生密钥过程中忽略关闭，避免 session 已解锁但 mount 误判失败
    if (!v && pmVaultUi.needUnlock && !pmVaultUi.busy)
      completePmVaultUnlock(false);
  },
});

const setupOpen = computed({
  get: () => pmVaultUi.needSetup,
  set: (v: boolean) => {
    if (!v && pmVaultUi.needSetup && !pmVaultUi.busy)
      completePmVaultSetup(false);
  },
});

watch(
  () => [pmVaultUi.needUnlock, pmVaultUi.needSetup] as const,
  () => {
    password.value = "";
    password2.value = "";
    localError.value = "";
  },
);

async function onUnlock() {
  localError.value = "";
  pmVaultUi.busy = true;
  try {
    await unlockPmVault(pmVaultUi.userId, password.value);
    password.value = "";
    completePmVaultUnlock(true);
  }
  catch (err) {
    localError.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    pmVaultUi.busy = false;
  }
}

async function onSetup() {
  localError.value = "";
  if (password.value.length < 8) {
    localError.value = "本机钱包密码至少 8 位";
    return;
  }
  if (password.value !== password2.value) {
    localError.value = "两次输入的密码不一致";
    return;
  }
  pmVaultUi.busy = true;
  try {
    await setupPmVault(pmVaultUi.userId, password.value);
    password.value = "";
    password2.value = "";
    completePmVaultSetup(true);
  }
  catch (err) {
    localError.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    pmVaultUi.busy = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="unlockOpen"
    title="解锁本机钱包"
    width="420px"
    :close-on-click-modal="false"
    :close-on-press-escape="!pmVaultUi.busy"
    :show-close="!pmVaultUi.busy"
    append-to-body
  >
    <p class="pm-vault-hint">
      本机已加密保存钱包私钥。解锁后本页可自动下注。PM 可通过新版插件保持本次工作会话，刷新免输密码；其他场馆不保持。
      若点「稍后再说」，可稍后在账号设置里保存/导入私钥时再解锁，或刷新页面重新提示。
    </p>
    <el-checkbox :model-value="retainedPmSessionUi.enabled" :disabled="pmVaultUi.busy"
      @update:model-value="updateRetention">
      保持 PM 解锁会话
    </el-checkbox>
    <el-select v-if="retainedPmSessionUi.enabled" :model-value="retainedPmSessionUi.hours" style="width: 190px; margin-bottom: 12px"
      :disabled="pmVaultUi.busy" @update:model-value="updateRetentionHours">
      <el-option :value="0" label="直到浏览器退出" />
      <el-option :value="1" label="1 小时" /><el-option :value="4" label="4 小时" /><el-option :value="8" label="8 小时" /><el-option :value="24" label="24 小时" />
    </el-select>
    <p class="pm-vault-hint">退出、锁定、浏览器重启或插件更新后重新解锁。插件不可用时使用原有密码流程；导入私钥仍需密码。</p>
    <p v-if="retainedPmSessionUi.enabled && retainedPmSessionUi.hours === 0" class="pm-vault-hint">适合长期挂机；无人操作或暂停挂机不会锁定。解锁私钥会在浏览器运行期间保留，请使用可信电脑。</p>
    <el-input
      v-model="password"
      type="password"
      show-password
      placeholder="本机钱包主密码"
      autocomplete="current-password"
      @keyup.enter="onUnlock"
    />
    <p v-if="localError || pmVaultUi.error" class="pm-vault-error">
      {{ localError || pmVaultUi.error }}
    </p>
    <template #footer>
      <el-button :disabled="pmVaultUi.busy" @click="completePmVaultUnlock(false)">
        稍后再说
      </el-button>
      <el-button type="primary" :loading="pmVaultUi.busy" @click="onUnlock">
        解锁
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="setupOpen"
    title="设置本机钱包密码"
    width="460px"
    :close-on-click-modal="false"
    :close-on-press-escape="!pmVaultUi.busy"
    :show-close="!pmVaultUi.busy"
    append-to-body
  >
    <p class="pm-vault-hint">
      此密码只存在本机，用于加密 Polymarket 私钥，不是登录密码。清除网站数据会丢失密文，需重新导入私钥。
    </p>
    <el-form label-position="top">
      <el-form-item label="本机钱包密码">
        <el-input
          v-model="password"
          type="password"
          show-password
          placeholder="至少 8 位"
          autocomplete="new-password"
        />
      </el-form-item>
      <el-form-item label="确认密码">
        <el-input
          v-model="password2"
          type="password"
          show-password
          placeholder="再输入一次"
          autocomplete="new-password"
          @keyup.enter="onSetup"
        />
      </el-form-item>
    </el-form>
    <p v-if="localError || pmVaultUi.error" class="pm-vault-error">
      {{ localError || pmVaultUi.error }}
    </p>
    <template #footer>
      <el-button :disabled="pmVaultUi.busy" @click="completePmVaultSetup(false)">
        取消
      </el-button>
      <el-button type="primary" :loading="pmVaultUi.busy" @click="onSetup">
        创建并继续
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pm-vault-hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.pm-vault-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--el-color-danger);
}
</style>
