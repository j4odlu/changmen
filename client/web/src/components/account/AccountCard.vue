<script setup lang="ts">
import type { PlatformAccount } from "@/models/platformAccount";
import { ElMessageBox } from "element-plus";
import { computed } from "vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import {
  ensurePmVaultUnlocked,
  ensurePmVaultForAccounts,
  normalizePmVaultUserId,
  pmAccountShowsUnlockPending,
} from "@/security/pmVault";
import { useUserStore } from "@/stores/userStore";
import { readObSportDisplayBalance, sportObSessionFromAccount } from "@/runtime/obSportBetAccount";

const props = defineProps<{
  account: PlatformAccount;
  readonly?: boolean;
  preview?: boolean;
  workspace?: "esport" | "sports";
}>();

const userStore = useUserStore();

const pmNeedsUnlock = computed(() => {
  if (props.preview)
    return false;
  return pmAccountShowsUnlockPending(props.account, userStore.userId);
});

const shownBalance = computed(() => {
  if (props.workspace === "sports" && sportObSessionFromAccount(props.account))
    return readObSportDisplayBalance(props.account);
  return props.account.balance;
});

const shownStale = computed(() => {
  if (props.workspace === "sports" && sportObSessionFromAccount(props.account))
    return Boolean(props.account.sportBalanceStale);
  return Boolean(props.account.balanceStale);
});

const shownErrorLabel = computed(() => {
  if (props.workspace !== "sports" || !sportObSessionFromAccount(props.account))
    return "TOKEN ERROR";
  const msg = String(props.account.sportBalanceError || "");
  if (/token|requestId|登录|鉴权|unauthor/i.test(msg))
    return "体育 TOKEN 错误";
  if (/uid|会员/i.test(msg))
    return "体育 UID 错误";
  if (/gateway|网关|network|cors|timeout|超时|HTTP/i.test(msg))
    return "体育网络错误";
  return msg ? "体育刷新失败" : "体育待刷新";
});

const shownBalanceTitle = computed(() => {
  if (pmNeedsUnlock.value)
    return "本机钱包未解锁，鼠标移入后点钥匙按钮解锁";
  if (shownStale.value)
    return props.account.sportBalanceError || "刷新失败，显示上次余额";
  if (props.workspace === "sports" && shownBalance.value === undefined)
    return props.account.sportBalanceError || "体育余额尚未刷新";
  return undefined;
});

const emit = defineEmits<{ refresh: []; edit: []; money: []; remove: [] }>();

async function promptPmVaultUnlock() {
  if (!pmNeedsUnlock.value || props.preview)
    return;
  const uid = normalizePmVaultUserId(useUserStore().userId);
  if (!uid)
    return;
  if (String(props.account.provider) === "Polymarket") await ensurePmVaultForAccounts(uid, [props.account]);
  else await ensurePmVaultUnlocked(uid);
}

function formatBalance(value?: number) {
  if (value === undefined || Number.isNaN(value))
    return "";
  const currency = String(props.account.currency || "").toUpperCase();
  // USDT/USD：保留两位；其余馆对齐 A8 整数展示
  if (currency === "USDT" || currency === "USD")
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.floor(value).toLocaleString();
}

function todayTagType(value: number) {
  if (value === 0)
    return undefined;
  return value > 0 ? "success" : "danger";
}

function profitPercent(account: PlatformAccount) {
  if (!account.maxProfit || !account.totalProfit)
    return 0;
  const pct = (account.totalProfit * 100) / account.maxProfit;
  return Math.min(100, Math.max(0, pct));
}

async function showPause(reason: string | false) {
  if (!reason)
    return;
  await ElMessageBox.alert(String(reason), "暂停原因");
}

async function confirmRemove() {
  try {
    await ElMessageBox.confirm("确认要删除账号吗？", "注销", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });
    emit("remove");
  }
  catch {
    /* cancelled */
  }
}

</script>

<template>
  <div
    class="account"
    :class="[
      account.provider,
      {
        pause: account.isPause(),
        loading: account.loadingBalance,
        'vault-locked': pmNeedsUnlock,
      },
    ]"
  >
    <PlatformIcon :platform="account.provider" />
    <div class="platform" :class="{ active: account.active }">
      {{ account.platformName || account.provider }} / {{ account.venueAccountName || account.playerName || "—" }}
    </div>

    <div
      class="balance"
      :class="{
        danger:
          shownBalance !== undefined
          && account.maxBalance !== 0
          && shownBalance > account.maxBalance,
        error: shownBalance === undefined,
        stale: shownBalance !== undefined && shownStale,
      }"
      :data-error-label="shownErrorLabel"
      :title="shownBalanceTitle"
    >
      <label class="currency">
        {{ account.currency || 'CNY' }}
      </label>
      <template v-if="shownBalance !== undefined && !pmNeedsUnlock">
        {{ formatBalance(shownBalance) }}
      </template>
    </div>

    <div v-if="pmNeedsUnlock" class="vault-unlock-hint">
      待解锁
    </div>

    <div v-if="!readonly || preview" class="toolbar flex flex-wrap flex-center flex-middle">
      <el-button
        v-if="pmNeedsUnlock"
        title="解锁本机钱包"
        size="small"
        type="warning"
        class="am-icon-key vault-unlock-btn"
        :disabled="preview"
        @click="promptPmVaultUnlock"
      />
      <el-button
        title="刷新"
        size="small"
        class="iconfont-base-refresh"
        :loading="account.loadingBalance"
        :disabled="preview"
        @click="emit('refresh')"
      />
      <el-button
        title="充提登记"
        size="small"
        class="iconfont-base-bank"
        :disabled="preview"
        @click="emit('money')"
      />
      <el-button
        title="编辑账号"
        size="small"
        class="iconfont-base-edit"
        @click="emit('edit')"
      />
      <el-button
        title="注销"
        size="small"
        class="am-icon-power-off"
        :disabled="preview"
        @click="confirmRemove"
      />
      <el-button
        v-if="account.isPause()"
        title="暂停原因"
        size="small"
        class="am-icon-pause-circle"
        @click="showPause(account.isPause())"
      />
    </div>

    <div v-if="workspace !== 'sports'" class="profit flex flex-center">
      <el-tag size="small" round effect="dark" :type="todayTagType(account.today)">
        {{ account.today.toLocaleString() }}
      </el-tag>
      <el-tag v-if="account.orderCount" size="small" round style="margin-left: 6px">
        {{ account.unsettle }}/{{ account.orderCount }}
      </el-tag>
    </div>

    <div v-if="account.maxProfit" class="totalProfit">
      <el-tooltip
        class="box-item"
        effect="light"
        placement="bottom"
        :content="`当前盈利:${account.totalProfit?.toFixed(0) ?? 0}/${account.maxProfit}`"
      >
        <el-progress
          color="#f56c6c"
          :text-inside="true"
          :percentage="profitPercent(account)"
          :format="() => ''"
          style="width: 100%"
        />
      </el-tooltip>
    </div>
  </div>
</template>
