<script setup lang="ts">
import type { PlatformAccount } from "@/models/platformAccount";
import { storeToRefs } from "pinia";
import { ref } from "vue";
import AccountCard from "@/components/account/AccountCard.vue";
import MoneyLogDialog from "@/components/account/MoneyLogDialog.vue";
import { useAccountStore } from "@/stores/accountStore";

/** 对齐 bundle AccountView：顶栏仅 providers 横排账号卡 */
const { embedded = false, workspace = "esport" } = defineProps<{
  embedded?: boolean;
  workspace?: "esport" | "sports";
}>();

const accountStore = useAccountStore();
const { sortedAccounts } = storeToRefs(accountStore);

const moneyOpen = ref(false);
const moneyAccountId = ref(0);

function openMoney(account: PlatformAccount) {
  moneyAccountId.value = account.accountId;
  moneyOpen.value = true;
}

async function refreshOne(account: PlatformAccount) {
  await account.updateBalance();
  // 与电竞账号刷新一致：余额之后立即拉该账号订单。
  // 体育工作区会由 venueOrders 路由到 footballOrderStore，不进入电竞 orders。
  await account.updateOrders();
  if (String(account.provider) === "PredictFun" && account.balance != null && !account.balanceStale) {
    const { ElMessage } = await import("element-plus");
    ElMessage.success(`余额已刷新：${Number(account.balance).toFixed(2)} USDT`);
  }
}

async function removeAccount(account: PlatformAccount) {
  await accountStore.deleteAccount(account.accountId);
}
</script>

<template>
  <div class="providers flex flex-wrap">
    <AccountCard
      v-for="acc in sortedAccounts"
      :key="acc.accountId"
      :account="acc"
      :preview="embedded"
      :workspace="workspace"
      @refresh="refreshOne(acc)"
      @edit="accountStore.openEditAccount(acc)"
      @money="openMoney(acc)"
      @remove="removeAccount(acc)"
    />

    <MoneyLogDialog
      v-if="!embedded"
      :open="moneyOpen"
      :account-id="moneyAccountId"
      @close="moneyOpen = false"
    />
  </div>
</template>
