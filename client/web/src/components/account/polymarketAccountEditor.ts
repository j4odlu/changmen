import type { AccountEditContext } from "./accountEditContext";
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
import { getApiBase } from "@/config/apiBase";
import { createRequestAuthProvider, getRequestAuthHeaders } from "@/lib/authCredentials";
import { createOrDerivePolymarketApiCreds, type PolymarketApiCreds } from "@changmen/venue-browser/adapter/polymarket";
import { fetchPolymarketRelayerStatus, preparePolymarketWallet } from "@changmen/venue-browser/adapter/polymarket";
import {
  normalizePolymarketApiCreds,
  normalizePolymarketTokenObject,
  parsePolymarketTokenObject,
} from "@/components/account/accountCredentialParse";
import {
  normalizePolymarketPrivateKey,
  resolvePolymarketDepositWalletFromPrivateKey,
  resolvePolymarketSignerAddress,
} from "@changmen/venue-browser/adapter/polymarket";
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

export function createPolymarketAccountEditor(ctx: AccountEditContext) {
  const { props, userStore } = ctx;
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
    return "粘贴钱包私钥，保存时自动连接";
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
  const polySaveStage = ref("");
  const polySaveError = ref("");
  /** 地址推导 / apiCreds 异步防串写 */
  let polyAsyncOpSeq = 0;

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

  async function resolvePolymarketPrivateKeyForSave(): Promise<string> {
    const typed = polyPrivateKey.value.trim();
    if (typed)
      return typed;
    // 粘贴凭证 / 本会话 token 仍可能带 privateKey（输入框故意不回显）
    const fromForm = extractPrivateKeyFromToken(ctx.form.token);
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

  function polymarketCredentialFingerprint(): string {
    // 不含私钥：同地址即同钥；输入框常空（本机仓），把 pk 算进指纹会导致每次保存误重生 apiCreds
    return [
      ctx.form.gateway.trim(),
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

  async function ensurePolymarketToken(onProgress?: (stage: string) => void): Promise<string> {
    const op = ++polyAsyncOpSeq;
    onProgress?.("识别钱包");
    const privateKey = await resolvePolymarketPrivateKeyForSave();
    if (op !== polyAsyncOpSeq)
      throw new Error("操作已取消，请重试保存");
    // 用参数传钥，不写回输入框（避免 DOM 明文）
    await syncPolymarketDerivedAddresses(false, privateKey, op);
    if (op !== polyAsyncOpSeq)
      throw new Error("操作已取消，请重试保存");
    onProgress?.("获取 API 凭证");
    if (!polyApiCreds.value || polyApiCredsFingerprint.value !== polymarketCredentialFingerprint())
      await generatePolymarketApiCreds(true, privateKey, op);
    if (op !== polyAsyncOpSeq)
      throw new Error("操作已取消，请重试保存");
    const token = buildPolyToken(privateKey);
    ctx.form.token = token;
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
        gateway: ctx.form.gateway,
        walletAddress: polyWalletAddress.value,
        funder: polyFunder.value,
        privateKey,
      });
      if (op !== polyAsyncOpSeq)
        return;
      polyWalletAddress.value ||= result.signerAddress;
      polyApiCreds.value = result.apiCreds;
      ctx.form.gateway ||= "https://clob.polymarket.com";
      polyApiCredsFingerprint.value = polymarketCredentialFingerprint();
      ctx.form.token = buildPolyToken(privateKey);
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
    const parsed = parsePolymarketTokenObject(ctx.form.token);
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

  function setSaveProgress(stage: string, error = "") {
    polySaveStage.value = stage;
    polySaveError.value = error;
  }

  async function copyPolymarketWalletAddress() {
    if (!polyWalletAddress.value) return;
    try {
      await navigator.clipboard.writeText(polyWalletAddress.value);
      ElMessage.success("钱包地址已复制");
    }
    catch {
      ElMessage.error("复制失败，请手动复制钱包地址");
    }
  }

  function cancelPending() {
    polyAsyncOpSeq += 1;
    polyGenerating.value = false;
    polyDerivingAddresses.value = false;
    polySaveStage.value = "";
    polySaveError.value = "";
  }

  return {
    polyWalletAddress,
    polyFunder,
    polyPrivateKey,
    polyLocalKeyStatus,
    polyLocalKeyReady,
    polyPrivateKeyPlaceholder,
    polyPrivateKeyHintText,
    polyApiCreds,
    polyApiCredsFingerprint,
    polyGenerating,
    polyRelayerPreparing,
    polyRelayerConfigured,
    polyAdvancedMode,
    polyDerivingAddresses,
    polySaveStage,
    polySaveError,
    setSaveProgress,
    copyPolymarketWalletAddress,
    syncPolymarketFieldsFromToken,
    resolvePolymarketPrivateKeyForSave,
    ensurePrivateKeyInVault,
    ensurePmVaultReadyBeforeCreate,
    syncPolymarketWalletAddressFromPrivateKey,
    syncPolymarketDerivedAddresses,
    polymarketCredentialFingerprint,
    buildPolyToken,
    ensurePolymarketToken,
    generatePolymarketApiCreds,
    onGeneratePolymarketApiCreds,
    polymarketRelayerSignUrl,
    refreshPolymarketRelayerStatus,
    resolvePolymarketRelayerSignatureType,
    onPreparePolymarketWallet,
    onDerivePolymarketAddresses,
    cancelPending,
  };
}

export type PolymarketAccountEditor = ReturnType<typeof createPolymarketAccountEditor>;
