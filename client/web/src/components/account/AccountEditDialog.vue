<script setup lang="ts">
import type { AccountEditFormState } from "@/components/account/accountEditFormState";
import { resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { createAccountEditFormStateFromPlatformAccount } from "@/components/account/accountEditFormState";
import { PlatformAccount } from "@/models/platformAccount";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";
import { parsePbVenueIdentity } from "@changmen/venue-browser/adapter/pb";
import AccountEditPanel from "./AccountEditPanel.vue";
import type { AccountEditDialogProps } from "./accountEditContext";
import { createPolymarketAccountEditor } from "./polymarketAccountEditor";
import { createPredictFunAccountEditor } from "./predictFunAccountEditor";
import { createObSportAccountEditor } from "./obSportAccountEditor";
import { createAccountCredentialPaste } from "./accountCredentialPaste";
import { createAccountEditSave } from "./accountEditSave";

const props = defineProps<AccountEditDialogProps>();

const emit = defineEmits<{ close: []; multiplySaved: [multiply: number] }>();

const route = useRoute();
const onSportsWorkspace = computed(() => String(route.path || "").startsWith("/sports"));
const obTokenTab = ref<"esport" | "sport">(onSportsWorkspace.value ? "sport" : "esport");

const accountStore = useAccountStore();
const userStore = useUserStore();
const { proxyList } = storeToRefs(userStore);
const { tagPlatforms } = storeToRefs(accountStore);

const saving = ref(false);

/** 与 UserConfigDialog 一致：避免 v-model 与 @closed 竞态导致弹窗闪关 */
const visible = computed({
  get: () => props.open,
  set: (v: boolean) => {
    if (!v)
      emit("close");
  },
});
const pasteRaw = ref("");
const gameShow = ref(false);
/** A8：PB 默认锁定比例，legend「买」双击解锁 */
const rateLocked = ref(false);

interface PlatformSuggestion { value: string; link: string }

let form = reactive<AccountEditFormState>(
  createAccountEditFormStateFromPlatformAccount(
    new PlatformAccount({ accountId: 0, playerName: "", provider: "Polymarket" }),
  ),
);

const editContext = { get form() { return form; }, props, userStore };
const polymarketEditor = createPolymarketAccountEditor(editContext);
const {
  polyWalletAddress,
  polyFunder,
  polyPrivateKey,
  polyLocalKeyReady,
  polyPrivateKeyPlaceholder,
  polyPrivateKeyHintText,
  polyApiCreds,
  polyGenerating,
  polyRelayerPreparing,
  polyRelayerConfigured,
  polyAdvancedMode,
  polyDerivingAddresses,
  syncPolymarketFieldsFromToken,
  syncPolymarketWalletAddressFromPrivateKey,
  onGeneratePolymarketApiCreds,
  refreshPolymarketRelayerStatus,
  onPreparePolymarketWallet,
  onDerivePolymarketAddresses,
} = polymarketEditor;
const predictFunEditor = createPredictFunAccountEditor(editContext);
const {
  pfPrivyPrivateKey,
  pfPredictAccount,
  pfPrivyAddress,
  pfLocalKeyStatus,
  pfLocalKeyReady,
  pfPrivyKeyPlaceholder,
  pfPrivyKeyHintText,
  refreshPfPrivyAddressDisplay,
  copyPfPrivyAddress,
  syncPredictFunFieldsFromToken,
} = predictFunEditor;
const obSportEditor = createObSportAccountEditor(editContext);
const { sportObForm, resetSportObForm, sportObFromForm, probeObSportCredentialForSave } = obSportEditor;
const credentialPaste = createAccountCredentialPaste({
  ...editContext,
  get form() { return form; },
  pasteRaw,
  obTokenTab,
  sportObForm,
  syncPolymarketFieldsFromToken,
  applyPbIdentityFromToken,
});
const { pasteFromClipboard, onPasteQuickFill, applyPaste } = credentialPaste;
const editSave = createAccountEditSave({
  ...editContext,
  get form() { return form; },
  accountStore,
  saving,
  obTokenTab,
  sportObForm,
  emit,
  sportObFromForm,
  probeObSportCredentialForSave,
  polymarket: polymarketEditor,
  predictFun: predictFunEditor,
});
const { save, saveAdminAccountFields } = editSave;

function applyPbIdentityFromToken(token: string | undefined) {
  const identity = parsePbVenueIdentity(token);
  if (!identity)
    return;
  form.venueMemberId = identity.venueMemberId;
  form.venueAccountName = identity.venueAccountName;
  if (!form.playerName.trim())
    form.playerName = identity.venueAccountName;
}

const platformSuggestions = computed<PlatformSuggestion[]>(() =>
  tagPlatforms.value.map(p => ({
    value: p.Name || "",
    link: String(p.ID ?? ""),
  })),
);

const proxyOptions = computed(() => {
  if (props.previewProxyOptions?.length)
    return props.previewProxyOptions;
  return [
    { label: "无代理", value: 0 },
    ...proxyList.value.map(px => ({
      label: px.label || String(px.proxyId),
      value: px.proxyId,
    })),
  ];
});

function resetForm(acc?: PlatformAccount) {
  // 废止上一账号未完成的推导/apiCreds，避免串写到当前表单
  polymarketEditor.cancelPending();
  const src = acc ?? new PlatformAccount({ accountId: 0, playerName: "", provider: "Polymarket" });
  Object.assign(form, createAccountEditFormStateFromPlatformAccount(src));
  pasteRaw.value = "";
  obTokenTab.value = onSportsWorkspace.value ? "sport" : "esport";
  gameShow.value = false;
  rateLocked.value = form.provider === "PB";
  if (form.provider === "Polymarket") {
    form.gateway ||= "https://clob.polymarket.com";
    form.referer ||= "https://polymarket.com/zh";
  }
  if (form.provider === "PredictFun") {
    form.platformName = form.platformName.trim() || "PredictFun";
    form.gateway = "";
    form.referer = "";
    form.userAgent = "";
    form.cookie = "";
    syncPredictFunFieldsFromToken(form.token);
  }
  else {
    pfPrivyPrivateKey.value = "";
    pfPredictAccount.value = "";
    pfPrivyAddress.value = "";
    pfLocalKeyStatus.value = "none";
  }
  syncPolymarketFieldsFromToken(form.token);
  if (form.provider === "PB" && !form.venueMemberId)
    applyPbIdentityFromToken(form.token);
  resetSportObForm(acc);
}

function syncForm() {
  if (props.previewForm) {
    Object.assign(form, structuredClone(props.previewForm));
    pasteRaw.value = "";
    gameShow.value = true;
    rateLocked.value = form.provider === "PB";
    syncPolymarketFieldsFromToken(form.token);
    return;
  }
  resetForm(props.account);
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      // 关窗废止未完成异步，避免稍后写回已切换的表单
      polymarketEditor.cancelPending();
      return;
    }
    if (props.previewForm) {
      syncForm();
      return;
    }
    void userStore.loadExtras();
    void accountStore.loadTagPlatforms();
    resetForm(props.account);
  },
);

watch(
  () => form.provider,
  (p) => {
    rateLocked.value = p === "PB";
    form.multiply = resolveAccountMultiply(p, form.multiply);
    if (p === "Polymarket") {
      form.gateway ||= "https://clob.polymarket.com";
      form.referer ||= "https://polymarket.com/zh";
      syncPolymarketFieldsFromToken(form.token);
      void refreshPolymarketRelayerStatus();
    }
    if (p === "PredictFun") {
      form.platformName = form.platformName.trim() || "PredictFun";
      form.gateway = "";
      form.referer = "";
      form.userAgent = "";
      form.cookie = "";
      syncPredictFunFieldsFromToken(form.token);
    }
  },
);

watch(
  () => polyPrivateKey.value,
  () => {
    if (form.provider !== "Polymarket" || polyAdvancedMode.value)
      return;
    syncPolymarketWalletAddressFromPrivateKey();
  },
);

watch(
  () => pfPrivyPrivateKey.value,
  () => {
    if (form.provider !== "PredictFun")
      return;
    refreshPfPrivyAddressDisplay();
  },
);

function queryPlatforms(query: string, cb: (rows: PlatformSuggestion[]) => void) {
  const q = query.trim();
  const list = q
    ? platformSuggestions.value.filter(s => s.value.includes(q))
    : platformSuggestions.value;
  cb(list);
}

function addRate() {
  form.rateConfig.push({ minOdds: 0, maxOdds: 0, rate: 1 });
}

function removeRate(index: number) {
  if (index >= 0 && index < form.rateConfig.length)
    form.rateConfig.splice(index, 1);
}

function normalizeGameOdds(gameName: string) {
  const g = form.game[gameName];
  if (!g)
    return;
  const next: string[] = [];
  for (const raw of g.odds) {
    const [lo, hi] = raw.split("-").map(x => Number(x));
    if (!Number.isNaN(lo) && !Number.isNaN(hi) && lo <= hi)
      next.push(`${lo}-${hi}`);
  }
  g.odds = next;
}

function onMarkupOnlyChange() {
  if (form.markupOnly)
    form.noMarkup = false;
}

function onNoMarkupChange() {
  if (form.noMarkup)
    form.markupOnly = false;
}

function unlockRate() {
  rateLocked.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    width="1500"
    append-to-body
    :z-index="zIndex"
    :close-on-press-escape="false"
    :close-on-click-modal="false"
    title="场馆账号设置"
  >
    <AccountEditPanel
      v-model:form="form"
      :readonly="readonly"
      :provider-locked="Boolean(account?.accountId)"
      :multiply-editable="Boolean(allowMultiplyEdit && adminTargetUserId)"
      :hide-sensitive="Boolean(previewForm)"
      :rate-locked="rateLocked"
      :game-expanded="gameShow"
      :proxy-options="proxyOptions"
      :fetch-platforms="previewForm ? undefined : queryPlatforms"
      @unlock-rate="unlockRate"
      @add-rate="addRate"
      @remove-rate="removeRate"
      @markup-only-change="onMarkupOnlyChange"
      @no-markup-change="onNoMarkupChange"
      @normalize-game-odds="normalizeGameOdds"
    >
      <template v-if="form.provider === 'OB'" #token>
        <fieldset class="ob-token-fieldset">
          <legend>OB 账号凭证</legend>
          <el-tabs v-model="obTokenTab" class="ob-token-tabs">
            <el-tab-pane label="电竞" name="esport">
              <div class="ob-token-note">
                <strong>电竞线路</strong>
                <span>用于电竞余额、注单和下注，与体育凭证独立保存。</span>
              </div>
              <div class="ob-token-grid">
                <el-form-item class="ob-token-item" label="API 网关">
                  <el-input
                    v-model="form.gateway"
                    :disabled="readonly"
                    placeholder="电竞接口地址"
                  />
                </el-form-item>
                <el-form-item class="ob-token-item" label="Token">
                  <el-input
                    v-model="form.token"
                    autocomplete="off"
                    :disabled="readonly"
                    placeholder="电竞下注请求携带的 Token"
                  />
                </el-form-item>
                <el-form-item class="ob-token-item" label="Referer">
                  <el-input v-model="form.referer" :disabled="readonly" />
                </el-form-item>
                <el-form-item class="ob-token-item" label="Cookie">
                  <el-input v-model="form.cookie" :disabled="readonly" />
                </el-form-item>
                <el-form-item class="ob-token-item ob-token-item--wide" label="UserAgent">
                  <el-input
                    v-model="form.userAgent"
                    placeholder="请求访问的浏览器标识，不知道可留空"
                    :disabled="readonly"
                  />
                </el-form-item>
              </div>
            </el-tab-pane>
            <el-tab-pane label="体育" name="sport">
              <div class="ob-token-note">
                <strong>体育线路</strong>
                <span>用于体育余额及足球/POD 下单，保存时不会修改电竞凭证。</span>
              </div>
              <div class="ob-token-grid">
                <el-form-item class="ob-token-item">
                  <template #label>
                    <span class="ob-token-label">API 网关 <small>origin</small></span>
                  </template>
                  <el-input
                    v-model="sportObForm.gateway"
                    :disabled="readonly"
                    placeholder="例如 https://api.example.com"
                  />
                </el-form-item>
                <el-form-item class="ob-token-item">
                  <template #label>
                    <span class="ob-token-label">会员 UID <small>cuid</small></span>
                  </template>
                  <el-input
                    v-model="sportObForm.venueMemberId"
                    :disabled="readonly"
                    placeholder="由插件自动识别"
                  />
                </el-form-item>
                <el-form-item class="ob-token-item">
                  <template #label>
                    <span class="ob-token-label">体育 Token <small>requestId</small></span>
                  </template>
                  <el-input
                    v-model="sportObForm.token"
                    autocomplete="off"
                    :disabled="readonly"
                    placeholder="体育请求携带的 requestId"
                  />
                </el-form-item>
                <el-form-item class="ob-token-item">
                  <template #label>
                    <span class="ob-token-label">来源地址 <small>Referer</small></span>
                  </template>
                  <el-input
                    v-model="sportObForm.referer"
                    :disabled="readonly"
                    placeholder="通常由插件自动填入"
                  />
                </el-form-item>
              </div>
            </el-tab-pane>
          </el-tabs>
        </fieldset>
      </template>

      <template v-if="form.provider === 'Polymarket'" #token>
        <fieldset class="poly-token-fieldset">
          <legend>Token</legend>
          <el-form-item label="钱包私钥：">
            <el-input
              v-model="polyPrivateKey"
              show-password
              autocomplete="off"
              :placeholder="polyPrivateKeyPlaceholder"
              :disabled="readonly"
              style="font-family: monospace; font-size: 12px"
            />
            <span v-if="polyLocalKeyReady && !polyPrivateKey.trim()" class="poly-credential-hint">
              {{ polyPrivateKeyHintText }}
            </span>
          </el-form-item>
          <el-form-item v-if="!readonly" label="地址：">
            <el-button
              type="primary"
              plain
              :loading="polyDerivingAddresses"
              :disabled="!polyPrivateKey.trim() && !polyLocalKeyReady"
              @click="onDerivePolymarketAddresses"
            >
              从私钥推导 EOA / funder
            </el-button>
            <span class="poly-credential-hint">
              保存账号时会自动推导 EOA 与充值地址
            </span>
          </el-form-item>
          <el-form-item label="EOA 地址：">
            <el-input
              v-model="polyWalletAddress"
              placeholder="由私钥自动推导"
              :readonly="!polyAdvancedMode"
              :disabled="readonly && !polyWalletAddress"
              style="font-family: monospace; font-size: 12px"
            />
          </el-form-item>
          <el-form-item label="充值地址：">
            <el-input
              v-model="polyFunder"
              placeholder="由私钥自动推导的 Deposit Wallet（funder）"
              :readonly="!polyAdvancedMode"
              :disabled="readonly && !polyFunder"
              class="poly-funder-input"
              :class="{ 'poly-credential-readonly': !polyAdvancedMode }"
              style="font-family: monospace; font-size: 12px"
            />
            <p class="poly-funder-deposit-hint">
              请向此地址充值 <strong>Polygon</strong> 链上的 <strong>USDC</strong>
              （勿充 ETH 主网或其它链）。
              <template v-if="!polyAdvancedMode">
                地址由私钥自动推导，不可修改。
              </template>
              <template v-else>
                当前为高级模式，可手动指定（官网 Proxy/Safe 导入）。
              </template>
            </p>
          </el-form-item>
          <el-form-item v-if="!readonly" label="高级：">
            <el-checkbox v-model="polyAdvancedMode">
              手动指定 EOA / 充值地址（官网 Proxy/Safe 导入）
            </el-checkbox>
          </el-form-item>
          <el-form-item v-if="!readonly" label="API 凭证：">
            <el-button
              type="primary"
              plain
              :loading="polyGenerating"
              @click="onGeneratePolymarketApiCreds"
            >
              生成/验证 apiCreds
            </el-button>
            <el-button
              type="success"
              plain
              :loading="polyRelayerPreparing"
              :disabled="polyRelayerConfigured === false"
              @click="onPreparePolymarketWallet"
            >
              部署钱包并授权交易
            </el-button>
            <span class="poly-credential-hint">
              钱包未部署时自动部署，并完成买卖所需授权。
            </span>
            <span class="poly-credential-hint">
              {{ polyApiCreds ? "已生成，保存时会写入 token（signatureType=3）" : "保存时也会自动生成 apiCreds" }}
              <template v-if="polyRelayerConfigured === false">
                · 服务端 Relayer 未配置
              </template>
            </span>
          </el-form-item>
          <template v-if="polyApiCreds">
            <p class="poly-credential-readonly-hint">
              以下凭证由「生成/验证 apiCreds」自动派生，只读不可手改；变更钱包/私钥后请重新生成。
            </p>
            <el-form-item label="apiKey：">
              <el-input
                :model-value="polyApiCreds.apiKey"
                readonly
                class="poly-credential-readonly"
                style="font-family: monospace; font-size: 12px"
              />
            </el-form-item>
            <el-form-item label="secret：">
              <el-input
                :model-value="polyApiCreds.secret"
                readonly
                show-password
                class="poly-credential-readonly"
                style="font-family: monospace; font-size: 12px"
              />
            </el-form-item>
            <el-form-item label="passphrase：">
              <el-input
                :model-value="polyApiCreds.passphrase"
                readonly
                show-password
                class="poly-credential-readonly"
                style="font-family: monospace; font-size: 12px"
              />
            </el-form-item>
          </template>
        </fieldset>
      </template>

      <template v-if="form.provider === 'PredictFun'" #token>
        <fieldset class="poly-token-fieldset">
          <legend>Predict.fun 凭证（均必填）</legend>
          <p class="poly-credential-readonly-hint">
            与官网一致：需要 <strong>Privy 私钥</strong> + <strong>Predict 智能钱包地址</strong>。
            API Key / JWT 不用填。私钥仅存本机加密仓，不会上传到服务器。
          </p>
          <el-form-item label="Privy 私钥：">
            <el-input
              v-model="pfPrivyPrivateKey"
              show-password
              autocomplete="off"
              :placeholder="pfPrivyKeyPlaceholder"
              :disabled="readonly"
              style="font-family: monospace; font-size: 12px"
            />
            <span v-if="pfLocalKeyReady && !pfPrivyPrivateKey.trim()" class="poly-credential-hint">
              {{ pfPrivyKeyHintText }}
            </span>
            <p class="poly-funder-deposit-hint">
              <a
                class="poly-official-referral-link"
                href="https://predict.fun/account/settings"
                target="_blank"
                rel="noopener noreferrer"
              >设置页（Export 导出 Privy 私钥）</a>
              <br>
              打开账户设置 → <strong>Export / 导出</strong> → 复制私钥。
              这是签名用的钥，对应的 EOA 地址一般<strong>不等于</strong>下面的智能钱包地址。
            </p>
          </el-form-item>
          <el-form-item label="Privy 地址：">
            <div class="pf-privy-address-row">
              <el-input
                :model-value="pfPrivyAddress"
                :placeholder="pfLocalKeyStatus === 'stored'
                  ? '请先解锁本机钱包以显示'
                  : '粘贴 Privy 私钥后自动推导（充 BNB 用）'"
                readonly
                style="font-family: monospace; font-size: 12px; flex: 1"
              />
              <el-button
                v-if="pfPrivyAddress"
                plain
                @click="copyPfPrivyAddress"
              >
                复制
              </el-button>
            </div>
            <p class="poly-funder-deposit-hint">
              官网设置页通常<strong>不直接展示</strong>此地址；由 Privy 私钥推导。
              请向此地址充少量 <strong>BNB</strong>（gas / approvals），<strong>不要</strong>往下面的智能钱包充 BNB。
            </p>
          </el-form-item>
          <el-form-item label="Predict 智能钱包：">
            <el-input
              v-model="pfPredictAccount"
              placeholder="0x… 充值页「Predict 智能钱包」地址"
              :disabled="readonly"
              style="font-family: monospace; font-size: 12px"
            />
            <p class="poly-funder-deposit-hint">
              <a
                class="poly-official-referral-link"
                href="https://predict.fun/account/deposit"
                target="_blank"
                rel="noopener noreferrer"
              >充值页（复制「Predict 智能钱包」地址）</a>
              <br>
              打开充值页，复制标题为 <strong>「Predict 智能钱包」</strong> 的地址（文案：仅向此地址充值 USDT · BNB 链）。
              <br>
              <strong>不要</strong>复制下面的「智能路由地址」（跨链中转，不能当 Predict Account）。
              <br>
              该地址<strong>只收 BNB 链 USDT</strong>；其它链/币种请走智能路由，但表单仍只填智能钱包地址。
            </p>
          </el-form-item>
        </fieldset>
      </template>

      <template v-if="adminTargetUserId && account && allowMultiplyEdit" #footer>
        <div class="el-form-submit flex flex-center">
          <el-button
            type="primary"
            size="large"
            style="width: 98%"
            :loading="saving"
            @click="saveAdminAccountFields"
          >
            保存管理修改
          </el-button>
        </div>
      </template>

      <template v-else-if="!readonly" #footer>
        <el-form-item label="快速填充：">
          <el-input
            v-model="pasteRaw"
            :placeholder="form.provider === 'OB'
              ? '粘贴 OB 电竞或体育凭证，自动识别并切换'
              : '通过插件获取到的数据快速填充进入'"
            @change="applyPaste"
            @paste="onPasteQuickFill"
          >
            <template #append>
              <div class="parse" @click="pasteFromClipboard">
                粘贴
              </div>
            </template>
          </el-input>
        </el-form-item>

        <div class="el-form-submit flex flex-center">
          <el-button
            type="primary"
            size="large"
            style="width: 98%"
            :loading="saving"
            @click="save"
          >
            保存
          </el-button>
        </div>
      </template>
    </AccountEditPanel>
  </el-dialog>
</template>

<style scoped>
.ob-token-fieldset,
.poly-token-fieldset {
  margin: 0 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px 4px;
}

.ob-token-fieldset {
  border-radius: 8px;
  padding: 12px 16px 6px;
}

.ob-token-fieldset legend,
.poly-token-fieldset legend {
  padding: 0 6px;
  font-size: 13px;
  font-weight: 600;
}

.ob-token-tabs {
  padding-top: 2px;
}

.ob-token-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.ob-token-tabs :deep(.el-tabs__item) {
  min-width: 88px;
  font-weight: 600;
}

.ob-token-tabs :deep(.el-tabs__content) {
  padding-top: 12px;
}

.ob-token-note {
  margin: 0 0 12px;
  padding: 9px 12px;
  border-left: 3px solid var(--el-color-primary);
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.ob-token-note strong {
  margin-right: 8px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.ob-token-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 20px;
}

.ob-token-item {
  display: block;
  min-width: 0;
  margin-bottom: 14px;
}

.ob-token-item--wide {
  grid-column: 1 / -1;
}

.ob-token-item :deep(.el-form-item__label) {
  display: flex;
  float: none;
  justify-content: flex-start;
  width: auto !important;
  height: 24px;
  padding: 0;
  line-height: 20px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 500;
}

.ob-token-item :deep(.el-form-item__content) {
  display: block;
  margin-left: 0 !important;
}

.ob-token-label {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.ob-token-label small {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
}

.ob-token-item :deep(.el-input__inner) {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

@media (max-width: 900px) {
  .ob-token-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .ob-token-item--wide {
    grid-column: auto;
  }
}

.poly-credential-hint {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.poly-credential-readonly-hint {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.poly-credential-readonly :deep(.el-input__wrapper) {
  background-color: var(--el-fill-color-light);
  box-shadow: 0 0 0 1px var(--el-border-color-lighter) inset;
  cursor: default;
}

.poly-credential-readonly :deep(.el-input__inner) {
  cursor: default;
  color: var(--el-text-color-regular);
}

.poly-funder-input {
  width: 100%;
}

.pf-privy-address-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.poly-funder-deposit-hint {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-5);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.55;
}

.poly-funder-deposit-hint strong {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}
</style>
