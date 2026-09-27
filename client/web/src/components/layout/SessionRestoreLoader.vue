<script setup lang="ts">
import { defineAsyncComponent } from "vue";

const LoginStarfield = defineAsyncComponent(() => import("@/components/layout/LoginStarfield.vue"));

defineProps<{ error?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div
    class="session-loader login-page login-page--betmoar container flex flex-middle flex-center"
    aria-busy="true"
    aria-label="加载中"
  >
    <LoginStarfield />
    <div class="login-stage login-stage--hero flex flex-column flex-middle flex-center">
      <p class="login-brand hero-word hero-word-0" aria-hidden="true">
        じらいや
      </p>
      <h1 class="login-hero-title session-loader__title" aria-label="Bet Bigger. Faster. Smarter.">
        <span class="hero-word hero-word-1">Bet</span>
        <span class="hero-word hero-word-2">Bigger.</span>
        <span class="hero-word hero-word-3">Faster.</span>
        <span class="hero-word hero-word-4 hero-word--accent">Smarter.</span>
      </h1>
      <div v-if="error" class="session-loader__error" role="alert">
        <p>{{ error }}</p>
        <button type="button" class="session-loader__retry" @click="$emit('retry')">
          重新连接
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-loader {
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.session-loader__error {
  position: relative;
  z-index: 2;
  margin-top: 28px;
  color: rgba(255, 255, 255, 0.86);
  text-align: center;
}

.session-loader__error p {
  margin: 0 0 12px;
}

.session-loader__retry {
  padding: 8px 20px;
  border: 1px solid rgba(96, 165, 250, 0.75);
  border-radius: 999px;
  color: #fff;
  background: rgba(37, 99, 235, 0.28);
  cursor: pointer;
}

.session-loader__retry:hover {
  background: rgba(37, 99, 235, 0.46);
}

/* 入场结束后 accent 轻脉冲，表示仍在恢复会话 */
.session-loader.login-page .session-loader__title :deep(.hero-word--accent) {
  animation:
    heroInAccent 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) 0.35s forwards,
    session-accent-pulse 1.6s ease-in-out 1s infinite;
}

@keyframes session-accent-pulse {
  0%,
  100% {
    text-shadow: 0 0 20px rgba(59, 130, 246, 0.45);
  }
  50% {
    text-shadow: 0 0 28px rgba(96, 165, 250, 0.75), 0 0 48px rgba(59, 130, 246, 0.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-loader.login-page .session-loader__title :deep(.hero-word--accent) {
    animation: heroInAccent 0.01s linear forwards;
  }
}
</style>
