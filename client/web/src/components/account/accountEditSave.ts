import type { AccountEditContext } from "./accountEditContext";
import type { Ref } from "vue";
import type { useAccountStore } from "@/stores/accountStore";
import type { AccountEditEmit } from "./accountEditContext";
import type { PolymarketAccountEditor } from "./polymarketAccountEditor";
import type { PredictFunAccountEditor } from "./predictFunAccountEditor";
import type { ObSportAccountEditor } from "./obSportAccountEditor";
import type { AccountRecord } from "@changmen/client-core/types/account";
import { resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { ElLoading, ElMessage } from "element-plus";
import { updateAdminAccountMultiply } from "@/api/admin";
import { normalizeAccountRateConfig, PlatformAccount } from "@/models/platformAccount";
import { isObSportBetToken } from "@/runtime/obSportBetAccount";
import { buildPredictFunMemoryToken, buildPredictFunPersistToken } from "@changmen/venue-browser/adapter/predictfun";
import { extractPrivateKeyFromToken } from "@/security/pmVault";
import { getAdapter } from "@/runtime/venueAdapters";
import type { AccountBalanceResult } from "@changmen/venue-browser/adapter/contract";

interface AccountEditSaveContext extends AccountEditContext {
  accountStore: ReturnType<typeof useAccountStore>;
  saving: Ref<boolean>;
  obTokenTab: Ref<"esport" | "sport">;
  sportObForm: ObSportAccountEditor["sportObForm"];
  sportObFromForm: ObSportAccountEditor["sportObFromForm"];
  probeObSportCredentialForSave: ObSportAccountEditor["probeObSportCredentialForSave"];
  emit: AccountEditEmit;
  onPolymarketSaveProgress?: (stage: string, error?: string) => void;
  polymarket: Pick<PolymarketAccountEditor,
    "polyPrivateKey" | "polyLocalKeyStatus" | "resolvePolymarketPrivateKeyForSave"
    | "ensurePrivateKeyInVault" | "ensurePmVaultReadyBeforeCreate" | "buildPolyToken" | "ensurePolymarketToken">;
  predictFun: Pick<PredictFunAccountEditor,
    "pfPrivyPrivateKey" | "pfPredictAccount" | "pfLocalKeyStatus"
    | "resolvePredictFunPrivyKeyForSave" | "ensurePredictFunToken" | "refreshPfPrivyAddressDisplay">;
}

export function createAccountEditSave(ctx: AccountEditSaveContext) {
  let polymarketSaveStage = "";
  function reportPolymarketSaveProgress(stage: string, error?: string) {
    if (ctx.form.provider !== "Polymarket") return;
    polymarketSaveStage = stage;
    ctx.onPolymarketSaveProgress?.(stage, error);
  }
  const {
    props,
    accountStore,
    saving,
    obTokenTab,
    sportObForm,
    emit,
    sportObFromForm,
    probeObSportCredentialForSave,
  } = ctx;
  const {
    polyPrivateKey,
    polyLocalKeyStatus,
    resolvePolymarketPrivateKeyForSave,
    ensurePrivateKeyInVault,
    ensurePmVaultReadyBeforeCreate,
    buildPolyToken,
    ensurePolymarketToken,
  } = ctx.polymarket;
  const {
    pfPrivyPrivateKey,
    pfPredictAccount,
    pfLocalKeyStatus,
    resolvePredictFunPrivyKeyForSave,
    ensurePredictFunToken,
    refreshPfPrivyAddressDisplay,
  } = ctx.predictFun;
  /**
   * [changmen 扩展] 已实现 venueMemberId 回写的场馆。
   * 其它场馆保持 A8：粘贴凭证即可保存，不强制余额/会员 ID。
   */
  const VENUE_MEMBER_ID_PROVIDERS = new Set(["OB", "RAY", "PB", "Polymarket", "PredictFun"]);

  function readStoredVenueMemberId(row: { venueMemberId?: string; venueId?: string } | null | undefined): string {
    const v = row?.venueMemberId ?? row?.venueId;
    return v != null ? String(v).trim() : "";
  }

  function requiresVenueMemberId(provider: unknown): boolean {
    return VENUE_MEMBER_ID_PROVIDERS.has(String(provider ?? "").trim());
  }

  function normalizeRateConfig() {
    return normalizeAccountRateConfig(ctx.form.rateConfig);
  }

  async function buildPatch(): Promise<Partial<AccountRecord> & {
    platformName: string;
    playerName: string;
    provider: AccountRecord["provider"];
  }> {
    const token = ctx.form.provider === "Polymarket"
      ? await ensurePolymarketToken(stage => reportPolymarketSaveProgress(stage))
      : ctx.form.provider === "PredictFun"
        ? await ensurePredictFunToken()
        : ctx.form.token.trim() || undefined;
    return {
      platformName: ctx.form.platformName.trim(),
      playerName: ctx.form.playerName.trim(),
      provider: ctx.form.provider,
      proxyId: ctx.form.proxyId === 0 ? undefined : ctx.form.proxyId,
      gateway: ctx.form.gateway.trim() || undefined,
      token: token || undefined,
      referer: ctx.form.referer.trim() || undefined,
      userAgent: ctx.form.userAgent.trim() || undefined,
      // PredictFun 无 A8 授信；其它场馆仍按表单（充提记账用的本金基准）
      credit: ctx.form.provider === "PredictFun" ? 0 : (Number(ctx.form.credit) || 0),
      maxBalance: Number(ctx.form.maxBalance) || 0,
      maxBalanceOdds: Number(ctx.form.maxBalanceOdds) || 2,
      maxProfit: Number(ctx.form.maxProfit) || 0,
      maxWinBalance: Number(ctx.form.maxWinBalance) || 0,
      minOdds: Number(ctx.form.minOdds) || 0,
      maxOdds: Number(ctx.form.maxOdds) || 0,
      minDefault: Number(ctx.form.minDefault) || 0,
      maxDefault: Number(ctx.form.maxDefault) || 0,
      maxOrder: Number(ctx.form.maxOrder) || 0,
      profit: Number(ctx.form.profit) || 0,
      maxBetCount: Number(ctx.form.maxBetCount) || 0,
      multiply: resolveAccountMultiply(ctx.form.provider, ctx.form.multiply),
      pause: ctx.form.pause,
      markupOnly: ctx.form.markupOnly,
      noMarkup: ctx.form.noMarkup,
      lastOdds: ctx.form.lastOdds,
      realName: ctx.form.realName.trim() || undefined,
      mobile: ctx.form.mobile.trim() || undefined,
      city: ctx.form.city.trim() || undefined,
      description: ctx.form.description.trim(),
      workTimes: [...ctx.form.workTimes],
      rateConfig: normalizeRateConfig(),
      game: JSON.parse(JSON.stringify(ctx.form.game)),
    };
  }

  /** [changmen 扩展] 选填 playerName → 场馆账号名 / 账号ID / 编辑原值 */
  function resolvePlayerNameForSave(
    patch: Partial<AccountRecord> & { playerName: string },
  ): string {
    const filled = String(patch.playerName || "").trim();
    if (filled)
      return filled;
    const venueName = String(patch.venueAccountName || ctx.form.venueAccountName || "").trim();
    if (venueName)
      return venueName;
    const venueId = String(patch.venueMemberId || ctx.form.venueMemberId || "").trim();
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
    // PredictFun：patch.token 是落库 DTO（仅 predictAccount）；探测须用 ctx.form.token（含 Privy）
    const probeToken = ctx.form.provider === "PredictFun" && String(ctx.form.token || "").trim()
      ? ctx.form.token.trim()
      : patch.token;
    const probe = new PlatformAccount({
      accountId: props.account?.accountId || 0,
      playerName: patch.playerName || ctx.form.playerName || "probe",
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
        ctx.form.provider === "PredictFun"
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
      ctx.form.venueMemberId = boundVenueMemberId || venueMemberId;
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
      ctx.form.venueMemberId = venueMemberId;
    }

    ctx.form.venueAccountName = venueAccountName;
    if (!ctx.form.playerName.trim())
      ctx.form.playerName = venueAccountName;

    return {
      ...result,
      venueMemberId: ctx.form.venueMemberId || venueMemberId,
      venueAccountName,
    };
  }

  async function save() {
    if (props.readonly || saving.value)
      return;
    if (!ctx.form.platformName.trim()) {
      ElMessage.error("平台名必填");
      return;
    }
    const invalidRate = ctx.form.rateConfig.some(r => Number.isNaN(Number(r.rate)));
    if (invalidRate) {
      ElMessage.error("买入比例不能为空，请填写有效数字");
      return;
    }
    saving.value = true;
    let loading: ReturnType<typeof ElLoading.service> | undefined;
    try {
      reportPolymarketSaveProgress("识别钱包");
      const patch = await buildPatch();
      if (isObSportBetToken(String(patch.token || ""))) {
        if (!sportObForm.token.trim()) {
          sportObForm.token = String(patch.token || "");
          if (!sportObForm.gateway.trim())
            sportObForm.gateway = String(patch.gateway || "");
          if (!sportObForm.referer.trim())
            sportObForm.referer = String(patch.referer || "");
          if (!sportObForm.venueMemberId.trim())
            sportObForm.venueMemberId = String(ctx.form.venueMemberId || "").trim();
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
        reportPolymarketSaveProgress("验证连接");
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

      reportPolymarketSaveProgress("保存账号");
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
        if (ctx.form.provider === "Polymarket") {
          const pk = await resolvePolymarketPrivateKeyForSave();
          await ensurePrivateKeyInVault(Number(acc.accountId), pk);
          // 内存保留私钥供自动下注；persistAccounts 会 strip；输入框不回填明文
          acc.token = buildPolyToken(pk);
          polyPrivateKey.value = "";
          polyLocalKeyStatus.value = "ready";
        }
        if (ctx.form.provider === "PredictFun") {
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
      if (ctx.form.provider === "Polymarket") {
        await ensurePmVaultReadyBeforeCreate();
        pmCreatePrivateKey = polyPrivateKey.value.trim()
          || extractPrivateKeyFromToken(String(patch.token || ""))
          || await resolvePolymarketPrivateKeyForSave();
        if (!pmCreatePrivateKey)
          throw new Error("Polymarket 私钥必填");
        patch.token = buildPolyToken(pmCreatePrivateKey);
      }
      if (ctx.form.provider === "PredictFun") {
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
      if (ctx.form.provider === "Polymarket" && created.playerId && pmCreatePrivateKey) {
        await ensurePrivateKeyInVault(Number(created.playerId), pmCreatePrivateKey);
        patch.token = buildPolyToken(pmCreatePrivateKey);
        polyPrivateKey.value = "";
        polyLocalKeyStatus.value = "ready";
      }
      if (ctx.form.provider === "PredictFun" && created.playerId && pfCreatePrivyKey) {
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
      reportPolymarketSaveProgress(polymarketSaveStage, err instanceof Error ? err.message : "保存失败");
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
    const multiply = resolveAccountMultiply(ctx.form.provider, ctx.form.multiply);
    try {
      const updated = await updateAdminAccountMultiply({
        userId: props.adminTargetUserId,
        accountId: props.account.accountId,
        multiply,
      });
      ctx.form.multiply = updated.multiply;
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

  return {
    readStoredVenueMemberId,
    requiresVenueMemberId,
    normalizeRateConfig,
    buildPatch,
    resolvePlayerNameForSave,
    probeVenueIdentityForSave,
    save,
    saveMultiplyAdmin,
    saveAdminAccountFields,
  };
}

export type AccountEditSave = ReturnType<typeof createAccountEditSave>;
