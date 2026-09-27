import type { UserInfo } from "@/types/esport";
import type { FollowConfig } from "@/types/order";
import type { ExtensionPrefs } from "@/types/extensionPrefs";
import type { MessageConfig, ProxyRow } from "@/types/userExtras";
import type { UserConfig } from "@/types/userConfig";
import { createDefaultExtensionPrefs, normalizeExtensionPrefs, serializeExtensionPrefsForSave } from "@/types/extensionPrefs";
import { readPbWsShadowUiLocal, writePbWsShadowUiLocal } from "@/shared/pbWsShadowUiLocal";
import { readPbChangmenExtensionsLocal, writePbChangmenExtensionsLocal } from "@/shared/pbExtensionsLocal";
import { defineStore } from "pinia";
import { toRaw } from "vue";
import { clearAuthSession, getRefreshToken } from "@/api/client";
import {
  login as apiLogin,
  logout as apiLogout,
  updateUserSetting as apiUpdateUserSetting,
  getClientData,
  getClientDataArray,
  getToken,
  getUserInfo,
  saveClientData,
  saveClientDataDetailed,
} from "@/api/esport";
import { ensureTokenRefresh, stopTokenRefresh } from "@/lib/sessionRefresh";
import { subscribeUserChannel, unsubscribeUserChannel } from "@/realtime/userChannel";
import { ensureBetTargetChannelSubscribed } from "@/realtime/betTargetChannel";
import { ensurePublishChannelSubscribed } from "@/realtime/publishChannel";
import { parseFormBool } from "@/shared/parseFormBool";
import { setAssignedMarketHubOrigin } from "@changmen/client-core/shared/hkRelayOrigin";
import {
  createDefaultUserConfig,
  mergeUserConfig,
} from "@/types/userConfig";

const USER_KEY = "app:userName";
const HIDDEN_NAME_KEY = "hiddenUserName";
const CONFIG_KEY = "USERCONFIG";

export interface ConfigSaveResult {
  ok: boolean;
  msg?: string;
}

/** 对齐 A8 Pinia `Pn`（`g=Pn()`）：用户 / 登录态 + `config`（A8 `g.config`） */
export const useUserStore = defineStore("user", {
  state: () => ({
    userName: localStorage.getItem(USER_KEY) || "",
    userId: 0,
    setting: {} as Record<string, unknown>,
    /** 对齐 A8 `g.config`（USERCONFIG） */
    config: createDefaultUserConfig(),
    configLoaded: false,
    configSaving: false,
    /** 平博 v4 用 A8 账号，来自 GetUserInfo 或 /api/a8/credit-plate-user */
    creditPlateUserName: "",
    /** restoreSession / 无 token 判定完成后为 true，避免已登录刷新闪登录框 */
    sessionChecked: !getToken(),
    /** 有本地会话但后端暂不可达时保留 token，并在恢复页展示重试入口。 */
    sessionRestoreError: "",
    ready: false,
    error: null as string | null,
    hiddenUserName: localStorage.getItem(HIDDEN_NAME_KEY) === "1",
    proxyList: [] as ProxyRow[],
    message: {} as MessageConfig,
    extensionPrefs: createDefaultExtensionPrefs(),
    /**
     * PB WS 影子价旁显。仅本机 localStorage，不进 Extensions / RDS。
     * 默认关。
     */
    pbWsShadowUi: readPbWsShadowUiLocal(),
    /**
     * PB changmen 扩展总开关。仅本机 localStorage。
     * 默认关 = A8（仅 live 写 fo）；开 = changmen（双循环 + 赛前写 fo 等）。
     */
    pbChangmenExtensions: readPbChangmenExtensionsLocal(),
    follow: null as FollowConfig | null,
    extrasLoaded: false,
    /** 递增以作废过期的 loadExtras，防止慢 GetData 冲掉已保存的扩展偏好 */
    extrasLoadGen: 0,
    isAdmin: false,
    role: "user" as "admin" | "leader" | "user",
    teamId: null as string | null,
  }),

  getters: {
    isLoggedIn: () => Boolean(getToken()),
    isLeader: state => state.role === "leader",
    canAccessAdmin: state => state.isAdmin || state.role === "leader",

    displayName(state): string {
      return state.hiddenUserName ? String(state.userId || "—") : state.userName;
    },

    followEnabled(state): boolean {
      return Boolean(state.setting?.Follow);
    },
  },

  actions: {
    async login(password: string, userName?: string) {
      const name = userName ?? this.userName;
      this.error = null;
      const info = await apiLogin(name, password);
      this.userName = info.userName;
      this.userId = info.ID;
      localStorage.setItem(USER_KEY, info.userName);
      await this.fetchUserInfo();
      return info;
    },

    async fetchUserInfo() {
      if (!getToken()) {
        this.ready = false;
        return;
      }
      try {
        // 尽早按本机缓存开门控，勿等 Extensions GetData
        await this.syncPbCollectModeFromLocal();
        const info: UserInfo = await getUserInfo();
        this.userId = info.ID;
        this.userName = info.UserName;
        setAssignedMarketHubOrigin(info.MarketHubOrigin);
        this.setting = info.Setting ?? {};
        this.isAdmin = info.IsAdmin === true || info.IsAdmin === 1;
        this.role = info.Role || "user";
        this.teamId = info.TeamId || null;
        const cp = info.CreditPlateUserName?.trim();
        if (cp)
          this.creditPlateUserName = cp;
        await this.loadExtras();
        void subscribeUserChannel(this.userId).catch((err) => {
          console.warn("[pubsub] USER channel:", err);
        });
        void ensureBetTargetChannelSubscribed().catch((err) => {
          console.warn("[pubsub] BetTarget channel:", err);
        });
        void ensurePublishChannelSubscribed().catch((err) => {
          console.warn("[pubsub] Publish channel:", err);
        });
        this.ready = true;
        this.error = null;
      }
      catch (e) {
        setAssignedMarketHubOrigin("");
        this.error = e instanceof Error ? e.message : String(e);
        this.ready = false;
        throw e;
      }
    },

    async restoreSession() {
      if (!getToken()) {
        this.ready = false;
        this.sessionRestoreError = "";
        this.sessionChecked = true;
        return false;
      }
      this.sessionChecked = false;
      this.sessionRestoreError = "";
      // 提前启动 JWT refresh，防止 token 在使用中到期
      const rft = getRefreshToken();
      if (rft) {
        await ensureTokenRefresh();
      }
      try {
        await this.fetchUserInfo();
        this.sessionRestoreError = "";
        return true;
      }
      catch (err) {
        this.ready = false;
        // client.ts 只会在服务端明确判定会话失效时清 token；网络/502 保留会话。
        if (getToken()) {
          this.sessionRestoreError = "连接暂时不可用，请检查网络后重试";
          this.error = err instanceof Error ? err.message : String(err);
          return false;
        }
        clearAuthSession();
        this.sessionRestoreError = "";
        return false;
      }
      finally {
        this.sessionChecked = this.ready || !getToken();
      }
    },

    async logout() {
      unsubscribeUserChannel();
      await stopTokenRefresh();
      await apiLogout();
      this.userName = "";
      this.userId = 0;
      this.setting = {};
      this.creditPlateUserName = "";
      this.proxyList = [];
      this.message = {};
      this.extensionPrefs = createDefaultExtensionPrefs();
      // 本机影子价偏好保留在 localStorage；登出只关运行时门控，下次登录再按本地值恢复
      try {
        const { setPbWsShadowUiAllowed, setPbChangmenExtensions } = await import("@changmen/venue-adapter/pb");
        setPbWsShadowUiAllowed(false);
        setPbChangmenExtensions(false);
      }
      catch {
        /* adapter 未加载时忽略 */
      }
      try {
        await this.syncPmArbPriceBufferFromPrefs();
        await this.syncPmFokDepthBufferFromPrefs();
        await this.syncPfArbPriceBufferFromPrefs();
      }
      catch {
        /* adapter 未加载时忽略 */
      }
      this.follow = null;
      this.extrasLoaded = false;
      this.config = createDefaultUserConfig();
      this.configLoaded = false;
      this.configSaving = false;
      this.isAdmin = false;
      this.role = "user";
      this.teamId = null;
      this.ready = false;
      setAssignedMarketHubOrigin("");
      localStorage.removeItem(USER_KEY);
    },

    async loadExtras(force = false) {
      if (this.extrasLoaded && !force)
        return;
      // 世代号：打开弹窗的慢请求不得盖掉用户已改/已保存的扩展偏好
      const gen = ++this.extrasLoadGen;
      try {
        const proxies = await getClientDataArray<ProxyRow>("PROXY");
        if (gen !== this.extrasLoadGen)
          return;
        this.proxyList = proxies.filter(p => p?.proxyId != null);
      }
      catch {
        /* PROXY GetData 失败时保留已有列表 */
      }
      const msg = await getClientData<MessageConfig>("Message");
      const ext = await getClientData<ExtensionPrefs>("Extensions");
      const follow = await getClientData<FollowConfig & Record<string, unknown>>("Follow");
      if (gen !== this.extrasLoadGen)
        return;
      this.message = msg ?? {};
      this.extensionPrefs = normalizeExtensionPrefs(ext);
      await this.syncPbCollectModeFromLocal();
      await this.syncPmArbPriceBufferFromPrefs();
      await this.syncPmFokDepthBufferFromPrefs();
      await this.syncPfArbPriceBufferFromPrefs();
      if (gen !== this.extrasLoadGen)
        return;
      this.follow = follow ?? null;
      this.extrasLoaded = true;
    },

    async saveFollowConfig(payload: FollowConfig) {
      await saveClientData("Follow", JSON.stringify(payload));
      this.follow = payload;
    },

    async saveProxyList() {
      await saveClientData("PROXY", JSON.stringify(this.proxyList));
    },

    async saveMessageConfig() {
      await saveClientData("Message", JSON.stringify(this.message));
    },

    /** 从本机恢复 PB 采集模式（A8 默认）并同步运行时门控 */
    async syncPbCollectModeFromLocal() {
      this.pbChangmenExtensions = readPbChangmenExtensionsLocal();
      this.pbWsShadowUi = readPbWsShadowUiLocal();
      const { setPbChangmenExtensions, setPbWsShadowUiAllowed } = await import("@changmen/venue-adapter/pb");
      setPbChangmenExtensions(this.pbChangmenExtensions === true);
      setPbWsShadowUiAllowed(this.pbChangmenExtensions === true && this.pbWsShadowUi === true);
    },

    /** Extensions → venue-adapter PM 套利缓冲配置（供后续 FOK/展示接线） */
    async syncPmArbPriceBufferFromPrefs() {
      const { setPmArbPriceBufferPrefs } = await import("@changmen/venue-adapter/polymarket");
      setPmArbPriceBufferPrefs(this.extensionPrefs.pmArbPriceBuffer);
    },

    /** Extensions → venue-adapter PM FOK 深度倍数（预检 1× 走出 P 后验 P 及更优） */
    async syncPmFokDepthBufferFromPrefs() {
      const { setPmFokDepthBufferPrefs } = await import("@changmen/venue-adapter/polymarket");
      setPmFokDepthBufferPrefs(this.extensionPrefs.pmFokDepthBuffer ?? {
        enabled: false,
        multiplier: 1.5,
      });
    },

    /** Extensions → venue-adapter PF 套利缓冲配置（展示/限价接线） */
    async syncPfArbPriceBufferFromPrefs() {
      const { setPfArbPriceBufferPrefs } = await import("@changmen/venue-adapter/predictfun");
      setPfArbPriceBufferPrefs(this.extensionPrefs.pfArbPriceBuffer);
    },

    /** 本机缓存立即生效，不写 RDS */
    async setPbWsShadowUi(on: boolean) {
      const next = on === true;
      this.pbWsShadowUi = next;
      writePbWsShadowUiLocal(next);
      const { setPbWsShadowUiAllowed } = await import("@changmen/venue-adapter/pb");
      setPbWsShadowUiAllowed(this.pbChangmenExtensions === true && next);
    },

    /** 本机立即生效：关=A8；开=changmen 扩展（双循环、赛前写 fo、RotNum、WS 影子） */
    async setPbChangmenExtensions(on: boolean) {
      const next = on === true;
      const prev = this.pbChangmenExtensions === true;
      this.pbChangmenExtensions = next;
      writePbChangmenExtensionsLocal(next);
      // 子开关未显式写过时跟总开关：开扩展即开影子
      this.pbWsShadowUi = readPbWsShadowUiLocal();
      const { setPbChangmenExtensions, setPbWsShadowUiAllowed } = await import("@changmen/venue-adapter/pb");
      setPbChangmenExtensions(next);
      setPbWsShadowUiAllowed(next && this.pbWsShadowUi === true);
      if (prev !== next) {
        const { restartCollector } = await import("@/runtime/collectors");
        restartCollector("PB");
      }
    },

    async saveExtensionPrefs() {
      // 作废进行中的 loadExtras，避免「保存成功后被打开弹窗时的旧 GetData 冲回关」
      this.extrasLoadGen += 1;
      // 失败减仓暂锁死：保存前再归一化，避免内存/旧 KV 把 enabled:true 写回
      this.extensionPrefs = normalizeExtensionPrefs(this.extensionPrefs);
      await this.syncPmArbPriceBufferFromPrefs();
      await this.syncPmFokDepthBufferFromPrefs();
      await this.syncPfArbPriceBufferFromPrefs();
      const result = await saveClientDataDetailed(
        "Extensions",
        serializeExtensionPrefsForSave(this.extensionPrefs),
      );
      if (!result.ok)
        throw new Error(result.msg || "保存扩展配置失败");
    },

    async deleteProxy(proxyId: number) {
      const { useAccountStore } = await import("@/stores/accountStore");
      const accounts = useAccountStore().accounts;
      const inUse = accounts.some(a => a.proxyId === proxyId);
      if (inUse) {
        throw new Error("当前代理正在被账号使用");
      }
      this.proxyList = this.proxyList.filter(p => p.proxyId !== proxyId);
      await this.saveProxyList();
    },

    toggleHiddenUserName() {
      this.hiddenUserName = !this.hiddenUserName;
      localStorage.setItem(HIDDEN_NAME_KEY, this.hiddenUserName ? "1" : "0");
    },

    async patchSetting(patch: Record<string, unknown>) {
      const next = await apiUpdateUserSetting(patch);
      this.setting = { ...this.setting, ...next };
      return next;
    },

    betTargetEnabled(): boolean {
      return parseFormBool(this.setting?.BetTarget);
    },

    async loadConfig() {
      const raw = await getClientData<Partial<UserConfig>>(CONFIG_KEY);
      this.config = mergeUserConfig(raw ?? undefined);
      this.configLoaded = true;
    },

    buildConfigSavePayload(): UserConfig {
      const raw = toRaw(this.config) as UserConfig & {
        arbDetectEngine?: unknown;
        arbExecuteEngine?: unknown;
      };
      const {
        arbDetectEngine: _legacyDetectEngine,
        arbExecuteEngine: _legacyExecuteEngine,
        ...configBody
      } = raw;
      return {
        ...configBody,
        betMoney: Number(this.config.betMoney) || 100,
        minMoney: Number(this.config.minMoney) || 0,
        maxMoney: Number(this.config.maxMoney) || 0,
        profit: Number(this.config.profit) || 1.03,
        maxProfit: Number(this.config.maxProfit) || 1.2,
        minOdds: Number(this.config.minOdds) || 1.3,
        maxOdds: Number(this.config.maxOdds) || 10,
        makeProfit: Number(this.config.makeProfit) || 1.01,
        makeUp_odds: Number(this.config.makeUp_odds) || 0,
        makeUp_defaultOdds: Number(this.config.makeUp_defaultOdds) || 0,
        anyOddsProfit: Number(this.config.anyOddsProfit) || 0.95,
        checkTimeout: Number(this.config.checkTimeout) || 3000,
      };
    },

    async saveConfig(): Promise<ConfigSaveResult> {
      this.configSaving = true;
      try {
        const payload = this.buildConfigSavePayload();
        let content: string;
        try {
          content = JSON.stringify(payload);
        }
        catch {
          return { ok: false, msg: "配置无法序列化，请刷新页面后重试" };
        }
        const result = await saveClientDataDetailed(CONFIG_KEY, content);
        if (result.ok) {
          this.config = payload;
        }
        return result;
      }
      finally {
        this.configSaving = false;
      }
    },
  },
});
