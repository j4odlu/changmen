<script setup lang="ts">
import { computed } from "vue";
import {
  listObSportFollowAccounts,
  readObSportDisplayBalance,
  type ObSportBetAccountLike,
} from "@/runtime/obSportBetAccount";
import { accountOrderDisplayName } from "@/shared/accountDisplayName";

const props = withDefaults(defineProps<{
  modelValue: number[];
  accounts: Array<ObSportBetAccountLike & {
    provider?: string;
    balance?: number;
    getBalance?: () => number | undefined;
  }>;
  /** panel = 深色浮窗；settings = 浅色设置页 */
  variant?: "panel" | "settings";
  venue?: "OB" | "Polymarket" | "RAY";
  disabled?: boolean;
  rotation?: boolean;
}>(), {
  variant: "panel",
  venue: "OB",
  disabled: false,
  rotation: false,
});

const emit = defineEmits<{
  "update:modelValue": [number[]];
}>();

type Chip = {
  id: number;
  name: string;
  balance?: number;
};

const chips = computed<Chip[]>(() =>
  (props.venue !== "OB"
    ? props.accounts.filter(row => String(row.provider || "") === props.venue)
    : listObSportFollowAccounts(props.accounts)
  ).map(row => {
    const id = Math.round(Number(row.accountId) || 0);
    const name = accountOrderDisplayName(row) || String(id);
    const balance = props.venue !== "OB"
      ? (typeof row.getBalance === "function" ? row.getBalance() : row.balance)
      : readObSportDisplayBalance(row as ObSportBetAccountLike & { sportBalance?: number });
    return {
      id,
      name,
      balance,
    };
  }).filter(row => row.id > 0),
);

const selected = computed(() => new Set(
  (Array.isArray(props.modelValue) ? props.modelValue : [])
    .map(n => Math.round(Number(n) || 0))
    .filter(n => n > 0),
));

const selectedCount = computed(() => selected.value.size);

function isOn(id: number) {
  return selected.value.has(id);
}

function toggle(id: number) {
  if (props.disabled || id <= 0)
    return;
  const next = new Set(selected.value);
  if (next.has(id))
    next.delete(id);
  else
    next.add(id);
  // 保持与 chips 同一顺序，方便多号依次下单
  emit("update:modelValue", chips.value.map(c => c.id).filter(n => next.has(n)));
}

function clearAll() {
  if (props.disabled)
    return;
  emit("update:modelValue", []);
}

function selectAll() {
  if (props.disabled)
    return;
  emit("update:modelValue", chips.value.map(c => c.id));
}

function formatBal(n: number | undefined): string {
  if (n == null || !Number.isFinite(n))
    return "";
  if (n >= 1000)
    return Math.round(n).toLocaleString("zh-CN");
  return String(Math.round(n * 100) / 100);
}
</script>

<template>
  <div
    class="pod-acct-picker"
    :class="[`is-${variant}`, { 'is-disabled': disabled, 'is-empty': !chips.length }]"
  >
    <template v-if="!chips.length">
      <span class="pod-acct-picker__empty">没有可用的 {{ venue === "Polymarket" ? "PM" : venue === "RAY" ? "RAY" : "OB 体育" }}账号</span>
    </template>
    <template v-else>
      <div class="pod-acct-picker__chips">
        <button
          v-for="chip in chips"
          :key="chip.id"
          type="button"
          class="pod-acct-picker__chip"
          :class="{ 'is-on': isOn(chip.id) }"
          :disabled="disabled"
          :title="chip.balance != null ? `${chip.name} · 余额 ${formatBal(chip.balance)}` : chip.name"
          @click="toggle(chip.id)"
        >
          <span class="pod-acct-picker__mark" aria-hidden="true">{{ isOn(chip.id) ? "✓" : "" }}</span>
          <span class="pod-acct-picker__name">{{ chip.name }}</span>
          <span v-if="chip.balance != null" class="pod-acct-picker__bal">{{ formatBal(chip.balance) }}</span>
        </button>
      </div>
      <div class="pod-acct-picker__meta">
        <span v-if="selectedCount === 0" class="pod-acct-picker__hint">
          必须选择账号
        </span>
        <span v-else class="pod-acct-picker__hint">
          已选 {{ selectedCount }} 个，{{ rotation ? "每笔轮换 1 个" : "各下一注" }}
        </span>
        <button
          v-if="selectedCount > 0 && selectedCount < chips.length"
          type="button"
          class="pod-acct-picker__link"
          :disabled="disabled"
          @click="selectAll"
        >
          全选
        </button>
        <button
          v-else-if="selectedCount === 0"
          type="button"
          class="pod-acct-picker__link"
          :disabled="disabled"
          @click="selectAll"
        >
          全选
        </button>
        <button
          v-if="selectedCount > 0"
          type="button"
          class="pod-acct-picker__link"
          :disabled="disabled"
          @click="clearAll"
        >
          清空
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pod-acct-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pod-acct-picker.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

.pod-acct-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.pod-acct-picker__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 9px 3px 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
}

.pod-acct-picker__mark {
  width: 12px;
  flex: 0 0 12px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
}

.pod-acct-picker__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.pod-acct-picker__bal {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.pod-acct-picker__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 16px;
}

.pod-acct-picker__hint,
.pod-acct-picker__empty {
  font-size: 11px;
}

.pod-acct-picker__link {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.pod-acct-picker__link:hover {
  text-decoration: underline;
}

/* —— 浮窗深色 —— */
.pod-acct-picker.is-panel .pod-acct-picker__chip {
  border-color: #ffffff2e;
  color: #94a3b8;
}

.pod-acct-picker.is-panel .pod-acct-picker__chip:hover {
  color: #fde68a;
  border-color: #f59e0b99;
}

.pod-acct-picker.is-panel .pod-acct-picker__chip.is-on {
  color: #0f172a;
  border-color: #f59e0b;
  background: #fbbf24;
}

.pod-acct-picker.is-panel .pod-acct-picker__chip.is-on .pod-acct-picker__bal {
  opacity: 0.7;
  color: #422006;
}

.pod-acct-picker.is-panel .pod-acct-picker__hint,
.pod-acct-picker.is-panel .pod-acct-picker__empty {
  color: #64748b;
}

.pod-acct-picker.is-panel .pod-acct-picker__link {
  color: #fbbf24;
}

/* —— 设置页浅色 —— */
.pod-acct-picker.is-settings {
  width: 100%;
  max-width: 420px;
}

.pod-acct-picker.is-settings .pod-acct-picker__chip {
  border-color: #cbd5e1;
  background: #fff;
  color: #334155;
  font-size: 12px;
  padding: 4px 10px 4px 8px;
}

.pod-acct-picker.is-settings .pod-acct-picker__chip:hover {
  color: #92400e;
  border-color: #f59e0b;
  background: #fffbeb;
}

.pod-acct-picker.is-settings .pod-acct-picker__chip.is-on {
  color: #92400e;
  border-color: #f59e0b;
  background: #fef3c7;
}

.pod-acct-picker.is-settings .pod-acct-picker__hint,
.pod-acct-picker.is-settings .pod-acct-picker__empty {
  color: #64748b;
}

.pod-acct-picker.is-settings .pod-acct-picker__link {
  color: #b45309;
}
</style>
