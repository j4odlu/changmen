<script setup lang="ts">
import type { AccountEditFormState } from "@/components/account/accountEditFormState";
import type { PlatformId } from "@/types/esport";
import { computed, ref, useSlots, watch } from "vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { ALL_PLATFORMS } from "@/types/userConfig";

const POLYMARKET_OFFICIAL_REFERRAL_URL = "https://polymarket.com/?r=f43e";
const PREDICT_FUN_OFFICIAL_REFERRAL_URL = "https://predict.fun?ref=9F5AE";

/** 场馆账号设置：场馆按钮分三行（电竞核心 / 其余 / 预测市场+DEX） */
const PROVIDER_ROW1: PlatformId[] = ["OB", "RAY", "PB", "IA"];
const PROVIDER_ROW3: PlatformId[] = ["Polymarket", "PredictFun", "Limitless", "SXBet", "Dex"];

interface PlatformSuggestion { value: string; link: string }

const props = withDefaults(
  defineProps<{
    readonly?: boolean;
    /** 编辑已有账号：场馆不可改，只展示当前场馆图标 */
    providerLocked?: boolean;
    rateLocked?: boolean;
    multiplyEditable?: boolean;
    gameExpanded?: boolean;
    proxyOptions?: { label: string; value: number }[];
    hideSensitive?: boolean;
    fetchPlatforms?: (query: string, cb: (rows: PlatformSuggestion[]) => void) => void;
  }>(),
  {
    proxyOptions: () => [{ label: "无代理", value: 0 }],
  },
);

const emit = defineEmits<{
  unlockRate: [];
  addRate: [];
  removeRate: [index: number];
  markupOnlyChange: [];
  noMarkupChange: [];
  normalizeGameOdds: [gameName: string];
}>();

// eslint-disable-next-line prefer-const -- defineModel ref is not reassigned, but Vue compiler requires `let`
let form = defineModel<AccountEditFormState>("form", { required: true });
const slots = useSlots();

const providerRows = computed(() => {
  const known = new Set(ALL_PLATFORMS);
  const row1 = PROVIDER_ROW1.filter((p) => known.has(p));
  const row3 = PROVIDER_ROW3.filter((p) => known.has(p));
  const pinned = new Set<PlatformId>([...row1, ...row3]);
  const row2 = ALL_PLATFORMS.filter((p) => !pinned.has(p));
  return [row1, row2, row3];
});

const gameShow = ref(props.gameExpanded ?? false);
const hasTokenSlot = computed(() => Boolean(slots.token));
const useObTokenTabs = computed(() => form.value.provider === "OB" && hasTokenSlot.value);

watch(
  () => props.gameExpanded,
  (v) => {
    if (v !== undefined)
      gameShow.value = v;
  },
);

function fieldDisabled(extra = false) {
  return props.readonly || extra;
}

function venueIdentityTitle() {
  return "场馆返回的真实账号信息（查余额后更新）";
}

function displayVenueAccountName() {
  return form.value.venueAccountName || "—";
}

function displayVenueMemberId() {
  return form.value.venueMemberId || "—";
}

function multiplyFieldDisabled() {
  if (props.multiplyEditable)
    return false;
  return fieldDisabled();
}

function onMarkupOnlyChange() {
  if (props.readonly)
    return;
  emit("markupOnlyChange");
}

function onNoMarkupChange() {
  if (props.readonly)
    return;
  emit("noMarkupChange");
}

function toggleGame() {
  if (props.readonly)
    return;
  gameShow.value = !gameShow.value;
}

function unlockRate() {
  if (props.readonly)
    return;
  emit("unlockRate");
}
</script>

<template>
  <el-form label-width="100" class="account-edit-panel" :class="{ 'account-edit-panel--readonly': readonly }">
    <div class="account-edit-panel__columns">
      <div class="account-edit-panel__col account-edit-panel__col--left">
    <el-form-item label="平台：">
      <el-row :gutter="10" align="middle">
        <el-col :span="8">
          <el-autocomplete
            v-if="fetchPlatforms && !readonly"
            v-model="form.platformName"
            clearable
            :fetch-suggestions="fetchPlatforms"
            value-key="value"
          />
          <el-input v-else v-model="form.platformName" :disabled="fieldDisabled()" />
        </el-col>
        <el-col :span="8">
          <el-input
            v-model="form.playerName"
            placeholder="选填，空则用场馆账号"
            :disabled="fieldDisabled()"
          >
            <template #prepend>
              账号
            </template>
          </el-input>
        </el-col>
        <el-col :span="8">
          <el-switch
            v-model="form.pause"
            size="large"
            inline-prompt
            active-text="暂停账号"
            inactive-text="暂停账号"
            style="height: 24px; --el-switch-on-color: #f56c6c"
            :disabled="fieldDisabled()"
          />
        </el-col>
      </el-row>
    </el-form-item>

    <fieldset class="account-edit-panel__fieldset">
      <legend>
        <span @dblclick="unlockRate">买</span>
        入比例
        <el-button v-if="!readonly" size="small" type="info" link @click="emit('addRate')">
          <i class="am-icon-plus am-icon-fw" />
        </el-button>
      </legend>
      <el-form-item
        v-for="(row, index) in form.rateConfig"
        :key="index"
        :label="`比例配置${index + 1}:`"
      >
        <el-row :gutter="10">
          <el-col :span="6">
            <el-input
              v-model.number="row.minOdds"
              type="number"
              placeholder="最低赔率"
              :disabled="fieldDisabled()"
            >
              <template #prepend>
                低赔
              </template>
            </el-input>
          </el-col>
          <el-col :span="6">
            <el-input
              v-model.number="row.maxOdds"
              type="number"
              placeholder="最高赔率"
              :disabled="fieldDisabled()"
            >
              <template #prepend>
                高赔
              </template>
            </el-input>
          </el-col>
          <el-col :span="6">
            <el-input
              v-model.number="row.rate"
              type="number"
              placeholder="比例"
              :disabled="fieldDisabled(rateLocked)"
            >
              <template #prepend>
                比例
              </template>
            </el-input>
          </el-col>
          <el-col v-if="!readonly" :span="6">
            <el-button size="small" type="danger" @click="emit('removeRate', index)">
              <i class="am-icon-times" />
            </el-button>
          </el-col>
        </el-row>
      </el-form-item>
      <p v-if="!form.rateConfig.length" class="account-edit-panel__empty">
        暂无比例配置
      </p>
    </fieldset>

    <fieldset class="account-edit-panel__fieldset game-container" :class="{ show: gameShow }">
      <legend>
        游戏配置
        <el-button v-if="!readonly" size="small" type="info" link @click="toggleGame">
          <i class="am-icon-arrow-circle-down am-icon-fw" />
        </el-button>
      </legend>
      <div class="game-container-setting">
        <el-form-item
          v-for="[gameName, gameRow] in Object.entries(form.game)"
          :key="gameName"
          :label="`${gameName}：`"
        >
          <el-row v-if="gameRow" :gutter="10">
            <el-col :span="6">
              <el-input
                v-model.number="gameRow.profit"
                placeholder="利润"
                :disabled="fieldDisabled()"
              >
                <template #prepend>
                  利润
                </template>
              </el-input>
            </el-col>
            <el-col :span="6">
              <el-input
                v-model.number="gameRow.betCount"
                placeholder="订单量"
                :disabled="fieldDisabled()"
              >
                <template #prepend>
                  订单数
                </template>
              </el-input>
            </el-col>
            <el-col :span="12">
              <el-input-tag
                v-if="!readonly"
                v-model="gameRow.odds"
                placeholder="赔率范围"
                @change="emit('normalizeGameOdds', gameName)"
              >
                <template #prepend>
                  赔率
                </template>
              </el-input-tag>
              <el-input
                v-else
                :model-value="gameRow.odds.join(', ')"
                placeholder="赔率范围"
                :disabled="fieldDisabled()"
              >
                <template #prepend>
                  赔率
                </template>
              </el-input>
            </el-col>
          </el-row>
        </el-form-item>
      </div>
    </fieldset>

    <el-divider />

    <el-row>
      <el-col :span="12">
        <el-form-item label="初始赔率：">
          <el-row :gutter="10">
            <el-col :span="12">
              <el-input v-model.number="form.minDefault" placeholder="最低" :disabled="fieldDisabled()">
                <template #prepend>
                  最低
                </template>
              </el-input>
            </el-col>
            <el-col :span="12">
              <el-input v-model.number="form.maxDefault" placeholder="最高" :disabled="fieldDisabled()">
                <template #prepend>
                  最高
                </template>
              </el-input>
            </el-col>
          </el-row>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="买入赔率：">
          <el-row :gutter="10">
            <el-col :span="12">
              <el-input v-model.number="form.minOdds" placeholder="最低" :disabled="fieldDisabled()">
                <template #prepend>
                  最低
                </template>
              </el-input>
            </el-col>
            <el-col :span="12">
              <el-input v-model.number="form.maxOdds" placeholder="最高" :disabled="fieldDisabled()">
                <template #prepend>
                  最高
                </template>
              </el-input>
            </el-col>
          </el-row>
        </el-form-item>
      </el-col>
    </el-row>

    <el-row>
      <el-col :span="24">
        <el-form-item label="补单配置：">
          <el-row :gutter="10">
            <el-col :span="5">
              <el-switch
                v-model="form.markupOnly"
                size="large"
                inline-prompt
                active-text="仅限补单"
                inactive-text="仅限补单"
                style="height: 24px"
                :disabled="fieldDisabled()"
                @change="onMarkupOnlyChange"
              />
            </el-col>
            <el-col :span="5">
              <el-switch
                v-model="form.noMarkup"
                size="large"
                inline-prompt
                active-text="不参与补单"
                inactive-text="不参与补单"
                style="height: 24px"
                :disabled="fieldDisabled()"
                @change="onNoMarkupChange"
              />
            </el-col>
            <el-col :span="6">
              <el-input v-model.number="form.profit" type="number" placeholder="利润" :disabled="fieldDisabled()">
                <template #prepend>
                  利润
                </template>
              </el-input>
            </el-col>
            <el-col :span="6">
              <el-input
                v-model.number="form.maxBetCount"
                type="number"
                placeholder="下注单数"
                :disabled="fieldDisabled()"
              >
                <template #prepend>
                  盘口订单
                </template>
              </el-input>
            </el-col>
          </el-row>
        </el-form-item>
      </el-col>
    </el-row>

    <el-row>
      <el-col :span="24">
        <el-row :gutter="10">
          <el-col :span="9">
            <el-form-item label="工作时间：">
              <el-input-tag
                v-if="!readonly"
                v-model="form.workTimes"
                placeholder="格式:0-5，按回车添加"
              />
              <el-input
                v-else
                :model-value="form.workTimes.join(', ')"
                placeholder="格式:0-5"
                :disabled="fieldDisabled()"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-switch
              v-model="form.lastOdds"
              size="large"
              inline-prompt
              active-text="赔率大于上笔"
              inactive-text="赔率大于上笔"
              :disabled="fieldDisabled()"
            />
          </el-col>
          <el-col :span="6">
            <el-input
              v-model.number="form.multiply"
              type="number"
              placeholder="乘网倍数"
              :readonly="!multiplyEditable"
              :disabled="multiplyFieldDisabled()"
            >
              <template #prepend>
                乘网
              </template>
            </el-input>
          </el-col>
        </el-row>
      </el-col>
    </el-row>

    <el-form-item label="盈利上限：">
      <el-row :gutter="10">
        <el-col :span="4">
          <el-input v-model="form.maxProfit" :disabled="fieldDisabled()" />
        </el-col>
        <el-col :span="6">
          <el-input v-model.number="form.maxOrder" placeholder="单日最多订单" :disabled="fieldDisabled()">
            <template #prepend>
              单日订单
            </template>
          </el-input>
        </el-col>
        <el-col :span="7">
          <el-input v-model="form.maxBalance" placeholder="最大余额" :disabled="fieldDisabled()">
            <template #prepend>
              最大余额
            </template>
          </el-input>
        </el-col>
        <el-col :span="6">
          <el-input v-model="form.maxBalanceOdds" placeholder="超额赔率" :disabled="fieldDisabled()">
            <template #prepend>
              超额赔率
            </template>
          </el-input>
        </el-col>
      </el-row>
    </el-form-item>

    <el-form-item label="盈利余额：">
      <el-row :gutter="10">
        <el-col :span="4">
          <el-tooltip
            content="账户余额加未结算订单(算赢)不能超过此项设定"
            placement="top"
            effect="dark"
          >
            <el-input v-model="form.maxWinBalance" :disabled="fieldDisabled()" />
          </el-tooltip>
        </el-col>
        <el-col :span="6">
          <el-input v-model="form.realName" :disabled="fieldDisabled()">
            <template #prepend>
              姓名
            </template>
          </el-input>
        </el-col>
        <el-col :span="7">
          <el-input v-model="form.mobile" :disabled="fieldDisabled()">
            <template #prepend>
              手机
            </template>
          </el-input>
        </el-col>
        <el-col :span="6">
          <el-input v-model="form.city" :disabled="fieldDisabled()">
            <template #prepend>
              城市
            </template>
          </el-input>
        </el-col>
      </el-row>
    </el-form-item>

    <el-form-item label="账号备注：">
      <el-input v-model="form.description" :disabled="fieldDisabled()" />
    </el-form-item>
      </div>

      <div class="account-edit-panel__col account-edit-panel__col--right">
    <el-form-item label="场馆：">
      <!-- 编辑已有账号：场馆已绑定，只展示当前场馆，不再铺可选图标 -->
      <div v-if="providerLocked" class="account-edit-panel__provider-locked" :title="form.provider">
        <PlatformIcon :platform="form.provider" />
        <span class="account-edit-panel__provider-locked-name">{{ form.provider }}</span>
        <div class="account-edit-panel__venue" :title="venueIdentityTitle()">
          <span class="account-edit-panel__venue-item">
            <span class="account-edit-panel__venue-label">场馆账号</span>
            <span class="account-edit-panel__venue-value">{{ displayVenueAccountName() }}</span>
          </span>
          <span class="account-edit-panel__venue-item">
            <span class="account-edit-panel__venue-label">账号ID</span>
            <span class="account-edit-panel__venue-value account-edit-panel__venue-value--mono">{{ displayVenueMemberId() }}</span>
          </span>
        </div>
      </div>
      <template v-else>
        <el-radio-group
          v-model="form.provider"
          size="large"
          class="account-edit-panel__providers"
          :disabled="fieldDisabled()"
        >
          <div
            v-for="(row, rowIndex) in providerRows"
            :key="rowIndex"
            class="account-edit-panel__provider-row"
          >
            <el-radio-button v-for="p in row" :key="p" :value="p" :title="p">
              <PlatformIcon :platform="p" />
            </el-radio-button>
          </div>
        </el-radio-group>
        <div class="account-edit-panel__venue account-edit-panel__venue--below" :title="venueIdentityTitle()">
          <span class="account-edit-panel__venue-item">
            <span class="account-edit-panel__venue-label">场馆账号</span>
            <span class="account-edit-panel__venue-value">{{ displayVenueAccountName() }}</span>
          </span>
          <span class="account-edit-panel__venue-item">
            <span class="account-edit-panel__venue-label">账号ID</span>
            <span class="account-edit-panel__venue-value account-edit-panel__venue-value--mono">{{ displayVenueMemberId() }}</span>
          </span>
        </div>
      </template>
    </el-form-item>
    <template v-if="!hideSensitive">
      <el-form-item v-if="form.provider === 'Polymarket'" label="官网链接：">
        <a
          class="poly-official-referral-link"
          :href="POLYMARKET_OFFICIAL_REFERRAL_URL"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ POLYMARKET_OFFICIAL_REFERRAL_URL }}
        </a>
      </el-form-item>
      <el-form-item v-if="form.provider === 'PredictFun'" label="官网入口：">
        <a
          class="poly-official-referral-link"
          :href="PREDICT_FUN_OFFICIAL_REFERRAL_URL"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ PREDICT_FUN_OFFICIAL_REFERRAL_URL }}
        </a>
      </el-form-item>
      <el-form-item v-if="form.provider !== 'Polymarket' && form.provider !== 'PredictFun' && !useObTokenTabs" label="网关：">
        <el-input v-model="form.gateway" :disabled="fieldDisabled()" />
      </el-form-item>
      <slot name="token" />
      <el-form-item v-if="form.provider !== 'Polymarket' && form.provider !== 'PredictFun' && !useObTokenTabs" label="Token：">
        <el-input v-model="form.token" :disabled="fieldDisabled()" />
      </el-form-item>
      <el-form-item v-if="form.provider !== 'Polymarket' && form.provider !== 'PredictFun' && !useObTokenTabs" label="Referer：">
        <el-input v-model="form.referer" :disabled="fieldDisabled()" />
      </el-form-item>
      <el-form-item v-if="form.provider !== 'Polymarket' && form.provider !== 'PredictFun' && !useObTokenTabs" label="UserAgent:">
        <el-input
          v-model="form.userAgent"
          placeholder="请求访问的浏览器标识，不知道可留空"
          :disabled="fieldDisabled()"
        />
      </el-form-item>
      <el-form-item v-if="form.provider !== 'Polymarket' && form.provider !== 'PredictFun' && !useObTokenTabs" label="Cookie：">
        <el-input v-model="form.cookie" :disabled="fieldDisabled()" />
      </el-form-item>
    </template>
    <el-form-item
      v-if="hideSensitive && form.provider === 'Polymarket'"
      label="官网链接："
    >
      <a
        class="poly-official-referral-link"
        :href="POLYMARKET_OFFICIAL_REFERRAL_URL"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ POLYMARKET_OFFICIAL_REFERRAL_URL }}
      </a>
    </el-form-item>
    <el-form-item v-if="hideSensitive && form.gateway" label="网关：">
      <el-input v-model="form.gateway" :disabled="fieldDisabled()" />
    </el-form-item>

    <el-form-item label="使用代理：">
      <el-radio-group v-model="form.proxyId" :disabled="fieldDisabled()">
        <el-radio v-for="opt in proxyOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </el-radio>
      </el-radio-group>
    </el-form-item>

    <slot name="footer" />
      </div>
    </div>
  </el-form>
</template>

<style scoped>
.account-edit-panel__columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: start;
  gap: 32px;
}

.account-edit-panel__col {
  min-width: 0;
  padding: 0 4px;
}

.account-edit-panel__col--right {
  padding-left: 28px;
  border-left: 1px solid var(--el-border-color-lighter);
}

.account-edit-panel__provider-locked {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  max-width: 100%;
}

.account-edit-panel__provider-locked :deep(.provider-icon) {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}

.account-edit-panel__provider-locked-name {
  flex: 0 0 auto;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.account-edit-panel__provider-locked .account-edit-panel__venue {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px 16px;
  margin-left: 6px;
  min-height: 0;
  padding: 0;
}

.account-edit-panel__providers {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 100%;
}

.account-edit-panel__provider-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.account-edit-panel__providers :deep(.el-radio-button) {
  margin: 0;
}

.account-edit-panel__providers :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 8px;
}

.account-edit-panel__providers :deep(.provider-icon) {
  width: 28px;
  height: 28px;
}

.account-edit-panel__fieldset {
  margin: 0 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px 4px;
}

.account-edit-panel__fieldset legend {
  padding: 0 6px;
  font-size: 13px;
  font-weight: 600;
}

.account-edit-panel__empty {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.account-edit-panel__venue {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: 32px;
  padding: 2px 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--el-text-color-regular);
}

.account-edit-panel__venue--below {
  margin-top: 10px;
}

.account-edit-panel__venue-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.account-edit-panel__venue-label {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
}

.account-edit-panel__venue-label::after {
  content: "：";
}

.account-edit-panel__venue-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.account-edit-panel__venue-value--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.account-edit-panel--readonly :deep(.el-input.is-disabled .el-input__inner),
.account-edit-panel--readonly :deep(.el-input.is-disabled .el-input__wrapper) {
  cursor: default;
}

.poly-official-referral-link {
  color: var(--el-color-primary);
  word-break: break-all;
}

.pf-official-links {
  display: flex;
  flex-direction: column;
  gap: 6px;
  line-height: 1.45;
}
</style>
