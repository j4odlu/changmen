<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { getDexSocketStatus, onDexSocketStatus } from "@changmen/venue-browser/adapter/dex";
import type { DexSocketStatus } from "@changmen/venue-browser/adapter/dex";

const status = ref<DexSocketStatus>(getDexSocketStatus());

let unsub: (() => void) | undefined;

onMounted(() => {
  unsub = onDexSocketStatus((s) => {
    status.value = s;
  });
});

onUnmounted(() => {
  unsub?.();
});

function dotClass(s: DexSocketStatus): string {
  switch (s) {
    case "connected": return "ok";
    case "connecting": return "connecting";
    case "error": return "err";
    default: return "idle";
  }
}

function tooltip(s: DexSocketStatus): string {
  switch (s) {
    case "connected": return "DexSport WS 已连接\n实时赔率推送中";
    case "connecting": return "DexSport WS 连接中...";
    case "error": return "DexSport WS 断开\n正在重连...";
    default: return "DexSport WS 未连接";
  }
}
</script>

<template>
  <div class="dex-socket-badge" :title="tooltip(status)">
    <span class="dex-socket-dot" :class="dotClass(status)" />
    <span class="dex-socket-label">DEX</span>
  </div>
</template>

<style scoped>
.dex-socket-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: #00000080;
  border: 1px solid #ffffff1a;
  font-size: 13px;
  font-weight: 600;
  color: #ffffffd9;
  cursor: default;
  user-select: none;
}

.dex-socket-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dex-socket-dot.ok {
  background-color: #67c23a;
  box-shadow: 0 0 6px #67c23acc;
}

.dex-socket-dot.connecting {
  background-color: #e6a23c;
  box-shadow: 0 0 6px #e6a23ccc;
  animation: pulse 1.5s infinite;
}

.dex-socket-dot.err {
  background-color: #f56c6c;
  box-shadow: 0 0 6px #f56c6ccc;
}

.dex-socket-dot.idle {
  background-color: #ffffff66;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
