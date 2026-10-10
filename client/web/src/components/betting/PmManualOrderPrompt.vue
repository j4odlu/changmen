<script setup lang="ts">
import { useId } from "vue";

defineProps<{ context: string }>();
const mode = defineModel<"FOK" | "GTC">({ default: "FOK" });
const name = useId();
</script>

<template>
  <div class="pm-manual-order-prompt">
    <p class="context">
      {{ context }}
    </p>
    <fieldset>
      <legend>下单方式</legend>
      <label><input :name="name" type="radio" value="FOK" :checked="mode === 'FOK'" @change="mode = 'FOK'"> FOK</label>
      <label><input :name="name" type="radio" value="GTC" :checked="mode === 'GTC'" @change="mode = 'GTC'"> GTC</label>
    </fieldset>
    <p class="hint">
      {{ mode === 'GTC' ? 'GTC：未成交份额继续挂单，可在订单栏取消剩余挂单；已成交部分保留。' : 'FOK：全部成交，否则取消。本次默认使用 FOK。' }}
    </p>
  </div>
</template>

<style scoped>
.context { white-space: pre-line; margin: 0 0 12px; }
fieldset { border: 0; padding: 0; margin: 0; display: flex; gap: 20px; }
legend { margin-bottom: 6px; font-weight: 600; }
label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
input { accent-color: var(--el-color-primary); }
.hint { color: var(--el-text-color-secondary); font-size: 12px; white-space: normal; margin: 8px 0 0; }
</style>
