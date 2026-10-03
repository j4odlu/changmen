<script setup lang="ts">
import type { UserConfigFormState } from "@/components/user/userConfigFormState";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import { computed, ref } from "vue";
import {
  BET_SORTING_KEYS,
  BET_SORTING_LABELS,
  USER_CONFIG_LABEL_W,

  waitTimePlatformPairs,
} from "@/components/user/userConfigFormState";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { previewMakeupOddsBand } from "@/extensions/arbBet/makeupOddsBand";
import { normalizeMakeupOddsBand } from "@/types/extensionPrefs";
import { ALL_PLATFORMS } from "@/types/userConfig";

const props = defineProps<{
  readonly?: boolean;
  autoOpenDate?: Date | null;
}>();

const emit = defineEmits<{
  "update:autoOpenDate": [Date | null];
}>();

// eslint-disable-next-line prefer-const -- defineModel ref is not reassigned, but Vue compiler requires `let` for v-model
let form = defineModel<UserConfigFormState>("form", { required: true });
const makeupOddsBand = defineModel<MakeupOddsBandPrefs | undefined>("makeupOddsBand");

const LABEL_W = USER_CONFIG_LABEL_W;
const sortingLabels = BET_SORTING_LABELS;
const sortingKeys = BET_SORTING_KEYS;
const platformPairs = waitTimePlatformPairs();

const dragIndex = ref(0);

const bandPreview = computed(() => {
  const prefs = makeupOddsBand.value;
  if (!prefs?.enabled || normalizeMakeupOddsBand(prefs).mode !== "oddsFactor")
    return null;
  return previewMakeupOddsBand(2, normalizeMakeupOddsBand(prefs));
});

const normalizedBand = computed(() => normalizeMakeupOddsBand(makeupOddsBand.value));

const openDate = computed({
  get() {
    if (props.autoOpenDate !== undefined)
      return props.autoOpenDate;
    return form.value.bettingAutoOpenTime ? new Date(form.value.bettingAutoOpenTime) : null;
  },
  set(v: Date | null) {
    if (!props.readonly)
      emit("update:autoOpenDate", v);
  },
});

function fieldDisabled(extra = false) {
  return props.readonly || extra;
}

function onDragStart(index: number) {
  if (props.readonly)
    return;
  dragIndex.value = index;
}

function onDragEnter(index: number, e: DragEvent) {
  if (props.readonly)
    return;
  e.preventDefault();
  if (dragIndex.value === index)
    return;
  const moved = form.value.providerSortValue[dragIndex.value];
  form.value.providerSortValue.splice(dragIndex.value, 1);
  form.value.providerSortValue.splice(index, 0, moved);
  dragIndex.value = index;
}

function onDragOver(e: DragEvent) {
  if (props.readonly)
    return;
  e.preventDefault();
}

function setWaitTime(platform: string, v: string | number) {
  if (props.readonly)
    return;
  form.value.waitTime[platform] = Number(v) || 0;
}
</script>

<template>
  <el-form :model="form" class="user-config-panel" :class="{ 'user-config-panel--readonly': readonly }">
    <el-form-item>
      <div class="bet-money-row">
        <el-form-item
          :label="form.betMoneyMode === 'total' ? '双腿合计金额:' : '买入金额:'"
          :label-width="form.betMoneyMode === 'total' ? '100px' : LABEL_W"
          class="bet-money-row__input"
        >
          <el-input v-model="form.betMoney" autocomplete="off" :disabled="fieldDisabled()" style="width: 120px" />
        </el-form-item>
        <el-select
          v-model="form.betMoneyMode"
          class="bet-money-row__mode"
          aria-label="初始下注金额模式"
          :disabled="fieldDisabled()"
          title="买入金额固定低赔腿；双腿合计金额按赔率分配初始注码。十位取整后实际合计可能略有变化。"
        >
          <el-option label="买入金额" value="buy" />
          <el-option label="双腿合计金额" value="total" />
        </el-select>
        <div class="bet-money-row__switches">
          <el-switch
            v-model="form.tenNumber"
            inline-prompt
            active-text="十位取整"
            inactive-text="十位取整"
            size="large"
            :disabled="fieldDisabled()"
          />
          <el-switch
            v-model="form.betting"
            inline-prompt
            active-text="开启买入"
            inactive-text="开启买入"
            size="large"
            :disabled="fieldDisabled()"
          />
          <el-switch
            v-if="!form.betting"
            v-model="form.bettingAutoOpen"
            inline-prompt
            active-text="定时打开"
            inactive-text="定时打开"
            size="large"
            :disabled="fieldDisabled()"
          />
        </div>
        <div class="bet-money-row__value-bet">
          <el-switch
            v-model="form.valueBetConfirm"
            inline-prompt
            active-text="正EV下单"
            inactive-text="正EV下单"
            size="large"
            :disabled="fieldDisabled()"
            title="开启后可点击金色 +x% 角标确认单边下单"
          />
          <el-form-item
            label="正EV金额:"
            :label-width="LABEL_W"
            class="bet-money-row__input"
            title="点击金色角标确认下单时的默认金额；不影响套利买入金额"
          >
            <el-input
              v-model="form.valueBetMoney"
              autocomplete="off"
              :disabled="fieldDisabled(!form.valueBetConfirm)"
              style="width: 120px"
            />
          </el-form-item>
        </div>
      </div>
    </el-form-item>

    <el-form-item v-if="!form.betting && form.bettingAutoOpen">
      <el-row>
        <el-col :span="8">
          <el-form-item label="开启时间:" :label-width="LABEL_W">
            <el-date-picker
              v-model="openDate"
              type="datetime"
              placeholder="Select date and time"
              :disabled="fieldDisabled()"
            />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form-item>

    <el-form-item>
      <el-row>
        <el-col :span="6">
          <el-form-item label="最低买入:" :label-width="LABEL_W">
            <el-input v-model="form.minMoney" autocomplete="off" :disabled="fieldDisabled()" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="最高买入:" :label-width="LABEL_W">
            <el-input v-model="form.maxMoney" autocomplete="off" :disabled="fieldDisabled()" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="买入次数" :label-width="LABEL_W">
            <el-input v-model="form.betCount" autocomplete="off" :disabled="fieldDisabled()" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="买入间隔" :label-width="LABEL_W">
            <el-input v-model="form.betInterval" autocomplete="off" :disabled="fieldDisabled()">
              <template #append>
                秒
              </template>
            </el-input>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form-item>

    <el-form-item>
      <el-row>
        <el-col :span="10">
          <el-form-item label="利润要求" :label-width="LABEL_W">
            <el-row>
              <el-col :span="10">
                <el-input
                  v-model="form.profit"
                  type="number"
                  autocomplete="off"
                  :disabled="fieldDisabled()"
                />
              </el-col>
              <el-col :span="2" class="text-gray-500">
                <span>-</span>
              </el-col>
              <el-col :span="10">
                <el-input
                  v-model="form.maxProfit"
                  type="number"
                  autocomplete="off"
                  :disabled="fieldDisabled()"
                />
              </el-col>
            </el-row>
          </el-form-item>
        </el-col>
        <el-col :span="7">
          <el-form-item label="最低赔率" :label-width="LABEL_W">
            <el-input v-model="form.minOdds" type="text" autocomplete="off" :disabled="fieldDisabled()" />
          </el-form-item>
        </el-col>
        <el-col :span="7">
          <el-form-item label="检测超时" :label-width="LABEL_W">
            <el-input v-model="form.checkTimeout" type="text" autocomplete="off" :disabled="fieldDisabled()">
              <template #append>
                ms
              </template>
            </el-input>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form-item>

    <el-row :gutter="12" class="config-sections-row">
      <el-col :span="8">
        <div class="config-section">
          <div class="config-section__title">补单配置</div>
          <el-form-item label="是否补单:">
            <el-switch v-model="form.makeUp" :disabled="fieldDisabled()" />
          </el-form-item>
          <el-form-item v-if="form.makeUp" label="补单利润:">
            <el-input
              v-model="form.makeProfit"
              autocomplete="off"
              :disabled="fieldDisabled(!form.makeUp || makeupOddsBand?.enabled === true)"
              :title="makeupOddsBand?.enabled
                ? '已改由上下沿作为消费门槛'
                : undefined"
            />
          </el-form-item>
          <template v-if="form.makeUp && makeupOddsBand">
            <el-form-item
              label="补单上下沿:"
              title="关：现网补单利润与入队初赔/当前赔率。开：按所选上下沿模式替代消费门槛与拒单即时重试。"
            >
              <el-switch
                v-model="makeupOddsBand.enabled"
                inline-prompt
                active-text="开"
                inactive-text="关"
                :disabled="fieldDisabled()"
              />
            </el-form-item>
            <template v-if="makeupOddsBand.enabled">
              <el-form-item label="判断方式:">
                <el-radio-group v-model="makeupOddsBand.mode" :disabled="fieldDisabled()" size="small">
                  <el-radio-button value="oddsFactor">
                    赔率系数
                  </el-radio-button>
                  <el-radio-button value="profitRate">
                    总体利润率
                  </el-radio-button>
                </el-radio-group>
              </el-form-item>
              <template v-if="normalizedBand.mode === 'oddsFactor'">
                <el-form-item
                  label="打平上浮:"
                  title="打平赔率乘该系数。已成 2 → 打平 2，1.02 即高于 2.04 才补。"
                >
                  <el-input-number
                    v-model="makeupOddsBand.upper"
                    :min="1.001"
                    :max="1.5"
                    :step="0.01"
                    :precision="3"
                    controls-position="right"
                    :disabled="fieldDisabled()"
                  />
                </el-form-item>
                <el-form-item
                  label="打平下浮:"
                  title="打平赔率乘该系数。0=亏损不补；0.96 即低于 1.92 才补。清空按 0.96。"
                >
                  <el-input-number
                    v-model="makeupOddsBand.lower"
                    :min="0"
                    :max="0.999"
                    :step="0.01"
                    :precision="3"
                    controls-position="right"
                    :disabled="fieldDisabled()"
                  />
                </el-form-item>
                <p v-if="bandPreview" class="config-section__hint">
                  已成 2 → 打平 {{ bandPreview.breakEvenOdds }}，
                  <template v-if="bandPreview.lowerOdds != null">
                    低于 {{ bandPreview.lowerOdds }} 或
                  </template>
                  高于 {{ bandPreview.upperOdds }} 才补
                </p>
              </template>
              <template v-else>
                <el-form-item
                  label="盈利上沿(%):"
                  title="补单后的总体保底利润率严格高于该值时补单。"
                >
                  <el-input-number
                    v-model="makeupOddsBand.upperProfitPct"
                    :min="0"
                    :max="100"
                    :step="0.5"
                    :precision="2"
                    controls-position="right"
                    :disabled="fieldDisabled()"
                  />
                </el-form-item>
                <el-form-item
                  label="亏损下沿(%):"
                  title="填写正数；总体保底利润率严格低于其负值时补单止损。"
                >
                  <el-input-number
                    v-model="makeupOddsBand.lowerLossPct"
                    :min="0"
                    :max="100"
                    :step="0.5"
                    :precision="2"
                    controls-position="right"
                    :disabled="fieldDisabled()"
                  />
                </el-form-item>
                <p class="config-section__hint">
                  −{{ normalizedBand.lowerLossPct }}% ～ +{{ normalizedBand.upperProfitPct }}% 内不补；
                  高于盈利上沿或低于亏损下沿才补。
                </p>
              </template>
            </template>
          </template>
          <template v-if="form.makeUp && makeupOddsBand?.enabled !== true">
            <el-form-item label="初始赔率:" title="初赔大于此设定赔率不进行补单">
              <el-input
                v-model="form.makeUp_defaultOdds"
                autocomplete="off"
                :disabled="fieldDisabled(!form.makeUp)"
              />
            </el-form-item>
            <el-form-item label="当前赔率:" title="补单的赔率大于此设定值不进行补单">
              <el-input
                v-model="form.makeUp_odds"
                autocomplete="off"
                :disabled="fieldDisabled(!form.makeUp)"
              />
            </el-form-item>
          </template>
          <el-form-item>
            <el-switch
              v-model="form.noSameProvider"
              inline-prompt
              active-text="不补同场馆"
              inactive-text="不补同场馆"
              size="large"
              :disabled="fieldDisabled()"
            />
          </el-form-item>
          <el-form-item>
            <el-switch
              v-model="form.noSameBet"
              inline-prompt
              active-text="场管不对打"
              inactive-text="场管不对打"
              size="large"
              :disabled="fieldDisabled()"
            />
          </el-form-item>
          <el-form-item v-if="form.noSameBet" label="允许同场馆:">
            <el-select
              v-model="form.allowSameBet"
              multiple
              collapse-tags
              placeholder="noSameBet 时仍参与选腿的平台"
              style="width: 100%"
              :disabled="fieldDisabled()"
            >
              <el-option v-for="p in ALL_PLATFORMS" :key="p" :label="p" :value="p" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <div class="any-odds-row">
              <el-tooltip
                effect="dark"
                content="1、下单失败用当前可买入的最高赔率继续买入。2、被拒单马上用最高赔率进行补单"
                placement="bottom"
              >
                <el-switch
                  v-model="form.anyOdds"
                  inline-prompt
                  active-text="任意赔率"
                  inactive-text="任意赔率"
                  size="large"
                  :disabled="fieldDisabled()"
                />
              </el-tooltip>
              <template v-if="form.anyOdds">
                <span class="any-odds-label">利润:</span>
                <el-input
                  v-model="form.anyOddsProfit"
                  autocomplete="off"
                  style="width: 80px"
                  :disabled="fieldDisabled(!form.anyOdds || makeupOddsBand?.enabled === true)"
                />
              </template>
            </div>
            <p v-if="form.anyOdds && makeupOddsBand?.enabled" class="config-section__hint">
              上下沿开启时，拒单即时重试也使用相同判断方式。
            </p>
          </el-form-item>
        </div>
      </el-col>

      <el-col :span="8">
        <div class="config-section">
          <div class="config-section__title">操盘顺序</div>
          <el-form-item>
            <el-radio-group
              v-model="form.betSorting"
              size="large"
              class="bet-sorting-group"
              :disabled="fieldDisabled()"
            >
              <el-radio v-for="key in sortingKeys" :key="key" :value="key">
                {{ sortingLabels[key] }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.betSorting === 'WinRate'" label="胜率差额:">
            <el-input
              v-model="form.winRateValue"
              autocomplete="off"
              :disabled="fieldDisabled(form.betSorting !== 'WinRate')"
            />
          </el-form-item>
          <el-form-item label="固定平台优先:">
            <el-select
              v-model="form.providerFixed"
              multiple
              collapse-tags
              placeholder="选中的平台在选腿时优先"
              style="width: 100%"
              :disabled="fieldDisabled()"
            >
              <el-option v-for="p in ALL_PLATFORMS" :key="`fixed-${p}`" :label="p" :value="p" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <div class="provider-sort">
              <div
                v-for="(p, index) in form.providerSortValue"
                :key="p"
                class="drag-item"
                :class="{ 'drag-item--static': readonly }"
                :draggable="!readonly"
                @dragstart="onDragStart(index)"
                @dragenter="onDragEnter(index, $event)"
                @dragover="onDragOver"
              >
                {{ p }}
              </div>
            </div>
          </el-form-item>
        </div>
      </el-col>

      <el-col :span="8">
        <div class="config-section">
          <div class="config-section__title">拒单检测</div>
          <template v-for="pair in platformPairs" :key="pair.join('-')">
            <el-row :gutter="8">
              <el-col v-for="p in pair" :key="p" :span="12">
                <el-form-item>
                  <el-input
                    :model-value="form.waitTime[p] ?? ''"
                    :disabled="fieldDisabled()"
                    class="wait-time-input"
                    @update:model-value="(v: string | number) => setWaitTime(p, v)"
                  >
                    <template #prepend>
                      <span class="wait-time-platform-badge" :title="p">
                        <PlatformIcon :platform="p" />
                      </span>
                    </template>
                  </el-input>
                </el-form-item>
              </el-col>
            </el-row>
          </template>
        </div>
      </el-col>
    </el-row>

    <slot name="footer" />
  </el-form>
</template>

<style scoped>
.bet-money-row {
  display: flex;
  flex-wrap: wrap;
  row-gap: 12px;
  align-items: center;
  width: 100%;
}

.bet-money-row__mode {
  flex-shrink: 0;
  width: 150px;
  margin-left: 12px;
}

.bet-money-row__input {
  flex-shrink: 0;
  margin-bottom: 0 !important;
}

.bet-money-row__switches {
  display: flex;
  gap: 20px;
  margin-left: 40px;
}

.bet-money-row__value-bet {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.any-odds-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.any-odds-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.user-config-panel :deep(.el-form-item) {
  margin-bottom: 14px;
}

.user-config-panel :deep(.el-form-item__label) {
  font-size: 13px;
}

.config-sections-row {
  align-items: stretch;
}

.config-section {
  height: 100%;
  margin: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px 4px;
}

.config-section__title {
  padding: 0 0 6px;
  margin: -4px 0 8px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color);
}

.config-section__hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}

.config-section :deep(.el-form-item) {
  margin-bottom: 10px;
}

.config-section :deep(.el-form-item__label) {
  font-size: 12px;
}

.config-section :deep(.el-input-number) {
  width: 120px;
}

.bet-sorting-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.provider-sort {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.drag-item {
  padding: 4px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font-size: 12px;
  cursor: grab;
  user-select: none;
  background: var(--el-fill-color, rgba(255,255,255,0.04));
  color: var(--el-text-color-regular, inherit);
}

.drag-item--static {
  cursor: default;
}

.user-config-panel--readonly :deep(.el-input.is-disabled .el-input__inner),
.user-config-panel--readonly :deep(.el-input.is-disabled .el-input__wrapper) {
  cursor: default;
}

.wait-time-input :deep(.el-input-group__prepend) {
  padding: 0 8px;
}

.wait-time-platform-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
}

.wait-time-platform-badge .provider-icon {
  width: 24px;
  height: 24px;
}
</style>
