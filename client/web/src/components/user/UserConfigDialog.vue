<script setup lang="ts">
import type { UserConfigFormState } from "@/components/user/userConfigFormState";
import { ElMessage, ElMessageBox } from "element-plus";
import { storeToRefs } from "pinia";
/**
 * 用户配置弹窗，组件使用 Element Plus。
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  createUserConfigFormState,

} from "@/components/user/userConfigFormState";
import UserConfigPanel from "@/components/user/UserConfigPanel.vue";
import { normalizeWaitTime } from "@/shared/betTiming";
import { useUserStore } from "@/stores/userStore";
import {
  createDefaultMakeupOddsBandPrefs,
  normalizeMakeupOddsBand,
} from "@/types/extensionPrefs";

const props = defineProps<{
  open: boolean;
  readonly?: boolean;
  previewForm?: UserConfigFormState;
  zIndex?: number;
}>();
const emit = defineEmits<{ close: [] }>();

const userStore = useUserStore();
const { configSaving: saving } = storeToRefs(userStore);

let form = reactive(createUserConfigFormState(userStore.config));
const makeupOddsBand = reactive(createDefaultMakeupOddsBandPrefs());
const autoOpenDate = ref<Date | null>(null);
/** extras 已写入草稿后才允许保存，避免默认上下沿盖掉 RDS */
const extrasSynced = ref(false);

const visible = computed({
  get: () => props.open,
  set: (v: boolean) => {
    if (!v)
      emit("close");
  },
});

function syncMakeupOddsBandFromStore() {
  Object.assign(makeupOddsBand, structuredClone(
    normalizeMakeupOddsBand(userStore.extensionPrefs.makeupOddsBand),
  ));
}

function syncFormFromStore() {
  Object.assign(form, createUserConfigFormState(userStore.config));
  autoOpenDate.value = form.bettingAutoOpenTime ? new Date(form.bettingAutoOpenTime) : null;
  syncMakeupOddsBandFromStore();
}

watch(autoOpenDate, (v) => {
  form.bettingAutoOpenTime = v ? v.getTime() : 0;
});

async function syncForm() {
  if (props.previewForm) {
    Object.assign(form, structuredClone(props.previewForm));
    autoOpenDate.value = form.bettingAutoOpenTime ? new Date(form.bettingAutoOpenTime) : null;
    extrasSynced.value = true;
    return;
  }
  extrasSynced.value = false;
  await userStore.loadExtras();
  if (!userStore.extrasLoaded)
    await userStore.loadExtras();
  if (!userStore.extrasLoaded)
    return;
  syncFormFromStore();
  extrasSynced.value = true;
}

watch(
  () => props.open,
  (v) => {
    if (v)
      void syncForm();
  },
);

watch(
  () => props.previewForm,
  () => {
    if (props.open && props.previewForm)
      void syncForm();
  },
  { deep: true },
);

onMounted(async () => {
  if (props.previewForm) {
    await syncForm();
    return;
  }
  if (!userStore.configLoaded)
    await userStore.loadConfig();
  await syncForm();
});

async function save() {
  if (props.readonly || !extrasSynced.value)
    return;
  // [changmen 扩展] 恢复门仅属于已激活的自动 GTC；历史/手动 GTC 不改变 FOK 保存。
  if (form.betting && userStore.extensionPrefs.pmArbOrderMode === "GTC"
    && userStore.extensionPrefs.pmGtcV1Activation === `1:${userStore.userId}`) {
    try {
      const runtime = await import("@/orderModes/gtc/runtime");
      await runtime.refreshGtcRecords();
      if (runtime.gtcProgress.records.some(row => !row.released && row.manual)) {
        await ElMessageBox.confirm("请先在官方平台核对原挂单已终止、实际成交和另一腿已确定，并自行处理本组敞口。确认后只恢复新组自动下注，不会继续原组或自动补单。", "核对 GTC 后恢复自动下注", { type: "warning", confirmButtonText: "已核对，恢复新组" });
        await runtime.resumeGtcAfterManualReview();
      }
    }
    catch (error) {
      if (error instanceof Error)
        ElMessage.error(error.message); return;
    }
  }
  Object.assign(userStore.config, {
    ...form,
    profit: Number(form.profit),
    maxProfit: Number(form.maxProfit) || 1.1,
    makeProfit: Number(form.makeProfit) || 1.01,
    betMoney: Number(form.betMoney) || 100,
    valueBetMoney: Number(form.valueBetMoney) >= 0 ? Math.round(Number(form.valueBetMoney)) : 100,
    valueBetConfirm: form.valueBetConfirm !== false,
    minMoney: Number(form.minMoney) || 0,
    maxMoney: Number(form.maxMoney) || 0,
    minOdds: Number(form.minOdds) || 0,
    maxOdds: Number(userStore.config.maxOdds) || 10,
    checkTimeout: Number(form.checkTimeout) || 3000,
    betCount: Number(form.betCount) || 0,
    betInterval: Number(form.betInterval) || 30,
    anyOddsProfit: Number(form.anyOddsProfit) || 0.95,
    providerSortValue: [...form.providerSortValue],
    providerFixed: [...form.providerFixed],
    allowSameBet: [...form.allowSameBet],
    waitTime: normalizeWaitTime(form.waitTime),
  });
  try {
    await userStore.loadExtras();
    const nextBand = normalizeMakeupOddsBand({ ...makeupOddsBand });
    const prevBand = normalizeMakeupOddsBand(userStore.extensionPrefs.makeupOddsBand);
    const bandChanged = JSON.stringify(nextBand) !== JSON.stringify(prevBand);
    const result = await userStore.saveConfig();
    if (!result.ok) {
      ElMessage.error(result.msg || "保存失败");
      return;
    }
    if (bandChanged) {
      userStore.extensionPrefs.makeupOddsBand = nextBand;
      await userStore.saveExtensionPrefs();
    }
    ElMessage.success("保存成功");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
  finally {
    emit("close");
    await userStore.fetchUserInfo();
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="参数配置"
    width="1000"
    append-to-body
    :z-index="zIndex"
    :close-on-press-escape="false"
    :close-on-click-modal="false"
  >
    <UserConfigPanel
      v-model:auto-open-date="autoOpenDate"
      v-model:form="form"
      :makeup-odds-band="previewForm ? undefined : makeupOddsBand"
      :readonly="readonly"
    >
      <template v-if="!readonly" #footer>
        <div class="flex flex-center" style="padding-top: 8px">
          <el-button
            size="default"
            type="primary"
            class="am-icon-save"
            :loading="saving || !extrasSynced"
            :disabled="!extrasSynced"
            round
            style="width: 240px"
            @click="save"
          >
            &nbsp;保存配置
          </el-button>
        </div>
      </template>
    </UserConfigPanel>
  </el-dialog>
</template>
