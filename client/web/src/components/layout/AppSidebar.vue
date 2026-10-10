<script setup lang="ts">
import FootballOrderView from "@/components/football/FootballOrderView.vue";
import UserInfoPanel from "@/components/user/UserInfoPanel.vue";
import OrderView from "@/orderModes/OrderHost.vue";

withDefaults(
  defineProps<{
    embedded?: boolean;
    embeddedUserId?: string;
    embeddedUserName?: string;
    showFootballSettings?: boolean;
    workspace?: "esport" | "sports";
  }>(),
  { embedded: false, showFootballSettings: false, workspace: "esport" },
);

defineEmits<{ logout: []; viewOrders: []; openFootballSettings: [] }>();
</script>

<template>
  <div class="app-sidebar">
    <UserInfoPanel
      :embedded="embedded"
      :embedded-user-name="embeddedUserName"
      :show-football-settings="showFootballSettings"
      :workspace="workspace"
      @logout="$emit('logout')"
      @view-orders="$emit('viewOrders')"
      @open-football-settings="$emit('openFootballSettings')"
    />
    <FootballOrderView v-if="workspace === 'sports'" />
    <template v-else>
      <OrderView
        :embedded="embedded"
        :embedded-user-id="embeddedUserId"
        :workspace="workspace"
      />
    </template>
  </div>
</template>
