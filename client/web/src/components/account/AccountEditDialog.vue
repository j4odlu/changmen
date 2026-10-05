<script setup lang="ts">
import type { AccountRecord } from "@changmen/client-core/types/account";
import type { AccountEditFormState } from "@/components/account/accountEditFormState";
import { resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { ElLoading, ElMessage } from "element-plus";
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  createAccountEditFormStateFromPlatformAccount,
} from "@/components/account/accountEditFormState";
import {
  isSportObCollectCredential,
  normalizePolymarketApiCreds,
  normalizePolymarketTokenObject,
  parsePastedAccountCredential,
  parsePastedObject,
  parsePolymarketTokenObject,
} from "@/components/account/accountCredentialParse";
import {
  createGatewayProbeAccount,
  pickFastestGateway,
} from "@/components/account/accountGatewayProbe";
import AccountEditPanel from "@/components/account/AccountEditPanel.vue";
import { updateAdminAccountMultiply } from "@/api/admin";
import { normalizeAccountRateConfig, PlatformAccount } from "@/models/platformAccount";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";
import { getApiBase } from "@/config/apiBase";
import { createRequestAuthProvider, getRequestAuthHeaders } from "@/lib/authCredentials";
import { parseSportObSessionInput } from "@/runtime/obSportSessionLocal";
import {
  isCompleteObSportCredential,
  isObSportBetToken,
  isObSportMemberId,
} from "@/runtime/obSportBetAccount";
import { isObSportPcShellHost, resolveObSportHttpGateway } from "@/runtime/obSportTrial";
import {
  createOrDerivePolymarketApiCreds,
  type PolymarketApiCreds,
} from "@changmen/venue-adapter/polymarket";
import {
  fetchPolymarketRelayerStatus,
  preparePolymarketWallet,
} from "@changmen/venue-adapter/polymarket";
import {
  normalizePolymarketPrivateKey,
  resolvePolymarketDepositWalletFromPrivateKey,
  resolvePolymarketSignerAddress,
} from "@changmen/venue-adapter/polymarket";
import {
  buildPredictFunMemoryToken,
  buildPredictFunPersistToken,
  isValidPredictFunAddress,
  isValidPredictFunPrivateKey,
  normalizePredictFunPrivateKey,
  parsePredictFunTokenConfig,
  resolvePredictFunPredictAccount,
  resolvePredictFunPrivyAddressFromPrivateKey,
  resolvePredictFunPrivyPrivateKey,
} from "@changmen/venue-adapter/predictfun";
import {
  ensurePmVaultSetup,
  ensurePmVaultUnlocked,
  extractPrivateKeyFromToken,
  getCachedPrivateKey,
  hasVault,
  isPmVaultUnlocked,
  putPrivateKeyInVault,
  vaultHasKey,
} from "@/security/pmVault";
import { getAdapter } from "@/runtime/venueAdapters";
import type { AccountBalanceResult } from "@changmen/venue-adapter/contract";
import { parsePbVenueIdentity } from "@changmen/venue-adapter/pb";

function readStoredVenueMemberId(row: { venueMemberId?: string; venueId?: string } | null | undefined): string {
  const v = row?.venueMemberId ?? row?.venueId;
  return v != null ? String(v).trim() : "";
}

/**
 * [changmen 扩展] 已实现 venueMemberId 回写的场馆。
 * 其它场馆保持 A8：粘贴凭证即可保存，不强制余额/会员 ID。
 */
const VENUE_MEMBER_ID_PROVIDERS = new Set(["OB", "RAY", "PB", "Polymarket", "PredictFun"]);

function requiresVenueMemberId(provider: unknown): boolean {
  return VENUE_MEMBER_ID_PROVIDERS.has(String(provider ?? "").trim());
}

const props = defineProps<{
  open: boolean;
  account?: PlatformAccount;
  readonly?: boolean;
  /** 管理端：目标用户 id，配合 allowMultiplyEdit */
  adminTargetUserId?: string;
  allowMultiplyEdit?: boolean;
  previewForm?: AccountEditFormState;
  previewProxyOptions?: { label: string; value: number }[];
  zIndex?: number;
}>();

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
const sportObForm = reactive({
  token: "",
  gateway: "",
  referer: "",
  venueMemberId: "",
  venueAccountName: "",
});
/** A8：PB 默认锁定比例，legend「买」双击解锁 */
const rateLocked = ref(false);
/** Polymarket 专用：新账号按 wallet/funder/privateKey 派生 API 凭证 */
const polyWalletAddress = ref("");
const polyFunder = ref("");
const polyPrivateKey = ref("");
/** none=无钥；stored=本机有加密钥但未解锁；ready=本会话可用（已解锁/token 含钥） */
const polyLocalKeyStatus = ref<"none" | "stored" | "ready">("none");
/** 避免快速切换账号时 vaultHasKey 回调写错 hint */
let polyLocalKeyHintSeq = 0;
const polyLocalKeyReady = computed(() => polyLocalKeyStatus.value !== "none");
const polyPrivateKeyPlaceholder = computed(() => {
  if (polyLocalKeyStatus.value === "ready")
    return "私钥已就绪（不显示明文）；留空沿用，或粘贴新私钥覆盖";
  if (polyLocalKeyStatus.value === "stored")
    return "本机已存加密私钥（未解锁，自动下注不可用）；解锁后可用，或粘贴新钥覆盖";
  return "0x... 或不带前缀的 hex 私钥（必填，EOA 与 funder 将自动推导）";
});
const polyPrivateKeyHintText = computed(() => {
  if (polyLocalKeyStatus.value === "ready")
    return "私钥仅存本机加密仓，页面不回显；清除网站数据后需重新导入。";
  if (polyLocalKeyStatus.value === "stored")
    return "本机仓有该账号私钥，但当前未解锁——自动下注不可用。刷新后输入密码，或保存时会再次提示解锁。";
  return "";
});
const polyApiCreds = ref<PolymarketApiCreds>();
const polyApiCredsFingerprint = ref("");
const polyGenerating = ref(false);
const polyRelayerPreparing = ref(false);
const polyRelayerConfigured = ref<boolean | null>(null);
const polyAdvancedMode = ref(false);
const polyDerivingAddresses = ref(false);
/** 地址推导 / apiCreds 异步防串写 */
let polyAsyncOpSeq = 0;

/** PredictFun：官网 Privy 钥 + Predict Account（充值地址） */
const pfPrivyPrivateKey = ref("");
const pfPredictAccount = ref("");
/** 由 Privy 私钥推导的 EOA（充 BNB）；无私钥时为空 */
const pfPrivyAddress = ref("");
const pfLocalKeyStatus = ref<"none" | "stored" | "ready">("none");
let pfLocalKeyHintSeq = 0;
let pfPrivyAddressSeq = 0;
const pfLocalKeyReady = computed(() => pfLocalKeyStatus.value !== "none");
const pfPrivyKeyPlaceholder = computed(() => {
  if (pfLocalKeyStatus.value === "ready")
    return "Privy 私钥已就绪（不显示明文）；留空沿用，或粘贴新钥覆盖";
  if (pfLocalKeyStatus.value === "stored")
    return "本机已存加密 Privy 钥（未解锁）；解锁后可用，或粘贴新钥覆盖";
  return "从 predict.fun 设置页 Export 导出的 Privy 私钥";
});
const pfPrivyKeyHintText = computed(() => {
  if (pfLocalKeyStatus.value === "ready")
    return "Privy 私钥仅存本机加密仓，页面不回显。";
  if (pfLocalKeyStatus.value === "stored")
    return "本机仓有该账号 Privy 钥，但当前未解锁。";
  return "";
});

function setPfPrivyAddressFromKey(raw: string) {
  pfPrivyAddress.value = resolvePredictFunPrivyAddressFromPrivateKey(raw);
}

/** 从输入框 / 内存 token / 已解锁 vault 缓存推导 Privy EOA（不回显私钥、不弹解锁） */
function refreshPfPrivyAddressDisplay() {
  const seq = ++pfPrivyAddressSeq;
  const typed = pfPrivyPrivateKey.value.trim();
  if (typed) {
    setPfPrivyAddressFromKey(typed);
    return;
  }
  const fromForm = resolvePredictFunPrivyPrivateKey(parsePredictFunTokenConfig(form.token))
    || extractPrivateKeyFromToken(form.token);
  if (fromForm) {
    setPfPrivyAddressFromKey(fromForm);
    return;
  }
  const fromAccount = resolvePredictFunPrivyPrivateKey(parsePredictFunTokenConfig(props.account?.token))
    || extractPrivateKeyFromToken(props.account?.token);
  if (fromAccount) {
    setPfPrivyAddressFromKey(fromAccount);
    return;
  }
  const uid = String(userStore.userId || "");
  const aid = Number(props.account?.accountId) || 0;
  if (uid && aid && isPmVaultUnlocked(uid)) {
    const cached = getCachedPrivateKey(aid);
    if (cached) {
      setPfPrivyAddressFromKey(cached);
      return;
    }
  }
  if (seq !== pfPrivyAddressSeq)
    return;
  pfPrivyAddress.value = "";
}

async function copyPfPrivyAddress() {
  const addr = pfPrivyAddress.value.trim();
  if (!addr)
    return;
  try {
    await navigator.clipboard.writeText(addr);
    ElMessage.success("已复制 Privy 地址");
  }
  catch {
    ElMessage.error("复制失败");
  }
}

interface PlatformSuggestion { value: string; link: string }

let form = reactive<AccountEditFormState>(
  createAccountEditFormStateFromPlatformAccount(
    new PlatformAccount({ accountId: 0, playerName: "", provider: "Polymarket" }),
  ),
);

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
  polyAsyncOpSeq += 1;
  polyGenerating.value = false;
  polyDerivingAddresses.value = false;
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

function resetSportObForm(acc?: PlatformAccount) {
  sportObForm.token = "";
  sportObForm.gateway = "";
  sportObForm.referer = "";
  sportObForm.venueMemberId = "";
  sportObForm.venueAccountName = "";
  const nested = acc?.sportOb;
  if (nested?.token) {
    sportObForm.token = String(nested.token || "");
    sportObForm.gateway = String(nested.gateway || "");
    sportObForm.referer = String(nested.referer || "");
    sportObForm.venueMemberId = String(nested.venueMemberId || "");
    sportObForm.venueAccountName = String(nested.venueAccountName || "");
  }
  else if (acc && isObSportBetToken(String(acc.token || ""))) {
    sportObForm.token = String(acc.token || "");
    sportObForm.gateway = String(acc.gateway || "");
    sportObForm.referer = String(acc.referer || "");
    sportObForm.venueMemberId = String(acc.venueMemberId || "");
    sportObForm.venueAccountName = "";
  }
  if (isObSportBetToken(form.token))
    form.token = "";
}

function sportObFromForm(): AccountRecord["sportOb"] | undefined {
  const token = sportObForm.token.trim();
  if (!isObSportBetToken(token))
    return undefined;
  return {
    token,
    gateway: sportObForm.gateway.trim() || undefined,
    referer: sportObForm.referer.trim() || undefined,
    venueMemberId: sportObForm.venueMemberId.trim() || undefined,
    venueAccountName: sportObForm.venueAccountName.trim() || undefined,
  };
}

async function probeObSportCredentialForSave(
  sportOb: NonNullable<AccountRecord["sportOb"]>,
): Promise<{ amount: number; venueMemberId: string; venueAccountName: string }> {
  if (!sportOb.gateway)
    throw new Error("体育网关未识别完成，无法保存");
  if (!isObSportMemberId(sportOb.venueMemberId))
    throw new Error("体育账号 UID 无效，无法保存");
  if (!isCompleteObSportCredential(sportOb))
    throw new Error("体育凭证不完整，无法保存");
  const { fetchObSportAmountForAccount } = await import("@/runtime/obSportAmount");
  const {
    assertObSportAccountBinding,
    fetchObSportUserInfoForAccount,
  } = await import("@/runtime/obSportUserInfo");
  try {
    const account = { provider: "OB", sportOb } as const;
    const [amount, identity] = await Promise.all([
      fetchObSportAmountForAccount(account),
      fetchObSportUserInfoForAccount(account),
    ]);
    assertObSportAccountBinding({
      expectedVenueMemberId: sportOb.venueMemberId,
      esportVenueAccountName: props.account?.venueAccountName,
      hasEsportCredential: /^\d{8,}$/.test(String(props.account?.token || "").trim()),
      sport: identity,
    });
    return { amount, ...identity };
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err || "");
    throw new Error(`体育凭证校验失败：${msg || "请检查 Token、网关和 UID"}`);
  }
}

function syncPolymarketFieldsFromToken(token: string) {
  const parsed = parsePolymarketTokenObject(token) ?? {};
  polyWalletAddress.value = String(parsed.walletAddress ?? parsed.address ?? "");
  polyFunder.value = String(parsed.funder ?? parsed.funderAddress ?? "");
  // 方案 C：已有钥不回填到输入框，避免网页明文展示；沿用本机仓 / 留空粘贴新钥
  polyPrivateKey.value = "";
  const uid = String(userStore.userId || "");
  const aid = Number(props.account?.accountId) || 0;
  const unlocked = Boolean(uid && isPmVaultUnlocked(uid));
  const fromToken = Boolean(extractPrivateKeyFromToken(token));
  const fromVaultMem = Boolean(unlocked && aid && getCachedPrivateKey(aid));
  // ready=本会话可下注；stored=本机有密文但未解锁（勿写成「已就绪」）
  if (fromToken || fromVaultMem)
    polyLocalKeyStatus.value = "ready";
  else
    polyLocalKeyStatus.value = "none";
  if (aid && uid) {
    const seq = ++polyLocalKeyHintSeq;
    const aidSnap = aid;
    void vaultHasKey(uid, aid).then((has) => {
      if (seq !== polyLocalKeyHintSeq)
        return;
      if (Number(props.account?.accountId) !== aidSnap)
        return;
      if (fromToken || fromVaultMem || (has && isPmVaultUnlocked(uid)))
        polyLocalKeyStatus.value = "ready";
      else if (has)
        polyLocalKeyStatus.value = "stored";
      else
        polyLocalKeyStatus.value = "none";
    });
  }
  else {
    polyLocalKeyHintSeq += 1;
  }
  polyApiCreds.value = normalizePolymarketApiCreds(parsed);
  polyApiCredsFingerprint.value = polyApiCreds.value ? polymarketCredentialFingerprint() : "";
  const sig = String(parsed.signatureType ?? "3");
  polyAdvancedMode.value = sig !== "3" && sig !== "";
}

function syncPredictFunFieldsFromToken(token: string) {
  const cfg = parsePredictFunTokenConfig(token);
  pfPredictAccount.value = resolvePredictFunPredictAccount(cfg);
  const addr = pfPredictAccount.value.trim();
  if (isValidPredictFunAddress(addr)) {
    form.venueMemberId = addr;
    form.venueAccountName = addr;
    if (!form.playerName.trim() || form.playerName.trim() === "River")
      form.playerName = addr;
  }
  // 不回显 Privy 钥
  pfPrivyPrivateKey.value = "";
  const uid = String(userStore.userId || "");
  const aid = Number(props.account?.accountId) || 0;
  const unlocked = Boolean(uid && isPmVaultUnlocked(uid));
  const fromToken = Boolean(resolvePredictFunPrivyPrivateKey(cfg) || extractPrivateKeyFromToken(token));
  const fromVaultMem = Boolean(unlocked && aid && getCachedPrivateKey(aid));
  if (fromToken || fromVaultMem)
    pfLocalKeyStatus.value = "ready";
  else if (uid && aid) {
    const seq = ++pfLocalKeyHintSeq;
    void vaultHasKey(uid, aid).then((has) => {
      if (seq !== pfLocalKeyHintSeq)
        return;
      if (fromToken || fromVaultMem || (has && isPmVaultUnlocked(uid)))
        pfLocalKeyStatus.value = "ready";
      else if (has)
        pfLocalKeyStatus.value = "stored";
      else
        pfLocalKeyStatus.value = "none";
    });
  }
  else {
    pfLocalKeyHintSeq += 1;
    pfLocalKeyStatus.value = "none";
  }
  refreshPfPrivyAddressDisplay();
}

async function resolvePolymarketPrivateKeyForSave(): Promise<string> {
  const typed = polyPrivateKey.value.trim();
  if (typed)
    return typed;
  // 粘贴凭证 / 本会话 token 仍可能带 privateKey（输入框故意不回显）
  const fromForm = extractPrivateKeyFromToken(form.token);
  if (fromForm)
    return fromForm;
  const fromAccount = extractPrivateKeyFromToken(props.account?.token);
  if (fromAccount)
    return fromAccount;
  const uid = String(userStore.userId || "");
  const aid = Number(props.account?.accountId) || 0;
  if (!uid || !aid)
    throw new Error("Polymarket 私钥必填");
  if (!isPmVaultUnlocked(uid)) {
    if (!(await vaultHasKey(uid, aid)))
      throw new Error("Polymarket 私钥必填");
    const unlocked = await ensurePmVaultUnlocked(uid);
    if (!unlocked)
      throw new Error("请先解锁本机钱包");
  }
  const cached = getCachedPrivateKey(aid);
  if (!cached)
    throw new Error("本机钱包无该账号私钥，请重新导入");
  // 不写回输入框，避免明文出现在 DOM
  return cached;
}

async function ensurePrivateKeyInVault(
  accountId: number,
  privateKey: string,
  addressHint = "",
): Promise<void> {
  const uid = String(userStore.userId || "");
  if (!uid || uid === "0")
    throw new Error("未登录，无法保存本机私钥");
  if (!(await hasVault(uid))) {
    const ok = await ensurePmVaultSetup(uid);
    if (!ok)
      throw new Error("已取消设置本机钱包密码");
  }
  else if (!isPmVaultUnlocked(uid)) {
    const ok = await ensurePmVaultUnlocked(uid);
    if (!ok)
      throw new Error("请先解锁本机钱包");
  }
  await putPrivateKeyInVault(uid, accountId, privateKey, addressHint || polyWalletAddress.value);
}

/** 新建 PM 账号：在 CreateTagPlatform 之前先设密/解锁，避免账号已建但仓未就绪 */
async function ensurePmVaultReadyBeforeCreate(): Promise<void> {
  const uid = String(userStore.userId || "");
  if (!uid || uid === "0")
    throw new Error("未登录，无法保存本机私钥");
  if (!(await hasVault(uid))) {
    const ok = await ensurePmVaultSetup(uid);
    if (!ok)
      throw new Error("已取消设置本机钱包密码");
    return;
  }
  if (!isPmVaultUnlocked(uid)) {
    const ok = await ensurePmVaultUnlocked(uid);
    if (!ok)
      throw new Error("请先解锁本机钱包");
  }
}

function syncPolymarketWalletAddressFromPrivateKey() {
  const raw = polyPrivateKey.value.trim();
  if (!raw)
    return;
  try {
    const privateKey = normalizePolymarketPrivateKey(raw);
    void resolvePolymarketSignerAddress(privateKey).then((address) => {
      if (polyPrivateKey.value.trim() !== raw)
        return;
      // 私钥变了：作废 funder / apiCreds，下次保存再推导；勿在每次按键时打链
      if (polyWalletAddress.value && polyWalletAddress.value.toLowerCase() !== address.toLowerCase()) {
        polyFunder.value = "";
        polyApiCreds.value = undefined;
        polyApiCredsFingerprint.value = "";
      }
      polyWalletAddress.value = address;
    }).catch(() => {
      // 粘贴/输入时的自动推导只是 UI 便捷能力；失败必须留给保存/手动推导按钮提示，不能冒到全局触发刷新。
    });
  }
  catch {
    /* invalid key while typing */
  }
}

async function syncPolymarketDerivedAddresses(
  forceFunder = false,
  privateKeyOverride?: string,
  op = ++polyAsyncOpSeq,
) {
  const raw = (privateKeyOverride ?? polyPrivateKey.value).trim();
  if (!raw)
    throw new Error("Polymarket 私钥必填");
  polyDerivingAddresses.value = true;
  try {
    const privateKey = normalizePolymarketPrivateKey(raw);
    const signer = await resolvePolymarketSignerAddress(privateKey);
    if (op !== polyAsyncOpSeq)
      return;
    const prevWallet = polyWalletAddress.value.trim().toLowerCase();
    const walletChanged = Boolean(prevWallet) && prevWallet !== signer.toLowerCase();
    if (walletChanged) {
      polyFunder.value = "";
      polyApiCreds.value = undefined;
      polyApiCredsFingerprint.value = "";
    }
    polyWalletAddress.value = signer;
    // 输入框有钥 = 用户正在换钥；watch 可能已改 EOA 但尚未清空旧 funder，必须重推
    const typingNewKey = Boolean(polyPrivateKey.value.trim()) && !polyAdvancedMode.value;
    // 仅「强制」/「尚无 funder」/换钥时打链。暂停等沿用已有 funder 不走 RPC。
    // [官方] deriveDepositWalletAddress 用于预测 Deposit Wallet 地址，不是账号 pause 语义。
    if (forceFunder || !polyFunder.value.trim() || walletChanged || typingNewKey) {
      const resolved = await resolvePolymarketDepositWalletFromPrivateKey({ privateKey });
      if (op !== polyAsyncOpSeq)
        return;
      polyWalletAddress.value = resolved.walletAddress;
      polyFunder.value = resolved.funder;
    }
  }
  finally {
    if (op === polyAsyncOpSeq)
      polyDerivingAddresses.value = false;
  }
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
      polyAsyncOpSeq += 1;
      polyGenerating.value = false;
      polyDerivingAddresses.value = false;
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

async function pasteFromClipboard() {
  try {
    pasteRaw.value = await navigator.clipboard.readText();
    await applyPaste();
  }
  catch {
    ElMessage.error("无法访问剪贴板，请检查浏览器权限或手动粘贴！");
  }
}

function onPasteQuickFill(ev: ClipboardEvent) {
  const text = ev.clipboardData?.getData("text") || "";
  if (!text.trim())
    return;
  ev.preventDefault();
  pasteRaw.value = text;
  void applyPaste();
}

async function applyPaste() {
  if (!pasteRaw.value.trim())
    return;
  let loading: ReturnType<typeof ElLoading.service> | undefined;
  try {
    const raw = pasteRaw.value.trim();
    const sportSession = parseSportObSessionInput(raw);
    if (sportSession.ok) {
      if (props.account?.accountId && props.account.provider !== "OB") {
        ElMessage.error("这是体育 OB token，请添加到 OB 下注账号");
        return;
      }
      form.provider = "OB";
      obTokenTab.value = "sport";
      sportObForm.token = sportSession.session.token || "";
      const pastedGw = String(sportSession.session.gateway || "").trim();
      const pastedRef = String(sportSession.session.referer || "").trim();
      sportObForm.gateway = resolveObSportHttpGateway(pastedGw, pastedRef)
        || (isObSportPcShellHost(pastedGw) ? "" : pastedGw);
      sportObForm.referer = pastedRef;
      sportObForm.venueMemberId = String(
        sportSession.session.sessionId || sportSession.session.uid || "",
      ).trim();
      sportObForm.venueAccountName = "";
      pasteRaw.value = "";
      ElMessage.success("已识别为体育凭证，并切换到体育页签");
      return;
    }
    const pastedObj = parsePastedObject(raw);
    if (isSportObCollectCredential(pastedObj)) {
      ElMessage.error("已识别为体育凭证，但数据不完整，请检查 Token、网关和会员 UID");
      return;
    }
    const parsed = parsePastedAccountCredential(raw);
    if (!parsed) {
      if (form.provider === "Stake") {
        form.token = raw;
        pasteRaw.value = "";
        ElMessage.success("已填入 Stake token");
        return;
      }
      ElMessage.error("解析失败");
      return;
    }
    if (!parsed?.provider) {
      ElMessage({ message: "未选择场馆", type: "error", plain: true });
      return;
    }
    const gateways = Array.isArray(parsed.gateway)
      ? parsed.gateway
      : parsed.gateway
        ? [parsed.gateway]
        : [];
    form.provider = parsed.provider;
    if (parsed.provider === "OB")
      obTokenTab.value = "esport";
    form.token = parsed.token ?? "";
    form.referer = parsed.referer ?? "";
    if (gateways.length)
      form.gateway = gateways[0]!;
    else if (parsed.provider === "Stake" && !form.gateway.trim())
      form.gateway = "https://stake.com";
    syncPolymarketFieldsFromToken(form.token);
    if (parsed.provider === "PB")
      applyPbIdentityFromToken(form.token);

    if (gateways.length <= 1) {
      ElMessage.success(parsed.provider === "OB"
        ? "已识别为电竞凭证，并切换到电竞页签"
        : "粘贴成功");
      return;
    }

    loading = ElLoading.service({ fullscreen: true, text: "正在检测最快网关" });
    const gate = await pickFastestGateway(
      gateway => createGatewayProbeAccount({
        provider: parsed.provider!,
        gateway,
        token: parsed.token ?? "",
        referer: parsed.referer ?? "",
        proxyId: form.proxyId === 0 ? undefined : form.proxyId,
      }),
      gateways,
      ({ gate, time, success }) => {
        ElMessage({
          message: `${gate}，耗时：${time}ms`,
          type: success ? "success" : "error",
          duration: 3000,
        });
      },
    );
    if (!gate) {
      ElMessage.error("当前网关测试失败");
      form.gateway = "";
    }
    else {
      form.gateway = gate;
    }
    ElMessage.success("粘贴成功");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "解析失败");
  }
  finally {
    loading?.close();
    pasteRaw.value = "";
  }
}

function normalizeRateConfig() {
  return normalizeAccountRateConfig(form.rateConfig);
}

function polymarketCredentialFingerprint(): string {
  // 不含私钥：同地址即同钥；输入框常空（本机仓），把 pk 算进指纹会导致每次保存误重生 apiCreds
  return [
    form.gateway.trim(),
    polyWalletAddress.value.trim().toLowerCase(),
    polyFunder.value.trim().toLowerCase(),
  ].join("|");
}

function buildPolyToken(privateKeyOverride?: string): string {
  const pk = (privateKeyOverride ?? polyPrivateKey.value).trim();
  const token: Record<string, unknown> = {
    walletAddress: polyWalletAddress.value.trim(),
    funder: polyFunder.value.trim(),
    signatureType: "3",
  };
  if (pk)
    token.privateKey = pk;
  if (polyApiCreds.value) {
    token.apiCreds = {
      apiKey: polyApiCreds.value.apiKey,
      secret: polyApiCreds.value.secret,
      passphrase: polyApiCreds.value.passphrase,
    };
  }
  normalizePolymarketTokenObject(token);
  return JSON.stringify(token);
}

async function ensurePolymarketToken(): Promise<string> {
  const op = ++polyAsyncOpSeq;
  const privateKey = await resolvePolymarketPrivateKeyForSave();
  if (op !== polyAsyncOpSeq)
    throw new Error("操作已取消，请重试保存");
  // 用参数传钥，不写回输入框（避免 DOM 明文）
  await syncPolymarketDerivedAddresses(false, privateKey, op);
  if (op !== polyAsyncOpSeq)
    throw new Error("操作已取消，请重试保存");
  if (!polyApiCreds.value || polyApiCredsFingerprint.value !== polymarketCredentialFingerprint())
    await generatePolymarketApiCreds(true, privateKey, op);
  if (op !== polyAsyncOpSeq)
    throw new Error("操作已取消，请重试保存");
  const token = buildPolyToken(privateKey);
  form.token = token;
  return token;
}

async function generatePolymarketApiCreds(
  silent = false,
  privateKeyOverride?: string,
  op = ++polyAsyncOpSeq,
) {
  polyGenerating.value = true;
  try {
    const privateKey = privateKeyOverride ?? await resolvePolymarketPrivateKeyForSave();
    if (op !== polyAsyncOpSeq)
      return;
    await syncPolymarketDerivedAddresses(false, privateKey, op);
    if (op !== polyAsyncOpSeq)
      return;
    const result = await createOrDerivePolymarketApiCreds({
      gateway: form.gateway,
      walletAddress: polyWalletAddress.value,
      funder: polyFunder.value,
      privateKey,
    });
    if (op !== polyAsyncOpSeq)
      return;
    polyWalletAddress.value ||= result.signerAddress;
    polyApiCreds.value = result.apiCreds;
    form.gateway ||= "https://clob.polymarket.com";
    polyApiCredsFingerprint.value = polymarketCredentialFingerprint();
    form.token = buildPolyToken(privateKey);
    if (!silent)
      ElMessage.success("Polymarket API 凭证已生成/派生");
  }
  finally {
    if (op === polyAsyncOpSeq)
      polyGenerating.value = false;
  }
}

async function onGeneratePolymarketApiCreds() {
  try {
    await generatePolymarketApiCreds(false);
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Polymarket API 凭证生成失败");
  }
}

function polymarketRelayerSignUrl(): string {
  const base = getApiBase();
  const origin = base || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin.replace(/\/+$/, "")}/api/polymarket/relayer/sign`;
}

async function refreshPolymarketRelayerStatus() {
  try {
    const headers = await getRequestAuthHeaders(`${getApiBase()}/api/polymarket/relayer/status`);
    const status = await fetchPolymarketRelayerStatus(getApiBase(), "", headers);
    polyRelayerConfigured.value = status.configured;
  }
  catch {
    polyRelayerConfigured.value = false;
  }
}

function resolvePolymarketRelayerSignatureType(): string {
  if (!polyAdvancedMode.value)
    return "3";
  const parsed = parsePolymarketTokenObject(form.token);
  const sig = String(parsed?.signatureType ?? "3").trim();
  return sig || "3";
}

async function onPreparePolymarketWallet() {
  polyRelayerPreparing.value = true;
  try {
    const signUrl = polymarketRelayerSignUrl();
    const getAuthHeaders = createRequestAuthProvider(signUrl);
    const privateKey = await resolvePolymarketPrivateKeyForSave();
    await getAuthHeaders();
    await refreshPolymarketRelayerStatus();
    if (polyRelayerConfigured.value === false)
      throw new Error("服务端未配置 Polymarket Relayer（POLY_BUILDER_*）");
    await syncPolymarketDerivedAddresses(!polyAdvancedMode.value, privateKey);
    const result = await preparePolymarketWallet({
      privateKey,
      signatureType: resolvePolymarketRelayerSignatureType(),
      signUrl,
      getAuthHeaders,
      ...(polyApiCreds.value?.apiKey && polyApiCreds.value.secret && polyApiCreds.value.passphrase
        ? {
            credentials: {
              key: polyApiCreds.value.apiKey,
              secret: polyApiCreds.value.secret,
              passphrase: polyApiCreds.value.passphrase,
            },
          }
        : {}),
    });
    if (!result.ok)
      throw new Error(result.message);
    if (result.funder)
      polyFunder.value = result.funder;
    ElMessage.success(result.transactionHash
      ? `${result.message} tx=${result.transactionHash.slice(0, 10)}…`
      : result.message);
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Polymarket 钱包初始化失败");
  }
  finally {
    polyRelayerPreparing.value = false;
  }
}

async function onDerivePolymarketAddresses() {
  try {
    const privateKey = await resolvePolymarketPrivateKeyForSave();
    await syncPolymarketDerivedAddresses(true, privateKey);
    ElMessage.success("已从私钥推导 EOA 与 Deposit Wallet（funder）");
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "地址推导失败");
  }
}

async function resolvePredictFunPrivyKeyForSave(): Promise<string> {
  const typed = pfPrivyPrivateKey.value.trim();
  if (typed) {
    const normalized = normalizePredictFunPrivateKey(typed);
    if (!isValidPredictFunPrivateKey(normalized))
      throw new Error("Privy 私钥格式无效（须为 0x + 64 hex）");
    return normalized;
  }
  const fromForm = resolvePredictFunPrivyPrivateKey(parsePredictFunTokenConfig(form.token))
    || extractPrivateKeyFromToken(form.token);
  if (fromForm)
    return normalizePredictFunPrivateKey(fromForm);
  const fromAccount = resolvePredictFunPrivyPrivateKey(parsePredictFunTokenConfig(props.account?.token))
    || extractPrivateKeyFromToken(props.account?.token);
  if (fromAccount)
    return normalizePredictFunPrivateKey(fromAccount);
  const uid = String(userStore.userId || "");
  const aid = Number(props.account?.accountId) || 0;
  if (!uid || !aid)
    throw new Error("Privy 私钥必填（设置页 Export 导出）");
  if (!isPmVaultUnlocked(uid)) {
    if (!(await vaultHasKey(uid, aid)))
      throw new Error("Privy 私钥必填（设置页 Export 导出）");
    const unlocked = await ensurePmVaultUnlocked(uid);
    if (!unlocked)
      throw new Error("请先解锁本机钱包");
  }
  const cached = getCachedPrivateKey(aid);
  if (!cached)
    throw new Error("本机钱包无该账号 Privy 钥，请重新导入");
  return normalizePredictFunPrivateKey(cached);
}

async function ensurePredictFunToken(): Promise<string> {
  const predictAccount = pfPredictAccount.value.trim();
  if (!isValidPredictFunAddress(predictAccount))
    throw new Error("Predict 智能钱包地址必填（充值页复制，勿用智能路由地址）");
  const privyPrivateKey = await resolvePredictFunPrivyKeyForSave();
  // 上报仅 predictAccount；内存钥在 save 路径写入 vault + 会话 token
  form.token = buildPredictFunMemoryToken({ predictAccount, privyPrivateKey });
  form.venueMemberId = predictAccount;
  form.venueAccountName = predictAccount;
  return buildPredictFunPersistToken(predictAccount);
}

async function buildPatch(): Promise<Partial<AccountRecord> & {
  platformName: string;
  playerName: string;
  provider: AccountRecord["provider"];
}> {
  const token = form.provider === "Polymarket"
    ? await ensurePolymarketToken()
    : form.provider === "PredictFun"
      ? await ensurePredictFunToken()
      : form.token.trim() || undefined;
  return {
    platformName: form.platformName.trim(),
    playerName: form.playerName.trim(),
    provider: form.provider,
    proxyId: form.proxyId === 0 ? undefined : form.proxyId,
    gateway: form.gateway.trim() || undefined,
    token: token || undefined,
    referer: form.referer.trim() || undefined,
    userAgent: form.userAgent.trim() || undefined,
    // PredictFun 无 A8 授信；其它场馆仍按表单（充提记账用的本金基准）
    credit: form.provider === "PredictFun" ? 0 : (Number(form.credit) || 0),
    maxBalance: Number(form.maxBalance) || 0,
    maxBalanceOdds: Number(form.maxBalanceOdds) || 2,
    maxProfit: Number(form.maxProfit) || 0,
    maxWinBalance: Number(form.maxWinBalance) || 0,
    minOdds: Number(form.minOdds) || 0,
    maxOdds: Number(form.maxOdds) || 0,
    minDefault: Number(form.minDefault) || 0,
    maxDefault: Number(form.maxDefault) || 0,
    maxOrder: Number(form.maxOrder) || 0,
    profit: Number(form.profit) || 0,
    maxBetCount: Number(form.maxBetCount) || 0,
    multiply: resolveAccountMultiply(form.provider, form.multiply),
    pause: form.pause,
    markupOnly: form.markupOnly,
    noMarkup: form.noMarkup,
    lastOdds: form.lastOdds,
    realName: form.realName.trim() || undefined,
    mobile: form.mobile.trim() || undefined,
    city: form.city.trim() || undefined,
    description: form.description.trim(),
    workTimes: [...form.workTimes],
    rateConfig: normalizeRateConfig(),
    game: JSON.parse(JSON.stringify(form.game)),
  };
}

/** [changmen 扩展] 选填 playerName → 场馆账号名 / 账号ID / 编辑原值 */
function resolvePlayerNameForSave(
  patch: Partial<AccountRecord> & { playerName: string },
): string {
  const filled = String(patch.playerName || "").trim();
  if (filled)
    return filled;
  const venueName = String(patch.venueAccountName || form.venueAccountName || "").trim();
  if (venueName)
    return venueName;
  const venueId = String(patch.venueMemberId || form.venueMemberId || "").trim();
  if (venueId)
    return venueId;
  return String(props.account?.playerName || "").trim();
}

/**
 * [changmen 扩展] 仅对已接线场馆：保存前拉余额并绑定 venueMemberId。
 * - 新账号（无 accountId）：写入 venueMemberId；同场馆已占用 → 拒绝（不能新增重复）
 * - 老账号（有 accountId）：只更新；已绑定 venueMemberId 且与当前凭证不一致 → 拒绝
 * A8 AccountInfoView 无此门控；未接线场馆走 save() 内 A8 路径。
 */
async function probeVenueIdentityForSave(
  patch: Awaited<ReturnType<typeof buildPatch>>,
): Promise<AccountBalanceResult> {
  // PredictFun：patch.token 是落库 DTO（仅 predictAccount）；探测须用 form.token（含 Privy）
  const probeToken = form.provider === "PredictFun" && String(form.token || "").trim()
    ? form.token.trim()
    : patch.token;
  const probe = new PlatformAccount({
    accountId: props.account?.accountId || 0,
    playerName: patch.playerName || form.playerName || "probe",
    provider: patch.provider,
    platformName: patch.platformName,
    gateway: patch.gateway,
    token: probeToken,
    referer: patch.referer,
    userAgent: patch.userAgent,
    proxyId: patch.proxyId,
  });
  const provider = getAdapter(probe.provider)?.provider;
  if (!provider?.getBalance)
    throw new Error(`${probe.provider} 不支持余额查询，无法保存`);
  let result: AccountBalanceResult | undefined;
  try {
    result = await provider.getBalance(probe);
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg || "获取余额失败，请检查 Privy 私钥 / Predict 智能钱包后重试");
  }
  if (!result)
    throw new Error(
      form.provider === "PredictFun"
        ? "获取余额失败，请检查 Privy 私钥 / Predict 智能钱包后重试"
        : "获取余额失败，请检查网关/Token 后重试",
    );
  const venueMemberId = String(result.venueMemberId || "").trim();
  const venueAccountName = String(result.venueAccountName || "").trim() || venueMemberId;
  if (!venueMemberId)
    throw new Error("未获取到场馆账号 ID，无法保存");

  const selfId = Number(props.account?.accountId) || 0;
  const isEdit = Boolean(selfId);

  if (isEdit) {
    // 老账号：以当前卡片已加载的绑定为准（loadAccounts ← GetData ACCOUNT ← players）
    const stored = props.account
      ?? accountStore.accounts.find(a => Number(a.accountId) === selfId);
    const boundVenueMemberId = readStoredVenueMemberId(stored);
    if (boundVenueMemberId && boundVenueMemberId !== venueMemberId) {
      throw new Error(
        `场馆账号 ID 不一致：已绑定 ${boundVenueMemberId}，当前凭证为 ${venueMemberId}，拒绝保存`,
      );
    }
    form.venueMemberId = boundVenueMemberId || venueMemberId;
  }
  else {
    // 新账号：同 provider + venueMemberId 已存在 → 只能去编辑老卡，不能再新增
    const dup = accountStore.accounts.find((a) => {
      if (!a.accountId)
        return false;
      if (String(a.provider) !== String(probe.provider))
        return false;
      return readStoredVenueMemberId(a) === venueMemberId;
    });
    if (dup) {
      const label = [dup.platformName, dup.playerName || dup.venueAccountName]
        .filter(Boolean)
        .join(" / ") || `#${dup.accountId}`;
      throw new Error(
        `场馆账号 ID ${venueMemberId} 已绑定到「${label}」，不能重复保存`,
      );
    }
    form.venueMemberId = venueMemberId;
  }

  form.venueAccountName = venueAccountName;
  if (!form.playerName.trim())
    form.playerName = venueAccountName;

  return {
    ...result,
    venueMemberId: form.venueMemberId || venueMemberId,
    venueAccountName,
  };
}

async function save() {
  if (props.readonly)
    return;
  if (!form.platformName.trim()) {
    ElMessage.error("平台名必填");
    return;
  }
  const invalidRate = form.rateConfig.some(r => Number.isNaN(Number(r.rate)));
  if (invalidRate) {
    ElMessage.error("买入比例不能为空，请填写有效数字");
    return;
  }
  saving.value = true;
  let loading: ReturnType<typeof ElLoading.service> | undefined;
  try {
    const patch = await buildPatch();
    if (isObSportBetToken(String(patch.token || ""))) {
      if (!sportObForm.token.trim()) {
        sportObForm.token = String(patch.token || "");
        if (!sportObForm.gateway.trim())
          sportObForm.gateway = String(patch.gateway || "");
        if (!sportObForm.referer.trim())
          sportObForm.referer = String(patch.referer || "");
        if (!sportObForm.venueMemberId.trim())
          sportObForm.venueMemberId = String(form.venueMemberId || "").trim();
      }
      const kept = String(props.account?.token || "").trim();
      patch.token = kept && !isObSportBetToken(kept) ? kept : undefined;
    }
    const sportOb = sportObFromForm();
    const bindVenueMember = requiresVenueMemberId(patch.provider);
    // 按当前凭证页签决定保存线路，不再依赖外层体育/电竞页面。
    // 体育凭证与电竞凭证相互独立，不能拿另一条线路的 token 做保存前校验。
    const savingSportOb = patch.provider === "OB"
      && obTokenTab.value === "sport"
      && Boolean(sportOb?.token);

    let venue: AccountBalanceResult | undefined;
    let sportAmount: number | undefined;
    if (bindVenueMember && savingSportOb) {
      loading = ElLoading.service({ fullscreen: true, text: "校验体育余额与凭证..." });
      const sportIdentity = await probeObSportCredentialForSave(sportOb!);
      sportAmount = sportIdentity.amount;
      sportOb!.venueMemberId = sportIdentity.venueMemberId;
      sportOb!.venueAccountName = sportIdentity.venueAccountName;
      sportObForm.venueMemberId = sportIdentity.venueMemberId;
      sportObForm.venueAccountName = sportIdentity.venueAccountName;
      patch.venueMemberId = sportIdentity.venueMemberId;
      // 电竞卡保留电竞身份；体育专用新卡则用体育官网身份作为外层展示/归属键。
      patch.venueAccountName = String(props.account?.venueAccountName || "").trim()
        || sportIdentity.venueAccountName;
      loading.close();
      loading = undefined;
    }
    else if (bindVenueMember) {
      loading = ElLoading.service({ fullscreen: true, text: "校验余额与场馆账号..." });
      venue = await probeVenueIdentityForSave(patch);
      patch.venueAccountName = venue.venueAccountName;
      if (venue.venueMemberId)
        patch.venueMemberId = venue.venueMemberId;
      loading.close();
      loading = undefined;
    }

    // [changmen 扩展] playerName 选填：空则回退场馆账号名 / 账号ID / 编辑原值
    // CreateTagPlatform 仍需要非空 playerName（内部兼容字段，非用户必填项）
    patch.playerName = resolvePlayerNameForSave(patch);
    if (!patch.playerName) {
      ElMessage.error("无法确定账号标识：请填写账号，或使用支持自动识别的场馆");
      return;
    }

    loading = ElLoading.service({ fullscreen: true, text: "保存中..." });

    // 编辑已有账号：必须保留原 accountId。
    // [A8 可证实] AccountInfoView.w 每次都 CreateTagPlatform，靠官方服务端按
    // platform+playerName 幂等返回同一 playerId；Io.createAccount 再 find→update。
    // changmen 若复用失败会 insert 新 player → createAccount push → 列表多出一张卡。
    // 因此编辑走原地 patch + SaveData；仅新建走 CreateTagPlatform。
    if (props.account?.accountId) {
      const acc = props.account;
      // 编辑不可换场馆（UI 已锁定；此处再强制，防止表单被串改）
      patch.provider = acc.provider;
      const existingId = readStoredVenueMemberId(acc);
      const nextMemberId = bindVenueMember
        ? (existingId || venue?.venueMemberId)
        : (existingId || undefined);
      acc.applyPatch({
        ...patch,
        platformName: patch.platformName,
        playerName: patch.playerName,
        ...(bindVenueMember
          ? {
              venueMemberId: nextMemberId,
              venueAccountName: patch.venueAccountName,
            }
          : {}),
        ...(venue
          ? {
              balance: venue.balance,
              currency: venue.currency,
            }
          : {}),
        updateTime: Date.now(),
      });
      if (savingSportOb)
        acc.sportOb = sportOb;
      if (savingSportOb && sportAmount !== undefined) {
        acc.sportBalance = sportAmount;
        acc.sportBalanceStale = false;
        acc.sportBalanceError = "";
      }
      if (form.provider === "Polymarket") {
        const pk = await resolvePolymarketPrivateKeyForSave();
        await ensurePrivateKeyInVault(Number(acc.accountId), pk);
        // 内存保留私钥供自动下注；persistAccounts 会 strip；输入框不回填明文
        acc.token = buildPolyToken(pk);
        polyPrivateKey.value = "";
        polyLocalKeyStatus.value = "ready";
      }
      if (form.provider === "PredictFun") {
        const pk = await resolvePredictFunPrivyKeyForSave();
        const predictAccount = pfPredictAccount.value.trim();
        await ensurePrivateKeyInVault(Number(acc.accountId), pk, predictAccount);
        acc.token = buildPredictFunMemoryToken({ predictAccount, privyPrivateKey: pk });
        pfPrivyPrivateKey.value = "";
        pfLocalKeyStatus.value = "ready";
        refreshPfPrivyAddressDisplay();
      }
      await accountStore.saveAccounts();
      if (savingSportOb && acc.accountId && sportOb)
        await accountStore.saveSportAccount(acc.accountId, sportOb);
      ElMessage.success("账号设置已保存");
      emit("close");
      void (async () => {
        try {
          // [A8 可证实] 保存后刷新场馆订单；余额：已接线场馆在保存时已探测，其它走 refresh
          if (!venue)
            await accountStore.refreshBalance(acc);
          await accountStore.updateVenueOrders(acc);
        }
        catch (err) {
          console.error("[account] refresh after edit save", err);
          ElMessage.error(err instanceof Error ? err.message : "账号刷新失败");
        }
      })();
      return;
    }

    // [A8 可证实] 新建：createTagPlatform({ loading }) → 关弹窗 → createAccount
    // 关弹窗前先固定私钥：close 会清 editDialogAccount，不能再靠 props/输入框二次 resolve
    let pmCreatePrivateKey = "";
    let pfCreatePrivyKey = "";
    if (form.provider === "Polymarket") {
      await ensurePmVaultReadyBeforeCreate();
      pmCreatePrivateKey = polyPrivateKey.value.trim()
        || extractPrivateKeyFromToken(String(patch.token || ""))
        || await resolvePolymarketPrivateKeyForSave();
      if (!pmCreatePrivateKey)
        throw new Error("Polymarket 私钥必填");
      patch.token = buildPolyToken(pmCreatePrivateKey);
    }
    if (form.provider === "PredictFun") {
      await ensurePmVaultReadyBeforeCreate();
      pfCreatePrivyKey = await resolvePredictFunPrivyKeyForSave();
      const predictAccount = pfPredictAccount.value.trim();
      patch.token = buildPredictFunPersistToken(predictAccount);
      if (!patch.playerName.trim())
        patch.playerName = predictAccount;
    }
    if (bindVenueMember && venue?.venueMemberId)
      patch.venueMemberId = venue.venueMemberId;
    const created = bindVenueMember && patch.venueMemberId
      ? await accountStore.createTagPlatform(patch.platformName, {
          playerName: patch.playerName,
          venueMemberId: patch.venueMemberId,
          provider: patch.provider,
        })
      : await accountStore.createTagPlatform(patch.platformName, patch.playerName);
    if (form.provider === "Polymarket" && created.playerId && pmCreatePrivateKey) {
      await ensurePrivateKeyInVault(Number(created.playerId), pmCreatePrivateKey);
      patch.token = buildPolyToken(pmCreatePrivateKey);
      polyPrivateKey.value = "";
      polyLocalKeyStatus.value = "ready";
    }
    if (form.provider === "PredictFun" && created.playerId && pfCreatePrivyKey) {
      const predictAccount = pfPredictAccount.value.trim();
      await ensurePrivateKeyInVault(Number(created.playerId), pfCreatePrivyKey, predictAccount);
      patch.token = buildPredictFunMemoryToken({
        predictAccount,
        privyPrivateKey: pfCreatePrivyKey,
      });
      pfPrivyPrivateKey.value = "";
      pfLocalKeyStatus.value = "ready";
      refreshPfPrivyAddressDisplay();
    }
    ElMessage.success("账号设置已保存");
    emit("close");
    const record: AccountRecord = {
      ...patch,
      accountId: created.playerId,
      playerName: created.playerName,
      platformId: created.platformId,
      platformName: patch.platformName || created.platformName,
      ...(bindVenueMember
        ? {
            venueMemberId: patch.venueMemberId,
            venueAccountName: patch.venueAccountName,
          }
        : {}),
      ...(savingSportOb && sportOb
        ? { sportOb }
        : {}),
      pause: patch.pause ?? false,
      balance: venue?.balance,
      currency: venue?.currency,
      updateTime: Date.now(),
    };
    void accountStore.createAccount(record).catch((err: unknown) => {
      console.error("[account] createAccount after save", err);
      ElMessage.error(err instanceof Error ? err.message : "账号刷新失败");
    });
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
  finally {
    loading?.close();
    saving.value = false;
  }
}

async function saveMultiplyAdmin() {
  if (!props.adminTargetUserId || !props.account)
    return;
  const multiply = resolveAccountMultiply(form.provider, form.multiply);
  try {
    const updated = await updateAdminAccountMultiply({
      userId: props.adminTargetUserId,
      accountId: props.account.accountId,
      multiply,
    });
    form.multiply = updated.multiply;
    props.account.multiply = updated.multiply;
    ElMessage.success("乘网已保存");
    emit("multiplySaved", updated.multiply);
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存乘网失败");
    throw err;
  }
}

async function saveAdminAccountFields() {
  if (!props.adminTargetUserId || !props.account)
    return;
  saving.value = true;
  try {
    if (props.allowMultiplyEdit)
      await saveMultiplyAdmin();
  }
  catch {
    /* 子函数已提示 */
  }
  finally {
    saving.value = false;
  }
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
              Deposit Wallet 初始化
            </el-button>
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
