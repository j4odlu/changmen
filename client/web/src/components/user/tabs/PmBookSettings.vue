<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { getPmFokPreflightMode, onPmFokPreflightModeChange } from "@changmen/venue-browser/adapter/polymarket/pmFokPreflightMode";
import { onPmBookSettingChange, readPmBookSettings, setPmBookSetting, type PmBookSetting } from "@/runtime/pmBookSettings";

const settings = ref(readPmBookSettings());
const mode = ref(getPmFokPreflightMode());
const sync = () => { settings.value = readPmBookSettings(); };
const storage = (event: StorageEvent) => { if (event.storageArea === localStorage) sync(); };
let stopSettings: (() => void) | undefined;
let stopMode: (() => void) | undefined;
onMounted(() => {
  sync(); mode.value = getPmFokPreflightMode();
  stopSettings = onPmBookSettingChange(sync);
  stopMode = onPmFokPreflightModeChange(value => { mode.value = value; });
  window.addEventListener("storage", storage);
});
onUnmounted(() => { stopSettings?.(); stopMode?.(); window.removeEventListener("storage", storage); });
function change(setting: PmBookSetting, value: unknown) {
  if (value === true && mode.value !== "optimized") return;
  try { setPmBookSetting(setting, value === true); }
  catch { ElMessage.error("未能保存旁路设置，请检查浏览器存储权限及本地订单簿开关"); }
  finally { sync(); }
}
</script>

<template>
  <div class="pm-book-settings">
    <h4 class="pm-book-settings__heading">动态复核预检设置</h4>
    <p class="pm-book-settings__note">
      默认关闭，仅当前浏览器、当前站点生效，切换后立即保存，无需点击下方保存按钮；换账号会保留此浏览器设置。
      仅直连官方 PM-M 且已保存动态复核预检时启用，经典预检和中转连接不运行旁路。
      复用现有行情连接，实际预检仍走 HTTP，不启用下单快路径。
    </p>
    <el-form label-position="left" label-width="190px">
      <el-form-item label="本地订单簿">
        <el-switch :model-value="settings.localBook" aria-label="本地订单簿"
          :disabled="mode !== 'optimized' && !settings.localBook"
          inline-prompt active-text="开" inactive-text="关" @change="change('localBook', $event)" />
      </el-form-item>
      <el-form-item label="动态预检对照">
        <el-switch :model-value="settings.shadow" aria-label="动态预检对照"
          :disabled="(!settings.localBook || mode !== 'optimized') && !settings.shadow"
          inline-prompt active-text="开" inactive-text="关" @change="change('shadow', $event)" />
      </el-form-item>
    </el-form>
    <p class="pm-book-settings__note">
      {{ mode !== 'optimized' ? '当前未应用动态复核预检，旁路不运行；请先选择动态复核预检并保存。' : '开关表示已保存的偏好；是否运行还取决于登录、直连及账号条件。' }}
      关闭本地订单簿会停止全部旁路；仅关闭对照会保留订单簿。对照偏好会保留，在本地订单簿重新开启且符合条件后恢复。
      开启会增加本机资源占用，仅用于观察验证，不代表提高成交率。
    </p>
  </div>
</template>

<style scoped>
.pm-book-settings { border-top: 1px solid var(--el-border-color-lighter); margin-top: 12px; padding-top: 4px; font-size: 13px; }
.pm-book-settings__heading { margin: 12px 0 8px; font-size: 13px; font-weight: 600; }
.pm-book-settings__note { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
</style>
