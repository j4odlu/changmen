<script setup lang="ts">
import { ElMessage } from "element-plus";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import PmPfBufferSettings from "@/components/user/PmPfBufferSettings.vue";
import { createDefaultPmUpPrefs } from "@/extensions/pm_up/settings";
import {
  createDefaultValueBetAutoBetPrefs,
  createDefaultValueBetMarkerPrefs,
  type UiTheme,
} from "@/types/extensionPrefs";
import { VALUE_BET_SHARP_OPTIONS } from "@/extensions/valueBet/evConfig";
import { useUserStore } from "@/stores/userStore";

const user = useUserStore();
const { extensionPrefs } = storeToRefs(user);
if (!extensionPrefs.value.pmUp)
  extensionPrefs.value.pmUp = createDefaultPmUpPrefs();
if (!extensionPrefs.value.valueBet)
  extensionPrefs.value.valueBet = createDefaultValueBetMarkerPrefs();
else if (!extensionPrefs.value.valueBet.autoBet)
  extensionPrefs.value.valueBet.autoBet = createDefaultValueBetAutoBetPrefs();
if (extensionPrefs.value.valueBet.autoBet.maxEdgePct == null)
  extensionPrefs.value.valueBet.autoBet.maxEdgePct = createDefaultValueBetAutoBetPrefs().maxEdgePct;
const saving = ref(false);

watch(
  () => extensionPrefs.value.valueBet?.autoBet?.minOdds,
  (min) => {
    const autoBet = extensionPrefs.value.valueBet?.autoBet;
    if (!autoBet || min == null || !Number.isFinite(min))
      return;
    if (typeof autoBet.maxOdds === "number" && autoBet.maxOdds < min)
      autoBet.maxOdds = min;
  },
);
watch(
  () => extensionPrefs.value.valueBet?.autoBet?.minEdgePct,
  (min) => {
    const autoBet = extensionPrefs.value.valueBet?.autoBet;
    if (!autoBet || min == null || !Number.isFinite(min))
      return;
    if (typeof autoBet.maxEdgePct === "number" && autoBet.maxEdgePct < min)
      autoBet.maxEdgePct = min;
  },
);

const uiThemeOptions: { value: UiTheme; label: string }[] = [
  { value: "default", label: "默认深色" },
  { value: "brutal", label: "Brutal（粗边框）" },
  { value: "paper", label: "浅纸感" },
  { value: "terminal", label: "终端风" },
];

async function save() {
  saving.value = true;
  try {
    await user.saveExtensionPrefs();
    ElMessage.success("保存成功");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
  finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="ui-tab">
    <el-form label-position="left" label-width="150px" class="ui-tab__panel">
      <div class="ui-tab__row">
        <el-form-item label="界面皮肤:" class="ui-tab__control ui-tab__control--theme">
          <el-radio-group v-model="extensionPrefs.uiTheme" size="large" class="theme-radios">
            <el-radio
              v-for="opt in uiThemeOptions"
              :key="opt.value"
              :value="opt.value"
              border
            >
              {{ opt.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </div>

      <div class="ui-tab__row">
        <el-form-item label="BetRow 扩展 UI:" class="ui-tab__control">
          <el-switch
            v-model="extensionPrefs.betRowUi"
            inline-prompt
            active-text="开启"
            inactive-text="关闭"
            size="large"
          />
        </el-form-item>
        <p class="ui-tab__desc">
          套利连线、利润角标、赔率 flash、EV 金色标记。关闭可减轻主界面 CPU。
        </p>
      </div>

      <section class="ui-tab__signal-group" aria-label="pm_down 降赔信号配置">
        <h3>pm_down 降赔信号</h3>
        <div class="ui-tab__row">
          <el-form-item label="开启显示:" class="ui-tab__control">
            <el-switch
              v-model="extensionPrefs.pmOddsDropCardUi"
              aria-label="pm_down 降赔信号显示"
              inline-prompt
              active-text="开启"
              inactive-text="关闭"
              size="large"
            />
          </el-form-item>
          <p class="ui-tab__desc">
            默认关闭。开启后在全场及各地图赔率上方显示 pm_down 降赔信号；监测需在降赔浮窗中开启。
          </p>
        </div>
      </section>

      <section class="ui-tab__signal-group" aria-label="pm_up 涨赔信号配置">
        <h3>pm_up 涨赔信号</h3>
        <div class="ui-tab__row">
          <el-form-item label="开启检测与显示:" class="ui-tab__control">
            <el-switch
              v-model="extensionPrefs.pmUp.enabled"
              aria-label="pm_up 开启检测与显示"
              inline-prompt active-text="开启" inactive-text="关闭" size="large"
            />
          </el-form-item>
          <p class="ui-tab__desc">
            开启后监测 changmen 收到的 PM 原始行情。PM 一侧涨赔且与其他场馆对侧形成套利时，
            在独立浮窗及对应盘口显示信号和场馆关注方向。仅检测展示，不自动下注；保存后持久生效。
          </p>
        </div>
        <div class="ui-tab__signal-fields">
          <el-form-item label="PM 最小涨幅:" class="ui-tab__control">
            <el-input-number v-model="extensionPrefs.pmUp.minRisePct" :min="0" :max="1000" :step="0.5" :precision="2" controls-position="right" aria-label="pm_up PM 最小涨幅" />
            <span class="ui-tab__signal-unit">%</span>
          </el-form-item>
          <el-form-item label="最小套利利润:" class="ui-tab__control">
            <el-input-number v-model="extensionPrefs.pmUp.minArbPct" :min="0" :max="100" :step="0.5" :precision="2" controls-position="right" aria-label="pm_up 最小套利利润" />
            <span class="ui-tab__signal-unit">%</span>
          </el-form-item>
          <el-form-item label="涨幅窗口:" class="ui-tab__control">
            <el-input-number v-model="extensionPrefs.pmUp.windowMs" :min="500" :max="60000" :step="500" controls-position="right" aria-label="pm_up 涨幅窗口毫秒" />
            <span class="ui-tab__signal-unit">ms</span>
          </el-form-item>
          <el-form-item label="同方向场馆冷却:" class="ui-tab__control">
            <el-input-number v-model="extensionPrefs.pmUp.cooldownMs" :min="0" :max="300000" :step="1000" controls-position="right" aria-label="pm_up 冷却毫秒" />
            <span class="ui-tab__signal-unit">ms</span>
          </el-form-item>
        </div>
        <p class="ui-tab__signal-hint">最小涨幅 0 表示任意实际涨赔；涨幅以窗口内最低赔率为基线。两个信号模块的配置互不影响。</p>
      </section>

      <div class="ui-tab__row">
        <el-form-item label="EV 金色标记:" class="ui-tab__control">
          <div class="ev-marker-prefs">
            <div class="ev-marker-prefs__row">
              <span class="ev-marker-prefs__label">基准</span>
              <el-radio-group
                v-model="extensionPrefs.valueBet.sharp"
                size="large"
              >
                <el-radio-button
                  v-for="p in VALUE_BET_SHARP_OPTIONS"
                  :key="p"
                  :value="p"
                >
                  {{ p }}
                </el-radio-button>
              </el-radio-group>
            </div>
            <div class="ev-marker-prefs__row">
              <span class="ev-marker-prefs__label">正EV</span>
              <el-input-number
                v-model="extensionPrefs.valueBet.minEdgePct"
                class="ev-marker-prefs__num"
                :min="0.5"
                :max="20"
                :step="0.5"
                :precision="1"
                controls-position="right"
              />
              <span class="ev-marker-prefs__unit">%</span>
            </div>
          </div>
        </el-form-item>
        <p class="ui-tab__desc">
          相对所选基准去水后算 edge。≥正EV 金色并可点角标确认下单。未达正EV 但 ≥1% 时虚线金框。基准馆自身不标记。
        </p>
      </div>

      <div class="ui-tab__row">
        <el-form-item label="EV 自动下注:" class="ui-tab__control">
          <div class="ev-marker-prefs">
            <div class="ev-marker-prefs__row">
              <el-switch
                v-model="extensionPrefs.valueBet.autoBet.enabled"
                inline-prompt
                active-text="开启"
                inactive-text="关闭"
                size="large"
              />
            </div>
            <div class="ev-marker-prefs__row">
              <span class="ev-marker-prefs__label">EV</span>
              <el-input-number
                v-model="extensionPrefs.valueBet.autoBet.minEdgePct"
                class="ev-marker-prefs__num"
                :min="0.5"
                :max="20"
                :step="0.5"
                :precision="1"
                controls-position="right"
              />
              <span class="ev-marker-prefs__unit">—</span>
              <el-input-number
                v-model="extensionPrefs.valueBet.autoBet.maxEdgePct"
                class="ev-marker-prefs__num"
                :min="extensionPrefs.valueBet.autoBet.minEdgePct || 0.5"
                :max="20"
                :step="0.5"
                :precision="1"
                controls-position="right"
              />
              <span class="ev-marker-prefs__unit">%</span>
            </div>
            <div class="ev-marker-prefs__row">
              <span class="ev-marker-prefs__label">基准赔率</span>
              <el-input-number
                v-model="extensionPrefs.valueBet.autoBet.minOdds"
                class="ev-marker-prefs__num"
                :min="1.01"
                :max="20"
                :step="0.01"
                :precision="2"
                controls-position="right"
              />
              <span class="ev-marker-prefs__unit">—</span>
              <el-input-number
                v-model="extensionPrefs.valueBet.autoBet.maxOdds"
                class="ev-marker-prefs__num"
                :min="extensionPrefs.valueBet.autoBet.minOdds || 1.01"
                :max="20"
                :step="0.01"
                :precision="2"
                controls-position="right"
              />
            </div>
            <div class="ev-marker-prefs__row">
              <span class="ev-marker-prefs__label">同图次数</span>
              <el-input-number
                v-model="extensionPrefs.valueBet.autoBet.maxPerMap"
                class="ev-marker-prefs__num"
                :min="1"
                :max="20"
                :step="1"
                :precision="0"
                controls-position="right"
              />
              <span class="ev-marker-prefs__unit">次</span>
            </div>
          </div>
        </el-form-item>
        <p class="ui-tab__desc">
          开关改了立即生效，保存只为下次打开还在。开启后主循环自动下单，不依赖套利开关。软盘 edge 在 EV 区间内、基准该侧赔率在区间内、同图未满次数才会下；每轮最多一笔。金额用参数配置的正EV金额（开了十位取整会取整）。同图次数含确认下单，本机多标签共用，刷新不清零。
        </p>
      </div>

    </el-form>

    <PmPfBufferSettings />

    <div class="flex flex-center">
      <el-button type="primary" class="am-icon-save" size="large" :loading="saving" @click="save">
        &nbsp;保存
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.ui-tab__signal-group {
  margin: 12px 0;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}
.ui-tab__signal-group h3 { margin: 0 0 12px; font-size: 14px; color: var(--el-text-color-primary); }
.ui-tab__signal-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 8px 16px; margin-top: 14px; }
.ui-tab__signal-fields :deep(.el-input-number) { width: 130px; }
.ui-tab__signal-unit { margin-left: 6px; }
.ui-tab__signal-hint { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--el-text-color-secondary); }
@media (max-width: 600px) { .ui-tab__signal-fields { grid-template-columns: minmax(0, 1fr); } }
.ui-tab__panel {
  margin-bottom: 16px;
  padding: 14px 16px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  box-sizing: border-box;
}

.ui-tab__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.ui-tab__control {
  flex: 0 0 520px;
  min-width: 0;
  max-width: 100%;
  margin-bottom: 0;
}

.ui-tab__control--theme {
  flex: 1 1 100%;
}

.ui-tab__panel :deep(.el-form-item__label) {
  justify-content: flex-start;
  height: auto;
  color: var(--el-text-color-regular);
}

.ui-tab__panel :deep(.el-form-item__content) {
  min-width: 0;
}

.ev-marker-prefs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ev-marker-prefs__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ev-marker-prefs__label {
  flex: 0 0 64px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.ev-marker-prefs__num {
  width: 110px;
}

.ev-marker-prefs__unit {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.theme-radios {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.theme-radios :deep(.el-radio) {
  margin-right: 0;
}

.ui-tab__desc {
  flex: 1 1 240px;
  min-width: 0;
  margin: 8px 0 0;
  padding-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

@media (max-width: 600px) {
  .ui-tab__panel :deep(.el-form-item) {
    display: block;
  }

  .ui-tab__panel :deep(.el-form-item__label) {
    margin-bottom: 8px;
  }
}
</style>
