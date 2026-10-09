<script setup lang="ts">
import type { PlatformId } from "@/types/esport";
import { betPlatformIds } from "@changmen/venue-adapter/registry";
import { ElMessage, ElMessageBox } from "element-plus";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import {
  normalizeValueBetSoftPlatforms,
  VALUE_BET_SOFT_CANDIDATES,
} from "@/extensions/valueBet/evConfig";
import { useUserStore } from "@/stores/userStore";
import {
  ARB_FAIL_AUTO_SELL_AVAILABLE,
  createDefaultValueBetSoftPlatforms,
  isArbAllowedPlatformOn,
  normalizeArbAllowedPlatforms,
  RAY_REJECT_MONITOR_DEFAULT_MINUTES,
  RAY_REJECT_MONITOR_MAX_MINUTES,
  RAY_REJECT_MONITOR_MIN_MINUTES,
  toggleArbAllowedPlatform,
} from "@/types/extensionPrefs";

const user = useUserStore();
const { extensionPrefs } = storeToRefs(user);
const saving = ref(false);
const arbFailAutoSellAvailable = ARB_FAIL_AUTO_SELL_AVAILABLE;
const evSoftPlatformOptions = VALUE_BET_SOFT_CANDIDATES;
const arbPlatformOptions = betPlatformIds();

// 与界面 Tab 同款：热更新 / 旧内存态缺字段时补齐
if (!Array.isArray(extensionPrefs.value.valueBetSoftPlatforms)) {
  extensionPrefs.value.valueBetSoftPlatforms = createDefaultValueBetSoftPlatforms();
}
else {
  extensionPrefs.value.valueBetSoftPlatforms = normalizeValueBetSoftPlatforms(
    extensionPrefs.value.valueBetSoftPlatforms,
  );
}
if (extensionPrefs.value.arbAllowedPlatforms === undefined) {
  extensionPrefs.value.arbAllowedPlatforms = null;
}
else {
  extensionPrefs.value.arbAllowedPlatforms = normalizeArbAllowedPlatforms(
    extensionPrefs.value.arbAllowedPlatforms,
  );
}
extensionPrefs.value.singleLeg9999MaxPerMap ??= 1;
// [changmen 扩展] 旧内存态默认 FOK；此字段仅保存偏好，不接入下注。
extensionPrefs.value.pmArbOrderMode ??= "FOK";
if (!extensionPrefs.value.rayLateRejectAutoMakeup) {
  extensionPrefs.value.rayLateRejectAutoMakeup = {
    enabled: false,
    monitorMinutes: RAY_REJECT_MONITOR_DEFAULT_MINUTES,
  };
}
extensionPrefs.value.rayLateRejectAutoMakeup.monitorMinutes
  ??= RAY_REJECT_MONITOR_DEFAULT_MINUTES;

const arbFailAutoSellTip = computed(() =>
  arbFailAutoSellAvailable
    ? "开：双边套利中 PM/PF 腿已成交、对侧拒单且未能补单（或补单随后放弃）时，自动市价卖掉该预测市场腿。默认关闭；不做止盈，仅风控减仓。9999 单边不触发。"
    : "暂不可开启（与补单 prune 叠加有误卖敞口风险，验证后再放开）。功能保留，开关锁定为关。",
);

function isEvSoftOn(platform: PlatformId): boolean {
  return extensionPrefs.value.valueBetSoftPlatforms.includes(platform);
}

function toggleEvSoft(platform: PlatformId) {
  const cur = extensionPrefs.value.valueBetSoftPlatforms;
  const sharp = extensionPrefs.value.valueBet?.sharp;
  if (cur.includes(platform)) {
    const remaining = cur.filter(p => p !== platform);
    if (remaining.length === 0)
      return;
    if (sharp && remaining.every(p => p === sharp))
      return;
    extensionPrefs.value.valueBetSoftPlatforms = normalizeValueBetSoftPlatforms(remaining);
    return;
  }
  extensionPrefs.value.valueBetSoftPlatforms = normalizeValueBetSoftPlatforms([...cur, platform]);
}

function isArbAllowedOn(platform: PlatformId): boolean {
  return isArbAllowedPlatformOn(extensionPrefs.value.arbAllowedPlatforms, platform);
}

function toggleArbAllowed(platform: PlatformId) {
  extensionPrefs.value.arbAllowedPlatforms = toggleArbAllowedPlatform(
    extensionPrefs.value.arbAllowedPlatforms,
    platform,
    arbPlatformOptions,
  );
}

async function onPmArbOrderModeChange(value: unknown) {
  if (value !== "GTC")
    return;
  try {
    await ElMessageBox.alert(
      "GTC 为测试版本，尚未接入。当前仅保存配置选项，实际下注仍沿用现有 FOK 流程。",
      "GTC 测试版本",
      { type: "warning", confirmButtonText: "知道了" },
    );
  }
  catch {
    // 关闭提示不改变配置，也不触发任何交易操作。
  }
}

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
  <div class="extensions-tab">
    <section class="extensions-tab__panel extensions-tab__venues">
      <h3 class="extensions-tab__heading">
        场馆参与
      </h3>

      <div class="venue-block">
        <div class="venue-block__head">
          <el-tooltip
            placement="top"
            :show-after="200"
            popper-class="extensions-tab-tip"
            content="哪些场馆参与 EV 下注。基准馆在界面 Tab，不会作为 EV 目标。至少保留一个。"
          >
            <span class="extensions-tab__tip-label">EV 软盘</span>
          </el-tooltip>
          <span class="venue-block__hint">点击切换</span>
        </div>
        <div class="venue-chips" role="group" aria-label="EV 下注场馆">
          <button
            v-for="p in evSoftPlatformOptions"
            :key="`ev-${p}`"
            type="button"
            class="venue-chip"
            :class="{ 'venue-chip--on': isEvSoftOn(p) }"
            :aria-pressed="isEvSoftOn(p)"
            @click="toggleEvSoft(p)"
          >
            <PlatformIcon :platform="p" />
            <span class="venue-chip__name">{{ p }}</span>
          </button>
        </div>
      </div>

      <div class="venue-block venue-block--arb">
        <div class="venue-block__head">
          <el-tooltip
            placement="top"
            :show-after="200"
            popper-class="extensions-tab-tip"
            content="哪些场馆参与自动套利。连线展示与补单不受影响。至少保留一个。"
          >
            <span class="extensions-tab__tip-label">自动套利</span>
          </el-tooltip>
          <span class="venue-block__hint">点击切换</span>
        </div>
        <div class="venue-chips" role="group" aria-label="自动套利场馆">
          <button
            v-for="p in arbPlatformOptions"
            :key="`arb-${p}`"
            type="button"
            class="venue-chip"
            :class="{ 'venue-chip--on': isArbAllowedOn(p) }"
            :aria-pressed="isArbAllowedOn(p)"
            @click="toggleArbAllowed(p)"
          >
            <PlatformIcon :platform="p" />
            <span class="venue-chip__name">{{ p }}</span>
          </button>
        </div>
      </div>
    </section>

    <section class="extensions-tab__panel extensions-tab__pm-mode">
      <div class="extensions-tab__section-head">
        <div>
          <h3 class="extensions-tab__heading">
            PM 自动套利下单模式
          </h3>
          <p class="extensions-tab__section-desc">
            GTC 为测试版本，尚未接入；当前两种选择均沿用现有 FOK 下单流程。
          </p>
        </div>
        <span class="extensions-tab__badge">changmen 扩展</span>
      </div>
      <el-form label-position="left" label-width="190px">
        <el-form-item label="下单模式">
          <el-radio-group
            v-model="extensionPrefs.pmArbOrderMode"
            aria-label="PM 自动套利下单模式"
            @change="onPmArbOrderModeChange"
          >
            <el-radio-button value="FOK">
              FOK
            </el-radio-button>
            <el-radio-button value="GTC">
              GTC（测试版本）
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </section>

    <section class="extensions-tab__panel extensions-tab__ray-reject">
      <div class="extensions-tab__section-head">
        <div>
          <h3 class="extensions-tab__heading">
            RAY 延迟拒单保护
          </h3>
          <p class="extensions-tab__section-desc">
            从 RAY 官网订单买入时间开始监控；到期自动解除。拒单后可交给现有补单策略处理。
          </p>
        </div>
        <span class="extensions-tab__badge">changmen 扩展</span>
      </div>

      <el-form label-position="left" label-width="190px">
        <el-form-item>
          <template #label>
            <el-tooltip
              placement="top"
              :show-after="200"
              popper-class="extensions-tab-tip"
              content="绑定到 RAY 场馆订单后，以官网返回的买入时间为起点；达到设置时长仍未拒单即自动解除监控。"
            >
              <span class="extensions-tab__tip-label">订单监控时长</span>
            </el-tooltip>
          </template>
          <el-input-number
            v-model="extensionPrefs.rayLateRejectAutoMakeup.monitorMinutes"
            :min="RAY_REJECT_MONITOR_MIN_MINUTES"
            :max="RAY_REJECT_MONITOR_MAX_MINUTES"
            :step="1"
            :precision="0"
            controls-position="right"
          />
          <span class="extensions-tab__setting-note">分钟（默认 5）</span>
        </el-form-item>

        <el-form-item>
          <template #label>
            <el-tooltip
              placement="top"
              :show-after="200"
              popper-class="extensions-tab-tip"
              content="RAY 订单在原拒单检测结束后才变为拒单时，自动交给现有补单队列。补单金额、赔率、上下沿、账号选择和重试规则全部沿用参数配置；默认关闭。"
            >
              <span class="extensions-tab__tip-label">延迟拒单后自动补单</span>
            </el-tooltip>
          </template>
          <el-switch
            v-model="extensionPrefs.rayLateRejectAutoMakeup.enabled"
            :disabled="user.config.makeUp !== true"
            inline-prompt
            active-text="开"
            inactive-text="关"
          />
          <span class="extensions-tab__setting-note">沿用现有补单策略</span>
        </el-form-item>
      </el-form>

      <p v-if="user.config.makeUp !== true" class="extensions-tab__ray-warning">
        请先在参数配置中开启“自动补单”；旁路监控仍会继续记录延迟拒单。
      </p>
    </section>

    <div class="extensions-tab__cols">
      <el-form label-position="left" label-width="158px" class="extensions-tab__panel">
        <h3 class="extensions-tab__heading">
          9999
        </h3>

        <el-form-item>
          <template #label>
            <el-tooltip
              placement="top"
              :show-after="200"
              popper-class="extensions-tab-tip"
              content="开：9999 本侧参与预检（失败整笔不下，本侧仍不下单）。关：跳过预检，仅对侧下单。"
            >
              <span class="extensions-tab__tip-label">9999 单边预检</span>
            </el-tooltip>
          </template>
          <el-switch
            v-model="extensionPrefs.singleLeg9999Precheck"
            inline-prompt
            active-text="开"
            inactive-text="关"
          />
        </el-form-item>

        <el-form-item>
          <template #label>
            <el-tooltip
              placement="top"
              :show-after="200"
              popper-class="extensions-tab-tip"
              content="开：真下单腿用参数配置的正EV金额；预检腿仍用套利计划额。关：仍用套利拆分金额。"
            >
              <span class="extensions-tab__tip-label">9999 用正EV金额</span>
            </el-tooltip>
          </template>
          <el-switch
            v-model="extensionPrefs.singleLeg9999UseValueBetMoney"
            inline-prompt
            active-text="开"
            inactive-text="关"
          />
        </el-form-item>

        <el-form-item>
          <template #label>
            <el-tooltip
              placement="top"
              :show-after="200"
              popper-class="extensions-tab-tip"
              content="同一比赛同一地图最多触发几笔 9999 单边真下单。默认 1 次；独立于 EV 自动下注次数。"
            >
              <span class="extensions-tab__tip-label">9999 同图次数</span>
            </el-tooltip>
          </template>
          <el-input-number
            v-model="extensionPrefs.singleLeg9999MaxPerMap"
            class="extensions-tab__num"
            :min="1"
            :max="20"
            :step="1"
            :precision="0"
            controls-position="right"
          />
          <span class="extensions-tab__unit">次</span>
        </el-form-item>
      </el-form>

      <div class="extensions-tab__panel">
        <el-form label-position="left" label-width="158px">
          <h3 class="extensions-tab__heading">
            高利润加仓
          </h3>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                content="implied 达阈值时两腿注码同乘；对冲比例不变。默认关闭。"
              >
                <span class="extensions-tab__tip-label">启用加仓</span>
              </el-tooltip>
            </template>
            <el-switch
              v-model="extensionPrefs.stakeScaleByProfit.enabled"
              inline-prompt
              active-text="开"
              inactive-text="关"
            />
          </el-form-item>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                content="1.05 = 利润 ≥ 5% 时触发加仓。"
              >
                <span class="extensions-tab__tip-label">利润阈值</span>
              </el-tooltip>
            </template>
            <el-input-number
              v-model="extensionPrefs.stakeScaleByProfit.minImplied"
              class="extensions-tab__num"
              :min="1.01"
              :max="2"
              :step="0.01"
              :precision="2"
              controls-position="right"
            />
          </el-form-item>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                content="例如 2 = 注码 ×2。"
              >
                <span class="extensions-tab__tip-label">金额倍数</span>
              </el-tooltip>
            </template>
            <el-input-number
              v-model="extensionPrefs.stakeScaleByProfit.multiplier"
              class="extensions-tab__num"
              :min="1.1"
              :max="10"
              :step="0.1"
              :precision="1"
              controls-position="right"
            />
          </el-form-item>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                content="开：触发加仓时，预检/下注按 Plan 金额换算，不乘账号比例系数。关：仍按账号比例配置缩放（默认）。"
              >
                <span class="extensions-tab__tip-label">加仓忽略账号比例</span>
              </el-tooltip>
            </template>
            <el-switch
              v-model="extensionPrefs.stakeScaleByProfit.skipAccountRateOnScale"
              inline-prompt
              active-text="开"
              inactive-text="关"
            />
          </el-form-item>

          <h3 class="extensions-tab__heading extensions-tab__heading--next">
            套利失败减仓
          </h3>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                :content="arbFailAutoSellTip"
              >
                <span class="extensions-tab__tip-label">自动卖 PM/PF</span>
              </el-tooltip>
            </template>
            <el-switch
              v-model="extensionPrefs.arbFailAutoSell.enabled"
              :disabled="!arbFailAutoSellAvailable"
              inline-prompt
              active-text="开"
              inactive-text="关"
            />
          </el-form-item>

          <h3 class="extensions-tab__heading extensions-tab__heading--next">
            提前锁利
          </h3>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                content="仅对「两边都是预测市场（PM/PF）」的未结套利生效：两边同时市价卖出，同卖净利 ≥ 锁定利润 × (1+额外%) 才触发。庄+预测市场不会触发（避免打单边）。默认关闭。"
              >
                <span class="extensions-tab__tip-label">启用提前锁利</span>
              </el-tooltip>
            </template>
            <el-switch
              v-model="extensionPrefs.arbEarlyLockSell.enabled"
              inline-prompt
              active-text="开"
              inactive-text="关"
            />
          </el-form-item>

          <el-form-item>
            <template #label>
              <el-tooltip
                placement="top"
                :show-after="200"
                popper-class="extensions-tab-tip"
                content="双边同卖净利相对锁定利润至少再多出的百分比。0 = 刚好 ≥ 锁定即两边同卖；10 = 至少多 10%。"
              >
                <span class="extensions-tab__tip-label">额外利润(%)</span>
              </el-tooltip>
            </template>
            <el-input-number
              v-model="extensionPrefs.arbEarlyLockSell.minExtraProfitPct"
              class="extensions-tab__num"
              :min="0"
              :max="500"
              :step="1"
              :precision="0"
              controls-position="right"
            />
          </el-form-item>
        </el-form>
      </div>
    </div>

    <div class="flex flex-center extensions-tab__save">
      <el-button type="primary" class="am-icon-save" size="large" :loading="saving" @click="save">
        &nbsp;保存
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.extensions-tab {
  min-width: min(780px, 92vw);
}

.extensions-tab__venues {
  margin-bottom: 16px;
  padding-bottom: 14px;
}

.extensions-tab__panel.extensions-tab__pm-mode {
  margin-bottom: 16px;
  padding-bottom: 14px;
}

.extensions-tab__ray-reject {
  margin: 16px 0;
  padding-bottom: 14px;
  border-color: color-mix(in srgb, var(--el-color-primary) 34%, var(--el-border-color-lighter));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--el-color-primary) 5%, var(--el-fill-color-blank)),
    var(--el-fill-color-blank)
  );
}

.extensions-tab__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.extensions-tab__section-desc {
  margin: -4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.extensions-tab__badge {
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11px;
  line-height: 16px;
}

.extensions-tab__setting-note {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.extensions-tab__ray-warning {
  margin: 0 0 0 190px;
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1.5;
}

.extensions-tab__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
}

.extensions-tab__panel {
  margin: 0;
  padding: 14px 16px 6px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  box-sizing: border-box;
}

.extensions-tab__heading {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--el-text-color-primary);
}

.extensions-tab__heading--next {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.extensions-tab__tip-label {
  display: inline-block;
  max-width: 100%;
  cursor: help;
  border-bottom: 1px dashed var(--el-border-color);
  line-height: 1.3;
}

.extensions-tab__tip-label--muted {
  cursor: default;
  border-bottom: none;
  color: var(--el-text-color-secondary);
}

.venue-block {
  margin-top: 4px;
}

.venue-block--arb {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.venue-block__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  margin-bottom: 8px;
  min-height: 28px;
}

.venue-block__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.venue-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.venue-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 5px 10px 5px 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, color 0.12s ease;
}

.venue-chip:hover {
  border-color: var(--el-color-primary-light-5);
}

.venue-chip--on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.venue-chip :deep(.provider-icon) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.venue-chip__name {
  font-weight: 500;
}

.extensions-tab__panel :deep(.el-form-item) {
  margin-bottom: 10px;
}

.extensions-tab__panel :deep(.el-form-item__label) {
  justify-content: flex-start;
  line-height: 32px;
  height: auto;
  padding-right: 12px;
  color: var(--el-text-color-regular);
}

.extensions-tab__panel :deep(.el-form-item__content) {
  justify-content: flex-start;
  min-width: 120px;
}

.extensions-tab__num {
  width: 120px;
}

.extensions-tab__unit {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.extensions-tab__save {
  margin-top: 16px;
}

@media (max-width: 900px) {
  .extensions-tab {
    min-width: 0;
  }

  .extensions-tab__cols {
    grid-template-columns: 1fr;
  }

  .extensions-tab__ray-warning {
    margin-left: 0;
  }
}
</style>

<style>
.extensions-tab-tip {
  max-width: 360px;
  line-height: 1.5;
  white-space: normal;
}
</style>
