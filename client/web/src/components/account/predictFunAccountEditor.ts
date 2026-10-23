import type { AccountEditContext } from "./accountEditContext";
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
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
} from "@changmen/venue-browser/adapter/predictfun";
import {
  ensurePmVaultUnlocked,
  extractPrivateKeyFromToken,
  getCachedPrivateKey,
  isPmVaultUnlocked,
  vaultHasKey,
} from "@/security/pmVault";

export function createPredictFunAccountEditor(ctx: AccountEditContext) {
  const { props, userStore } = ctx;
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
    const fromForm = resolvePredictFunPrivyPrivateKey(parsePredictFunTokenConfig(ctx.form.token))
      || extractPrivateKeyFromToken(ctx.form.token);
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

  function syncPredictFunFieldsFromToken(token: string) {
    const cfg = parsePredictFunTokenConfig(token);
    pfPredictAccount.value = resolvePredictFunPredictAccount(cfg);
    const addr = pfPredictAccount.value.trim();
    if (isValidPredictFunAddress(addr)) {
      ctx.form.venueMemberId = addr;
      ctx.form.venueAccountName = addr;
      if (!ctx.form.playerName.trim() || ctx.form.playerName.trim() === "River")
        ctx.form.playerName = addr;
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

  async function resolvePredictFunPrivyKeyForSave(): Promise<string> {
    const typed = pfPrivyPrivateKey.value.trim();
    if (typed) {
      const normalized = normalizePredictFunPrivateKey(typed);
      if (!isValidPredictFunPrivateKey(normalized))
        throw new Error("Privy 私钥格式无效（须为 0x + 64 hex）");
      return normalized;
    }
    const fromForm = resolvePredictFunPrivyPrivateKey(parsePredictFunTokenConfig(ctx.form.token))
      || extractPrivateKeyFromToken(ctx.form.token);
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
    ctx.form.token = buildPredictFunMemoryToken({ predictAccount, privyPrivateKey });
    ctx.form.venueMemberId = predictAccount;
    ctx.form.venueAccountName = predictAccount;
    return buildPredictFunPersistToken(predictAccount);
  }

  return {
    pfPrivyPrivateKey,
    pfPredictAccount,
    pfPrivyAddress,
    pfLocalKeyStatus,
    pfLocalKeyReady,
    pfPrivyKeyPlaceholder,
    pfPrivyKeyHintText,
    setPfPrivyAddressFromKey,
    refreshPfPrivyAddressDisplay,
    copyPfPrivyAddress,
    syncPredictFunFieldsFromToken,
    resolvePredictFunPrivyKeyForSave,
    ensurePredictFunToken,
  };
}

export type PredictFunAccountEditor = ReturnType<typeof createPredictFunAccountEditor>;
