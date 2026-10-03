<script setup lang="ts">
import { ElMessage } from "element-plus";
import FootballObSessionBar from "@/components/match/FootballObSessionBar.vue";
import PodBetSettingsTab from "@/components/football/PodBetSettingsTab.vue";
import { closeFootballSettings, footballSettingsOpen, footballSettingsTab, type FootballSettingsTab } from "@/runtime/footballSettingsUi";
import { fetchPandaSportTrialRow } from "@/runtime/obSportTrial";
import { useFootballStore } from "@/stores/footballStore";
import { computed, ref } from "vue";

const football = useFootballStore();
const openingTrial = ref(false);

const visible = computed({
  get: () => footballSettingsOpen.value,
  set: (v: boolean) => {
    footballSettingsOpen.value = v;
  },
});

const settingsTab = computed({
  get: () => footballSettingsTab.value,
  set: (v: string) => {
    if (v === "session" || v === "pod" || v === "trial")
      footballSettingsTab.value = v as FootballSettingsTab;
  },
});

function onSaved() {
  void football.fetchMatchs(true);
}

function onClosed() {
  closeFootballSettings();
}

async function openObSportTrial() {
  openingTrial.value = true;
  try {
    const row = await fetchPandaSportTrialRow();
    const tab = window.open(row.href, "OB_SPORT");
    if (!tab)
      ElMessage.warning("浏览器拦截了弹窗，请允许本站弹出窗口后再点「OB体育试玩」");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
  }
  finally {
    openingTrial.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="足球设置"
    width="min(1100px, calc(100vw - 32px))"
    append-to-body
    destroy-on-close
    @closed="onClosed"
  >
    <el-tabs v-model="settingsTab">
      <el-tab-pane label="采集" name="session">
        <p class="fb-settings__hint">
          熊猫体育采集只存在本机，和电竞「参数配置」不是同一套。
        </p>
        <FootballObSessionBar layout="panel" @saved="onSaved" />
      </el-tab-pane>
      <el-tab-pane label="POD跟单" name="pod">
        <PodBetSettingsTab />
      </el-tab-pane>
      <el-tab-pane label="试玩" name="trial">
        <p class="fb-settings__hint">
          官网熊猫体育试玩，不是电竞 OB 试玩。点链接会拉 tryPlay 并打开进馆页。
        </p>
        <el-link
          type="primary"
          :underline="true"
          :disabled="openingTrial"
          @click="openObSportTrial"
        >
          OB体育试玩
        </el-link>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.fb-settings__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}
</style>
