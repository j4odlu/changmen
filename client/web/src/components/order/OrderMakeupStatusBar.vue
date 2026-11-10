<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { visibleMakeupOrders } from "@/shared/makeupVisibility";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useUserStore } from "@/stores/userStore";

const loseStore = useLoseOrderStore();
const { orders } = storeToRefs(loseStore);
const user = useUserStore();
const linkBoundCount = computed(() => [...visibleMakeupOrders(orders.value, user.config.makeUp).values()]
  .filter(order => order.isLinkBoundMakeup()).length);
</script>

<template>
  <div v-if="linkBoundCount > 0" class="order-makeup-status">
    套利补单队列 ({{ linkBoundCount }}笔)
  </div>
</template>
