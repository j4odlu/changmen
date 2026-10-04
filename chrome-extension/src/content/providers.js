import { PLATFORMS } from "./platforms.js";
import { getCookie, sleep } from "./utils.js";
import { getPolymarketCredentials } from "./polymarket/init.js";
import {
  buildObEsportConfig,
  buildObSportConfig,
  discoverObSportMerchantEntry,
  discoverObSportGateway,
  discoverObSportWsUrl,
  findObSportIframeHref,
  mergeObSportMerchantEntry,
  normalizeObSportGatewayCandidate,
  parseObSportMerchantRequest,
  parseObEsportEntry,
  parseObSportEntry,
  resolveObSportPageEntry,
} from "./ob-entry.js";
import { validatePbLocalStorageSnapshot } from "./pb-credential.js";
import { readObSportVenueParams } from "./ob-sport-venue-params.js";
import { readRayConfig, readRayPageSession } from "./ray-credential.js";

const IM_PATH =
  /^\/(esportsitev2|esportmobilev2)\/index.html\?v=\d+&id=\d+&token=([^\&]+)/;
const IA_SEARCH = /^\?lang=\d&token=([\w\.\_\-]+)$/;

const OB_SPORT_STORAGE_KEY = "gamebet.obSportCreds";
const OB_SPORT_MERCHANT_STORAGE_KEY = "gamebet.obSportMerchantCreds";
const OB_SPORT_GATEWAY_WAIT_MS = 2500;
const OB_SPORT_GATEWAY_POLL_MS = 100;

/** @type {ReturnType<typeof setInterval>|null} */
let obSportGatewayPoller = null;

/** 体育 iframe 内把网关写入 storage，供父页 GetConfig 读取 */
async function publishObSportGatewayHint(entry, gateway) {
  const normalized = normalizeObSportGatewayCandidate(gateway);
  if (!normalized || !chrome?.storage?.local) return;
  try {
    await chrome.storage.local.set({
      [OB_SPORT_STORAGE_KEY]: {
        token: entry.token,
        sessionId: entry.sessionId,
        gateway: normalized,
        updatedAt: Date.now(),
      },
    });
  } catch {
    /* ignore */
  }
}

function ensureObSportGatewayPublisher(entry) {
  if (obSportGatewayPoller || !entry) return;
  let tries = 0;
  obSportGatewayPoller = setInterval(() => {
    tries += 1;
    const gw = discoverObSportGateway();
    if (gw) {
      void publishObSportGatewayHint(entry, gw);
      clearInterval(obSportGatewayPoller);
      obSportGatewayPoller = null;
      return;
    }
    if (tries >= Math.ceil(OB_SPORT_GATEWAY_WAIT_MS / OB_SPORT_GATEWAY_POLL_MS)) {
      clearInterval(obSportGatewayPoller);
      obSportGatewayPoller = null;
    }
  }, OB_SPORT_GATEWAY_POLL_MS);
}

async function readObSportGatewayHint(entry) {
  if (!chrome?.storage?.local) return null;
  try {
    const bag = await chrome.storage.local.get(OB_SPORT_STORAGE_KEY);
    const row = bag?.[OB_SPORT_STORAGE_KEY];
    if (!row || typeof row !== "object") return null;
    if (row.token && entry?.token && String(row.token) !== String(entry.token)) return null;
    if (Date.now() - Number(row.updatedAt || 0) > 30 * 60 * 1000) return null;
    return normalizeObSportGatewayCandidate(row.gateway) || null;
  } catch {
    return null;
  }
}

async function resolveObSportGateway(entry) {
  const deadline = Date.now() + OB_SPORT_GATEWAY_WAIT_MS;
  while (Date.now() <= deadline) {
    const fromPerf = discoverObSportGateway();
    if (fromPerf) {
      await publishObSportGatewayHint(entry, fromPerf);
      return fromPerf;
    }
    const fromStore = await readObSportGatewayHint(entry);
    if (fromStore) return fromStore;
    await sleep(OB_SPORT_GATEWAY_POLL_MS);
  }
  return discoverObSportGateway() || (await readObSportGatewayHint(entry));
}

async function readObSportMerchantEntryOnce() {
  const fromPerformance = discoverObSportMerchantEntry();
  // 当前页面已经发出的真实请求是活跃会话锚点；只读取与其 requestId
  // 完全一致的 SDK 参数行，防止同域多账号/历史行串号。
  const venueParams = await readObSportVenueParams(
    globalThis.indexedDB,
    fromPerformance?.token || "",
  );
  const fromVenueParams = venueParams && venueParams.gateway !== location.origin
    ? {
        kind: "sport",
        source: "merchant-proxy",
        ...venueParams,
        pageOrigin: location.origin,
        merchantOrigin: location.origin,
        referer: `${location.origin}/`,
        href: location.href,
        enName: "OBSPORT",
      }
    : null;
  const liveEntry = mergeObSportMerchantEntry(fromPerformance, fromVenueParams);
  if (!chrome?.storage?.local)
    return liveEntry;
  try {
    const bag = await chrome.storage.local.get([
      OB_SPORT_MERCHANT_STORAGE_KEY,
      OB_SPORT_STORAGE_KEY,
    ]);
    const row = bag?.[OB_SPORT_MERCHANT_STORAGE_KEY];
    if (!row || typeof row !== "object")
      return liveEntry;
    if (Date.now() - Number(row.updatedAt || 0) > 30 * 60 * 1000)
      return liveEntry;
    if (String(row.pageOrigin || "") !== location.origin)
      return liveEntry;
    const hint = bag?.[OB_SPORT_STORAGE_KEY];
    const hintedGateway = hint
      && String(hint.token || "") === String(row.token || "")
      && Date.now() - Number(hint.updatedAt || 0) <= 30 * 60 * 1000
      ? normalizeObSportGatewayCandidate(hint.gateway)
      : "";
    const parsed = parseObSportMerchantRequest(
      `/yewu12/api/user/getUserInfo?token=${encodeURIComponent(String(row.token || ""))}&enName=${encodeURIComponent(String(row.enName || "OBSPORT"))}`,
      location.href,
    );
    const fromStorage = parsed
      ? {
          ...parsed,
          sessionId: String(row.sessionId || ""),
          uid: String(row.uid || row.sessionId || ""),
          gateway: normalizeObSportGatewayCandidate(row.gateway) || hintedGateway,
          launchHref: String(row.launchHref || ""),
        }
      : null;
    return mergeObSportMerchantEntry(liveEntry, fromStorage);
  }
  catch {
    return liveEntry;
  }
}

async function readObSportMerchantEntry(waitForComplete = false) {
  const deadline = Date.now() + (waitForComplete ? OB_SPORT_GATEWAY_WAIT_MS : 0);
  let entry = await readObSportMerchantEntryOnce();
  while (
    waitForComplete
    && entry?.source === "merchant-proxy"
    && (!entry.gateway || !entry.sessionId)
    && Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, OB_SPORT_GATEWAY_POLL_MS));
    entry = await readObSportMerchantEntryOnce() || entry;
  }
  return entry;
}

/** PB / ps3838：x-app-data 有 BrowserSessionId(_N)? + custid(_N)?，或顶层 token 含会话头 */
function hasPbLoginSession() {
  const appRaw = localStorage.getItem("x-app-data");
  if (appRaw) {
    try {
      const app = JSON.parse(appRaw);
      const keys = Object.keys(app || {});
      const hasSession = keys.some(
        (k) => k === "BrowserSessionId" || /^BrowserSessionId_\d+$/.test(k),
      );
      const hasCustid = keys.some((k) => k === "custid" || /^custid_\d+$/.test(k));
      if (hasSession && hasCustid) return true;
    } catch {
      /* fall through */
    }
  }
  try {
    const token = JSON.parse(localStorage.getItem("token") || "");
    if (
      token &&
      typeof token === "object" &&
      (token["X-Browser-Session-Id"] || token["X-Custid"])
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** @type {Record<string, new () => { Check(): Promise<boolean>; GetConfig(): Promise<object|undefined> }>} */
export const PROVIDER_REGISTRY = {
  [PLATFORMS.OB]: class ObProvider {
    /** @type {"esport"|"sport"|null} */
    _kind = null;
    /** @type {string|null} 体育进馆 URL（本页或 iframe.src） */
    _sportHref = null;
    /** @type {object|null} */
    _sportEntry = null;

    async Check() {
      this._kind = null;
      this._sportHref = null;
      this._sportEntry = null;

      const esport = parseObEsportEntry(location.href);
      if (esport) {
        this._kind = "esport";
        return true;
      }

      const sportSelf = resolveObSportPageEntry() || parseObSportEntry(location.href);
      if (sportSelf) {
        this._kind = "sport";
        this._sportHref = sportSelf.href || location.href;
        const gw = discoverObSportGateway();
        if (gw) await publishObSportGatewayHint(sportSelf, gw);
        else ensureObSportGatewayPublisher(sportSelf);
        return true;
      }

      const merchantSport = await readObSportMerchantEntry();
      if (merchantSport) {
        this._kind = "sport";
        this._sportEntry = merchantSport;
        this._sportHref = merchantSport.href || location.href;
        return true;
      }

      // 父页壳：…/game/sport/ob + iframe 进馆（[changmen 扩展]；A8 仅认当前帧 URL）
      if (window === window.top) {
        const iframeHref = findObSportIframeHref(document);
        if (iframeHref) {
          this._kind = "sport";
          this._sportHref = iframeHref;
          return true;
        }
      }
      return false;
    }

    async GetConfig() {
      if (this._kind === "esport" || (!this._kind && parseObEsportEntry(location.href))) {
        const entry = parseObEsportEntry(location.href);
        if (!entry) return undefined;
        return buildObEsportConfig(entry);
      }

      let entry = this._sportEntry;
      if (entry?.source === "merchant-proxy")
        entry = await readObSportMerchantEntry(true) || entry;
      entry = entry
        || await readObSportMerchantEntry(true)
        || resolveObSportPageEntry()
        || parseObSportEntry(this._sportHref)
        || parseObSportEntry(location.href);
      if (!entry) return undefined;
      // gateway 只接受 launchV6.data.html 的真实 origin；同源代理 origin 不会写入。
      if (entry.source === "merchant-proxy") {
        if (!entry.gateway)
          return { error: "体育网关尚未识别完成，请等待页面加载后重试；禁止复制空网关凭证" };
        if (!/^\d{18,}$/.test(String(entry.sessionId || "")))
          return { error: "体育账号 UID 尚未识别完成，请等待页面加载后重试；禁止复制残缺凭证" };
        return buildObSportConfig(entry, entry.gateway || "");
      }
      // 无网关也先交 token（试玩可无 sessionId），网关可后补
      const gateway = await resolveObSportGateway(entry);
      const wsUrl = discoverObSportWsUrl();
      return buildObSportConfig(entry, gateway || "", wsUrl);
    }
  },

  [PLATFORMS.RAY]: class RayProvider {
    async Check() {
      return Boolean(
        document.body.querySelector(".app-header img[alt=RAYBET]") ??
          document.body.querySelector(".app-header .logo-icon"),
      );
    }

    async GetConfig() {
      const session = await readRayPageSession();
      return readRayConfig(localStorage, location.href, fetch, session);
    }
  },

  [PLATFORMS.IM]: class ImProvider {
    async Check() {
      return IM_PATH.test(location.pathname + location.search);
    }

    async GetConfig() {
      const match = IM_PATH.exec(location.pathname + location.search);
      if (!match) return undefined;
      const token = match[2];
      const referer = `${location.protocol}//${location.host}${location.pathname}${location.search}`;
      const gateway = `${location.protocol}//${location.host}`;
      return {
        provider: PLATFORMS.IM,
        gateway,
        token,
        referer,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.IM,
            gateway: [gateway],
            token,
            referer,
          }),
        ),
      };
    }
  },

  [PLATFORMS.TF]: class TfProvider {
    async Check() {
      if (!/^gc\./.test(location.host)) return false;
      const vuex = localStorage.getItem("vuex");
      return Boolean(vuex && /^\{/.test(vuex));
    }

    async GetConfig() {
      const vuex = JSON.parse(localStorage.getItem("vuex") ?? "{}");
      const token = vuex?.settings?.settings?.token;
      const priBaseUrl = vuex?.settings?.settings?.priBaseUrl;
      if (!token || !priBaseUrl) return undefined;
      const parsed = new URL(priBaseUrl);
      const gateway = `${parsed.protocol}//${parsed.host}`;
      const referer = `${location.protocol}//${location.host}/`;
      const auth = `Token ${token}`;
      return {
        provider: PLATFORMS.TF,
        gateway,
        token: auth,
        referer,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.TF,
            gateway: [gateway],
            token: auth,
            referer,
          }),
        ),
      };
    }
  },

  [PLATFORMS.IA]: class IaProvider {
    async Check() {
      return IA_SEARCH.test(location.search);
    }

    async GetConfig() {
      const match = IA_SEARCH.exec(location.search);
      if (!match) return undefined;
      const token = match[1];
      const gateway = `https://${location.host}`;
      return {
        provider: PLATFORMS.IA,
        gateway,
        token,
        referer: location.href,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.IA,
            gateway: [gateway],
            token,
            referer: location.href,
          }),
        ),
      };
    }
  },

  [PLATFORMS.SABA]: class SabaProvider {
    async Check() {
      return /^\/\(S\(ESport/.test(location.pathname);
    }

    async GetConfig() {
      const match = /^\/(.+?)\//.exec(location.pathname);
      if (!match) return undefined;
      const gateway = `${location.protocol}//${location.host}`;
      const referer = `${location.protocol}//${location.host}/`;
      const token = match[1];
      return {
        provider: PLATFORMS.SABA,
        gateway,
        token,
        referer,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.SABA,
            gateway: [gateway],
            token,
            referer,
          }),
        ),
      };
    }
  },

  [PLATFORMS.PB]: class PbProvider {
    /**
     * [A8 可证实] `/esports-hub/`、`/compact/sports/` + 存在 `x-app-data`
     * [changmen 扩展] ps3838 等：`/sports` + 登录会话字段（BrowserSessionId/custid）
     */
    async Check() {
      const path = location.pathname;
      if (/\/esports\-hub\/|\/compact\/sports\//.test(path)) {
        return Boolean(localStorage.getItem("x-app-data"));
      }
      if (/\/sports(\/|$)/.test(path)) {
        return hasPbLoginSession();
      }
      return false;
    }

    async GetConfig() {
      if (!(await this.Check())) return undefined;
      const snapshot = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) snapshot[key] = localStorage.getItem(key) ?? "";
      }
      // [changmen 扩展] 复制前校验内层 X-U 等，避免用户拷到「能刷余额、预检 403」的残缺包
      const credentialError = validatePbLocalStorageSnapshot(snapshot);
      if (credentialError) {
        return { error: credentialError };
      }
      const payload = {
        provider: PLATFORMS.PB,
        gateway: `https://${location.host}`,
        token: JSON.stringify(snapshot),
        referer: location.href,
      };
      // [changmen] UTF-8 安全 btoa；A8 为 window.btoa(JSON.stringify) 遇非 Latin1 会抛
      return {
        provider: PLATFORMS.PB,
        gateway: payload.gateway,
        token: payload.token,
        referer: payload.referer,
        data: window.btoa(unescape(encodeURIComponent(JSON.stringify(payload)))),
      };
    }
  },

  [PLATFORMS.IMT]: class ImtProvider {
    async Check() {
      return Boolean(localStorage.getItem("siteProfile4") && localStorage.getItem("version4"));
    }

    async GetConfig() {
      const version = localStorage.getItem("version4");
      const profileRaw = localStorage.getItem("siteProfile4");
      if (!version || !profileRaw) return undefined;
      const profile = JSON.parse(profileRaw);
      const token = btoa(JSON.stringify({ tk: profile.t, v: version, mc: profile.mc }));
      const gateway = `${location.protocol}//${location.host}`;
      const referer = `${location.protocol}//${location.host}/`;
      return {
        provider: PLATFORMS.IMT,
        gateway,
        token,
        referer,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.IMT,
            gateway: [gateway],
            token,
            referer,
          }),
        ),
      };
    }
  },

  [PLATFORMS.HGA]: class HgaProvider {
    async Check() {
      const ok = document.getElementById("mu_profile") !== null;
      if (ok) {
        void (async () => {
          await sleep(1000);
          // A8 写 .esport-collect-provider-icon；changmen UI 为 .gamebet-collect-float
          const icon =
            document.body.querySelector(".gamebet-collect-float")
            || document.body.querySelector(".esport-collect-provider-icon");
          icon?.setAttribute(
            "onmouseover",
            "this.setAttribute('uid',window.uid);this.setAttribute('ver',window.ver);this.setAttribute('username',window.username);",
          );
        })();
      }
      return ok;
    }

    async GetConfig() {
      const icon =
        document.body.querySelector(".gamebet-collect-float")
        || document.body.querySelector(".esport-collect-provider-icon");
      const uid = icon?.getAttribute("uid") ?? "";
      const ver = icon?.getAttribute("ver") ?? "";
      const username = icon?.getAttribute("username") ?? "";
      const gateway = `https://${location.host}`;
      const token = JSON.stringify({ uid, ver, username });
      const referer = location.href;
      return {
        provider: PLATFORMS.HGA,
        token,
        gateway,
        referer,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.HGA,
            token,
            gateway: [gateway],
            referer,
          }),
        ),
        _hgaMeta: { gateway, uid, ver, username },
      };
    }
  },

  [PLATFORMS.HG]: class HgProvider {
    async Check() {
      const ok =
        document.getElementById("header_currency") !== null &&
        document.getElementById("header_credit") !== null;
      if (ok) {
        void (async () => {
          await sleep(1000);
          const icon =
            document.body.querySelector(".gamebet-collect-float")
            || document.body.querySelector(".esport-collect-provider-icon");
          icon?.setAttribute(
            "onmouseover",
            "this.setAttribute('userdata',JSON.stringify(window.userData));",
          );
        })();
      }
      return ok;
    }

    async GetConfig() {
      const icon =
        document.body.querySelector(".gamebet-collect-float")
        || document.body.querySelector(".esport-collect-provider-icon");
      const userdata = icon?.getAttribute("userdata") ?? "";
      if (!userdata) return undefined;
      const parsed = JSON.parse(userdata);
      const token = JSON.stringify({
        uid: parsed.uid,
        ver: parsed.ver,
        username: parsed.username,
      });
      const gateway = `https://${location.host}`;
      const referer = location.href;
      return {
        provider: PLATFORMS.HG,
        gateway,
        token,
        referer,
        data: btoa(
          JSON.stringify({
            provider: PLATFORMS.HG,
            token,
            gateway: [gateway],
            referer,
          }),
        ),
      };
    }
  },

  [PLATFORMS.Stake]: class StakeProvider {
    async Check() {
      return location.hostname === "stake.com";
    }

    async GetConfig() {
      const session = getCookie("session");
      if (!session) return undefined;
      const payload = {
        provider: PLATFORMS.Stake,
        gateway: `https://${location.host}`,
        token: session,
        referer: location.href,
      };
      return { ...payload, data: btoa(JSON.stringify(payload)) };
    }
  },

  [PLATFORMS.Dex]: class DexProvider {
    async Check() {
      return location.hostname.includes("dexsport");
    }

    async GetConfig() {
      const el = document.documentElement;
      const hash = el.dataset.dexHash;
      if (!hash) return undefined;
      const jwt = el.dataset.dexAccessToken || "";
      const network = localStorage.getItem("main_network_name") || "";
      const currency = localStorage.getItem("main_currency_contract") || "";
      const sportsbookToken = `${hash}_${network}_${currency}_sportsbook`;
      const gateway = "https://prod.dexsport.work";
      const payload = {
        provider: PLATFORMS.Dex,
        gateway,
        token: sportsbookToken,
        hash,
        jwt,
        network,
        currency,
        referer: location.href,
      };
      return { ...payload, data: btoa(JSON.stringify(payload)) };
    }
  },

  [PLATFORMS.Polymarket]: class PolymarketProvider {
    async Check() {
      return location.hostname === "polymarket.com" || location.hostname.endsWith(".polymarket.com");
    }

    async GetConfig() {
      const credentials = getPolymarketCredentials();
      return credentials?.token ? credentials : undefined;
    }
  },
};

export function createProvider(platformId) {
  const Cls = PROVIDER_REGISTRY[platformId];
  return Cls ? new Cls() : null;
}
