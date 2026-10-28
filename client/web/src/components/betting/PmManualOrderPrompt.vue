<script setup lang="ts">
import { ref, useId } from "vue";

const props = defineProps<{ context: string; initialOdds?: string }>();
const emit = defineEmits<{ "update:odds": [value: string] }>();
const mode = defineModel<"FOK" | "GTC">({ default: "FOK" });
const odds = ref(props.initialOdds ?? "");
const name = useId();
function updateOdds(event: Event) {
  odds.value = (event.target as HTMLInputElement).value;
  emit("update:odds", odds.value);
}
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
    <label v-if="mode === 'GTC'" class="limit-odds">
      挂单赔率
      <input :value="odds" type="number" min="1" step="any" inputmode="decimal" @input="updateOdds">
    </label>
    <p v-if="mode === 'GTC'" class="hint">
      输入大于 1 的十进制赔率。按此赔率换算限价，并按盘口价格步长向下取整；实际成交赔率可能更高。
    </p>
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
.limit-odds { display: flex; margin-top: 12px; gap: 12px; }
.limit-odds input { width: 130px; padding: 5px 8px; border: 1px solid var(--el-border-color); border-radius: 4px; color: var(--el-text-color-primary); background: var(--el-bg-color); }
.hint { color: var(--el-text-color-secondary); font-size: 12px; white-space: normal; margin: 8px 0 0; }
</style>
