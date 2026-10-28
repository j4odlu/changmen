<script setup lang="ts">
import type { BrowserPmOddsDropSettings } from "./downSettings";
import type { PmUpPrefs } from "./upSettings";
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useUserStore } from "@/stores/userStore";
import { useSignalSettings } from "./useSignalSettings";

const { extensionPrefs } = storeToRefs(useUserStore());
const { downSettings, upSettings, updateDownSettings, updateUpSettings } = useSignalSettings();
function downField<K extends keyof BrowserPmOddsDropSettings>(key: K) {
  return computed({
    get: () => downSettings.value[key],
    set: (value: BrowserPmOddsDropSettings[K]) => updateDownSettings({ [key]: value }),
  });
}
function upField<K extends keyof PmUpPrefs>(key: K) {
  return computed({
    get: () => upSettings.value[key],
    set: (value: PmUpPrefs[K]) => updateUpSettings({ [key]: value }),
  });
}
function inputNumber(event: Event): number | undefined {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  return Number.isFinite(value) ? value : undefined;
}
function syncNumberInput(event: FocusEvent, value: number): void {
  (event.target as HTMLInputElement).value = String(value);
}
function setDownNumber(key: "thresholdPct" | "windowMs" | "cooldownMs" | "minReferenceOdds" | "maxReferenceOdds", value: number | undefined, scale = 1): number {
  updateDownSettings({ [key]: value == null ? undefined : value * scale });
  return downSettings.value[key] / scale;
}
function setUpNumber(key: "minRisePct" | "minArbPct" | "windowMs" | "cooldownMs", value: number | undefined, scale = 1): number {
  updateUpSettings({ [key]: value == null ? undefined : value * scale });
  return upSettings.value[key] / scale;
}
const downEnabled = downField("enabled");
const referenceVenue = downField("referenceVenue");
const upEnabled = upField("enabled");
</script>

<template>
  <section class="signal-settings" aria-label="赔率异动信号配置">
    <h3>赔率异动 · 涨赔与降赔</h3>
    <p class="signal-settings__intro">监测与盘口显示分别设置。此处仅观察行情，不自动下注。修改立即生效，点击页面底部「保存」后，下次登录继续使用。</p>
    <div class="signal-settings__monitors">
      <section class="signal-settings__card" aria-label="降赔监测设置">
        <div class="signal-settings__heading"><h4><span class="signal-settings__arrow" aria-hidden="true">↓</span> 降赔 · 同方向比价</h4><span :class="{ 'is-active': downEnabled }">{{ downEnabled ? '监测中' : '已暂停' }}</span></div>
        <el-form-item label="降赔监测:">
          <el-switch v-model="downEnabled" aria-label="降赔监测" inline-prompt active-text="开启" inactive-text="关闭" />
        </el-form-item>
        <el-form-item label="监测场馆:">
          <el-select v-model="referenceVenue" aria-label="降赔监测场馆" class="signal-settings__select">
            <el-option label="PM" value="Polymarket" /><el-option label="OB" value="OB" /><el-option label="RAY" value="RAY" /><el-option label="PB" value="PB" />
          </el-select>
        </el-form-item>
        <el-form-item label="最小降幅:"><input type="number" class="signal-settings__number" :value="downSettings.thresholdPct" @blur="syncNumberInput($event, setDownNumber('thresholdPct', inputNumber($event)))" @change="setDownNumber('thresholdPct', inputNumber($event))" min="0.1" max="90" step="0.5" aria-label="最小降幅" /><span class="signal-settings__unit">%</span></el-form-item>
        <el-form-item label="观察窗口:"><input type="number" class="signal-settings__number" :value="downSettings.windowMs / 1000" @blur="syncNumberInput($event, setDownNumber('windowMs', inputNumber($event), 1000))" @change="setDownNumber('windowMs', inputNumber($event), 1000)" min="0.5" max="60" step="0.5" aria-label="降赔观察窗口秒" /><span class="signal-settings__unit">秒</span></el-form-item>
        <el-form-item label="信号冷却:"><input type="number" class="signal-settings__number" :value="downSettings.cooldownMs / 1000" @blur="syncNumberInput($event, setDownNumber('cooldownMs', inputNumber($event), 1000))" @change="setDownNumber('cooldownMs', inputNumber($event), 1000)" min="0" max="300" step="1" aria-label="降赔信号冷却秒" /><span class="signal-settings__unit">秒</span></el-form-item>
        <el-form-item label="监测赔率下限:"><input type="number" class="signal-settings__number" :value="downSettings.minReferenceOdds" @blur="syncNumberInput($event, setDownNumber('minReferenceOdds', inputNumber($event)))" @change="setDownNumber('minReferenceOdds', inputNumber($event))" min="1.01" max="1000" step="0.1" aria-label="降赔监测赔率下限" /></el-form-item>
        <el-form-item label="监测赔率上限:"><input type="number" class="signal-settings__number" :value="downSettings.maxReferenceOdds" @blur="syncNumberInput($event, setDownNumber('maxReferenceOdds', inputNumber($event)))" @change="setDownNumber('maxReferenceOdds', inputNumber($event))" :min="downSettings.minReferenceOdds" max="1000" step="0.1" aria-label="降赔监测赔率上限" /></el-form-item>
        <p class="signal-settings__hint">监测所选场馆的降赔，记录其他场馆同方向报价与价差。冷却按同一选项计算。</p>
      </section>
      <section class="signal-settings__card" aria-label="涨赔监测设置">
        <div class="signal-settings__heading"><h4><span class="signal-settings__arrow" aria-hidden="true">↑</span> PM 涨赔 · 对侧比价</h4><span :class="{ 'is-active': upEnabled }">{{ upEnabled ? '监测中' : '已暂停' }}</span></div>
        <el-form-item label="涨赔监测:"><el-switch v-model="upEnabled" aria-label="涨赔监测" inline-prompt active-text="开启" inactive-text="关闭" /></el-form-item>
        <el-form-item label="监测场馆:"><span class="signal-settings__fixed">PM</span></el-form-item>
        <el-form-item label="PM 最小涨幅:"><input type="number" class="signal-settings__number" :value="upSettings.minRisePct" @blur="syncNumberInput($event, setUpNumber('minRisePct', inputNumber($event)))" @change="setUpNumber('minRisePct', inputNumber($event))" min="0" max="1000" step="0.5" aria-label="PM 最小涨幅" /><span class="signal-settings__unit">%</span></el-form-item>
        <el-form-item label="观察窗口:"><input type="number" class="signal-settings__number" :value="upSettings.windowMs / 1000" @blur="syncNumberInput($event, setUpNumber('windowMs', inputNumber($event), 1000))" @change="setUpNumber('windowMs', inputNumber($event), 1000)" min="0.5" max="60" step="0.5" aria-label="涨赔观察窗口秒" /><span class="signal-settings__unit">秒</span></el-form-item>
        <el-form-item label="信号冷却:"><input type="number" class="signal-settings__number" :value="upSettings.cooldownMs / 1000" @blur="syncNumberInput($event, setUpNumber('cooldownMs', inputNumber($event), 1000))" @change="setUpNumber('cooldownMs', inputNumber($event), 1000)" min="0" max="300" step="1" aria-label="涨赔信号冷却秒" /><span class="signal-settings__unit">秒</span></el-form-item>
        <el-form-item label="理论套利下限:"><input type="number" class="signal-settings__number" :value="upSettings.minArbPct" @blur="syncNumberInput($event, setUpNumber('minArbPct', inputNumber($event)))" @change="setUpNumber('minArbPct', inputNumber($event))" min="0" max="100" step="0.5" aria-label="涨赔提示最小理论套利空间" /><span class="signal-settings__unit">%</span></el-form-item>
        <p class="signal-settings__hint">仅提示 PM 涨赔且与其他场馆对侧存在达标理论套利空间的情况。最小涨幅 0 表示任意实际上涨，以窗口内最低赔率为基线；冷却按同一方向、目标场馆选项计算。</p>
      </section>
    </div>
    <div class="signal-settings__display" aria-label="赔率异动显示设置">
      <h4>盘口角标显示</h4>
      <div class="signal-settings__display-switches">
        <el-form-item label="显示降赔角标:"><el-switch v-model="extensionPrefs.pmOddsDropCardUi" aria-label="显示降赔角标" inline-prompt active-text="开启" inactive-text="关闭" /></el-form-item>
        <el-form-item label="显示涨赔角标:"><el-switch v-model="extensionPrefs.pmUpCardUi" aria-label="显示涨赔角标" inline-prompt active-text="开启" inactive-text="关闭" /></el-form-item>
      </div>
      <p class="signal-settings__hint">需开启 BetRow 扩展 UI。隐藏角标不停止监测；浮窗继续展示记录。PM 旁显示涨跌幅，相关场馆显示同向价差或对侧理论套利，角标保留 30 秒。</p>
    </div>
    <p class="signal-settings__notice">涨赔提示表示变价时存在套利空间，尚未判定机会由哪一方涨价形成。以上阈值与冷却仅用于异动信号，不作为自动下注条件。</p>
  </section>
</template>

<style scoped>
.signal-settings { margin: 12px 0 20px; padding: 16px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.signal-settings h3 { margin: 0 0 8px; font-size: 14px; color: var(--el-text-color-primary); }
.signal-settings h4 { margin: 0; font-size: 13px; color: var(--el-text-color-primary); }
.signal-settings__intro, .signal-settings__hint, .signal-settings__notice { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
.signal-settings__intro { margin: 0 0 16px; }
.signal-settings__monitors { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 14px; }
.signal-settings__card { min-width: 0; padding: 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-light); }
.signal-settings__heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 18px; }
.signal-settings__heading h4 { display: flex; align-items: center; gap: 5px; }
.signal-settings__arrow { font-size: 20px; font-weight: 900; line-height: 1; }
.signal-settings__heading > span { flex: none; font-size: 11px; color: var(--el-text-color-secondary); }
.signal-settings__heading > span.is-active { color: var(--el-color-success); }
.signal-settings :deep(.el-form-item) { margin-bottom: 12px; }
.signal-settings__number, .signal-settings__select { width: 130px; max-width: 100%; }
.signal-settings__number { box-sizing: border-box; min-height: 32px; padding: 5px 10px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); font: inherit; }
.signal-settings__number:focus { outline: 1px solid var(--el-color-primary); border-color: var(--el-color-primary); }
.signal-settings :deep(.el-form-item__content) { min-width: 0; }
.signal-settings__unit { margin-left: 7px; }
.signal-settings__fixed { color: var(--el-text-color-regular); }
.signal-settings__hint { margin: 8px 0 0; }
.signal-settings__display { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter); }
.signal-settings__display-switches { display: flex; flex-wrap: wrap; gap: 8px 36px; margin-top: 14px; }
.signal-settings__notice { margin: 14px 0 0; padding: 10px 12px; border-radius: 5px; background: var(--el-fill-color-light); }
@media (max-width: 600px) {
  .signal-settings { padding: 12px; }
  .signal-settings__card { padding: 12px; }
  .signal-settings :deep(.el-form-item) { display: flex; flex-direction: column; align-items: stretch; }
  .signal-settings :deep(.el-form-item__label) { float: none; width: 100% !important; justify-content: flex-start; margin-bottom: 4px; }
  .signal-settings :deep(.el-form-item__content) { margin-left: 0 !important; }
}
</style>
