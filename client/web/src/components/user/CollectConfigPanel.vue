<script setup lang="ts">
import type { PlatformId } from "@/types/esport";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { CREDIT_PLATE_ENTRIES, enterCreditPlate } from "@/api/v4";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { syncCollectorsFromConfig } from "@/runtime/collectors";
import { useCollectStore } from "@/stores/collectStore";
import { browserSaveMatchPlatformIds } from "@changmen/venue-browser/adapter/registry";

const collect = useCollectStore();
const { log } = storeToRefs(collect);

/** 对齐 A8 `UserCollectView`：各平台开关 = 是否回传 SaveMatch/SaveBets，非停采。默认锁定，双击「盘」解锁 */
const switchesDisabled = ref(true);

/** VPS 写库场馆（PM/PF）无浏览器 Save*，不在此展示开关 */
const platformRows = computed(() =>
  browserSaveMatchPlatformIds().map(id => [id, collect.isEnabled(id)] as [PlatformId, boolean]),
);

function toggleSwitchesLock() {
  switchesDisabled.value = !switchesDisabled.value;
}

async function toggleLog() {
  if (switchesDisabled.value)
    return;
  await collect.saveConfig({ log: !log.value });
}

async function togglePlatform(platform: PlatformId, on: boolean) {
  if (switchesDisabled.value)
    return;
  const next = new Map(collect.collect);
  next.set(platform, on);
  await collect.saveConfig({ collect: next });
  syncCollectorsFromConfig();
}

async function openCredit(platform: PlatformId) {
  await enterCreditPlate(platform);
}
</script>

<template>
  <el-row class="providers collect-providers" :gutter="8">
    <el-col :span="4">
      <el-switch
        :disabled="switchesDisabled"
        size="large"
        inline-prompt
        active-text="采集日志"
        inactive-text="采集日志"
        :model-value="log"
        @change="toggleLog"
      />
    </el-col>
    <el-col v-for="[id, on] in platformRows" :key="id" :span="4" class="provider">
      <div class="collect-provider">
        <span class="collect-provider__badge" :title="id">
          <PlatformIcon :platform="id" />
        </span>
        <el-switch
          :disabled="switchesDisabled"
          size="large"
          :model-value="on"
          @change="(v: boolean) => togglePlatform(id, v)"
        />
      </div>
    </el-col>
  </el-row>

  <el-divider>
    信用<span @dblclick="toggleSwitchesLock">盘</span>入口
  </el-divider>

  <div class="credit flex flex-wrap">
    <div v-for="entry in CREDIT_PLATE_ENTRIES" :key="entry.id" class="credit-game">
      <el-button type="primary" @click="openCredit(entry.id)">
        <div class="flex flex-middle">
          <PlatformIcon :platform="entry.id" />
          <div class="name">
            {{ entry.label }}
          </div>
        </div>
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.collect-provider {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
}

.collect-provider__badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.collect-provider__badge :deep(.provider-icon),
.collect-provider__badge :deep(.cm-platform-icon) {
  width: 22px;
  height: 22px;
}
</style>
