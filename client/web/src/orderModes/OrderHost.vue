<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import OrderView from "@/components/order/OrderView.vue";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";

withDefaults(defineProps<{ embedded?: boolean; embeddedUserId?: string; workspace?: "esport" | "sports" }>(), { embedded: false, workspace: "esport" });
const fok = useOrderStore();
const user = useUserStore();
const hasPending = ref(false);
const PendingGtcOrders = defineAsyncComponent(() => import("./gtc/PendingOrders.vue"));
</script>

<template>
  <div class="order-mode-host" :class="{ 'order-mode-host--pending': hasPending }">
    <OrderView :embedded="embedded" :embedded-user-id="embeddedUserId" :workspace="workspace" />
    <PendingGtcOrders v-if="!embedded && user.userId" :date="fok.orderDate" :account-id="fok.filterAccountId" @has-orders="hasPending = $event" />
  </div>
</template>

<style scoped>
.order-mode-host { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; width: 100%; overflow: auto; }
.order-mode-host--pending :deep(.order-view-stack),
.order-mode-host--pending :deep(.orders) { flex: 0 0 auto !important; overflow: visible !important; }
</style>
