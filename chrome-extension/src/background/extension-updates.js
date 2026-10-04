/** [changmen 扩展] 插件自行检查发布版本；只提示/下载，不自动重载或安装。 */
export const RELEASE_STATE_KEY = "changmenExtensionRelease";
export const RELEASE_ALARM = "changmen-extension-release";
export const RELEASE_PRODUCT = "changmen-chrome-extension";
const RELEASE_ORIGIN = "https://changmen.fun";
const CHECK_INTERVAL = 10 * 60 * 1000;

export function validReleaseVersion(value) {
  return typeof value === "string" && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(value)
    && value.split(".").every(part => Number(part) <= 65535);
}
export function isNewerRelease(latest, installed) {
  if (!validReleaseVersion(latest) || !validReleaseVersion(installed)) return false;
  const a = latest.split(".").map(Number), b = installed.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export function createExtensionUpdateChecks({ chromeApi = globalThis.chrome, fetchFn = globalThis.fetch, now = Date.now } = {}) {
  const current = chromeApi.runtime.getManifest().version;
  const identity = { schemaVersion: 1, product: RELEASE_PRODUCT, extensionId: chromeApi.runtime.id };
  const belongsToThisExtension = record => record?.schemaVersion === identity.schemaVersion
    && record.product === identity.product && record.extensionId === identity.extensionId;
  let inFlight;
  function view(record = {}) {
    if (!record || typeof record !== "object") record = {};
    const trusted = belongsToThisExtension(record);
    const latest = trusted && validReleaseVersion(record.latest) ? record.latest : "";
    const errors = {
      unpublished: "服务器尚未发布插件版本公告，请稍后检查",
      identity: "服务器返回的版本信息不属于此插件，请联系管理员",
      package: "服务器尚未发布有效的插件安装包，请稍后检查",
    };
    return { current, latest, updateAvailable: isNewerRelease(latest, current),
      downloadUrl: latest ? `${RELEASE_ORIGIN}/esport2/extensions/${latest}.zip` : "",
      checkedAt: trusted && Number.isFinite(record.checkedAt) ? record.checkedAt : 0,
      error: record.error ? (Object.hasOwn(errors, record.error) ? errors[record.error] : "暂时无法检查插件新版本，请稍后重试") : "" };
  }
  async function getState() {
    const bag = await chromeApi.storage.local.get(RELEASE_STATE_KEY);
    return view(bag?.[RELEASE_STATE_KEY]);
  }
  async function badge(state) {
    await chromeApi.action?.setBadgeText({ text: state.updateAvailable ? "NEW" : "" });
    if (state.updateAvailable) await chromeApi.action?.setBadgeBackgroundColor({ color: "#d97706" });
    await chromeApi.action?.setTitle({ title: state.updateAvailable ? `じらいや：可更新至 ${state.latest}` : `じらいや ${current}（侧边栏）` });
  }
  async function check(force = false) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const previous = await getState();
      const age = now() - previous.checkedAt;
      if (!force && previous.checkedAt && age >= 0 && age < CHECK_INTERVAL) {
        await badge(previous); return previous;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let record;
      try {
        const response = await fetchFn(`${RELEASE_ORIGIN}/esport2/extensions/release.json?t=${now()}`, {
          cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal,
        });
        if (!response.ok) throw Object.assign(new Error("Release unavailable"), { code: response.status === 404 ? "unpublished" : "unavailable" });
        const data = await response.json();
        if (!belongsToThisExtension(data) || !validReleaseVersion(data?.version))
          throw Object.assign(new Error("Invalid release"), { code: "identity" });
        const downloadUrl = `${RELEASE_ORIGIN}/esport2/extensions/${data.version}.zip`;
        const archive = await fetchFn(downloadUrl, { method: "HEAD", cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
        if (!archive.ok || !/^(?:application\/zip|application\/x-zip-compressed|application\/octet-stream)(?:;|$)/i.test(archive.headers?.get("content-type") || ""))
          throw Object.assign(new Error("Archive unavailable"), { code: "package" });
        record = { ...identity, latest: data.version, checkedAt: now(), error: false };
      } catch (error) {
        const code = ["identity", "package", "unpublished"].includes(error?.code) ? error.code : "unavailable";
        record = { ...identity, latest: code === "unavailable" ? previous.latest : "", checkedAt: now(), error: code };
      } finally { clearTimeout(timeout); }
      await chromeApi.storage.local.set({ [RELEASE_STATE_KEY]: record });
      const state = view(record);
      await badge(state);
      return state;
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  async function ensureAlarm() {
    if (!await chromeApi.alarms.get(RELEASE_ALARM))
      await chromeApi.alarms.create(RELEASE_ALARM, { periodInMinutes: 10 });
  }
  function install() {
    const run = force => { void check(force).catch(() => {}); };
    chromeApi.runtime.onInstalled.addListener(() => { void ensureAlarm().catch(() => {}); run(true); });
    chromeApi.runtime.onStartup.addListener(() => { void ensureAlarm().catch(() => {}); run(true); });
    chromeApi.alarms.onAlarm.addListener(alarm => { if (alarm.name === RELEASE_ALARM) run(false); });
    chromeApi.runtime.onMessage.addListener((message, sender, reply) => {
      if (!["extensionRelease:get", "extensionRelease:check"].includes(message?.type)) return false;
      // 仅插件自己的界面可触发检查；网页/内容脚本不能指定下载地址或刷检查请求。
      if (sender.id !== chromeApi.runtime.id || !sender.url?.startsWith(chromeApi.runtime.getURL(""))) return false;
      const request = message.type === "extensionRelease:check" ? check(true) : getState();
      void request.then(reply, () => reply({ current, error: "暂时无法检查插件新版本，请稍后重试" }));
      return true;
    });
    void ensureAlarm().then(() => check()).catch(() => {});
  }
  return { check, getState, install };
}
