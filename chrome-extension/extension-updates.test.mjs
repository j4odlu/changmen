import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createExtensionUpdateChecks, isNewerRelease, validReleaseVersion, RELEASE_STATE_KEY, RELEASE_ALARM } from "./src/background/extension-updates.js";
const release = version => ({ schemaVersion: 1, product: "changmen-chrome-extension", extensionId: "id", version });

function fixture() {
  let time = 1000000, response = { ok: true, json: async () => release("1.3.73") }, requests = 0;
  let archiveResponse = { ok: true, headers: { get: () => "application/zip" } };
  const store = {}, listeners = {}, badges = [], alarms = new Map();
  const hook = name => ({ addListener: fn => { listeners[name] = fn; } });
  const api = {
    runtime: { id: "id", getManifest: () => ({ version: "1.3.72" }), getURL: p => `chrome-extension://id/${p}`,
      onInstalled: hook("installed"), onStartup: hook("startup"), onMessage: hook("message"),
      reload: () => { throw new Error("Must never reload automatically"); } },
    alarms: { get: async name => alarms.get(name), create: async (name, value) => alarms.set(name, value), onAlarm: hook("alarm") },
    action: { setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    storage: { local: { get: async key => ({ [key]: structuredClone(store[key]) }), set: async bag => Object.assign(store, structuredClone(bag)) } },
  };
  const create = () => createExtensionUpdateChecks({ chromeApi: api, now: () => time, fetchFn: async (url, opts) => {
    assert.equal(opts.redirect, "error"); assert.equal(opts.credentials, "omit"); assert.equal(opts.cache, "no-store");
    if (opts.method === "HEAD") {
      assert.match(url, /^https:\/\/changmen\.fun\/esport2\/extensions\/\d+(?:\.\d+)*\.zip$/);
      return archiveResponse;
    }
    requests++;
    assert.match(url, /^https:\/\/changmen\.fun\/esport2\/extensions\/release.json\?t=\d+$/);
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response() : response;
  } });
  return { service: create(), create, store, api, listeners, badges, alarms, requests: () => requests,
    setResponse: r => { response = r; }, setArchive: r => { archiveResponse = r; }, advance: ms => { time += ms; } };
}
test("numeric version comparisons reject downgrade, equality and invalid versions", () => {
  assert.equal(isNewerRelease("1.3.73", "1.3.9"), true);
  for (const version of ["1.3.72", "1.3.72.0", "1.3.71", "../secret", "https://evil.example"]) assert.equal(isNewerRelease(version, "1.3.72"), false);
  for (const version of [null, "99999.1", "1.2.3.4.5", "1.3.72.zip"]) assert.equal(validReleaseVersion(version), false);
});
test("new release sets the icon badge and provides only a fixed-origin ZIP", async () => {
  const f = fixture(), state = await f.service.check();
  assert.equal(state.updateAvailable, true); assert.equal(f.badges.at(-1), "NEW");
  assert.equal(state.downloadUrl, "https://changmen.fun/esport2/extensions/1.3.73.zip");
});
test("same/newer installed release clears the update badge", async () => {
  const f = fixture(); await f.service.check();
  f.setResponse({ ok: true, json: async () => release("1.3.71") });
  const state = await f.service.check(true);
  assert.equal(state.updateAvailable, false); assert.equal(f.badges.at(-1), "");
});
test("temporary failed checks preserve verified releases and expose no raw errors", async () => {
  const f = fixture(); await f.service.check();
  for (const response of [new Error("SECRET credential"), { ok: false }]) {
    f.setResponse(response); const state = await f.service.check(true);
    assert.equal(state.latest, "1.3.73"); assert.equal(state.updateAvailable, true);
    assert.ok(state.error); assert.doesNotMatch(JSON.stringify(state), /SECRET|credential|\.\.\//);
  }
});
test("worker restart respects the stored interval and restores the badge", async () => {
  const f = fixture(); await f.service.check();
  await f.create().check(); assert.equal(f.requests(), 1); assert.equal(f.badges.at(-1), "NEW");
  f.advance(600000); await f.create().check(); assert.equal(f.requests(), 2);
});
test("simultaneous checks share one request", async () => {
  const f = fixture(); let release;
  f.setResponse(() => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ schemaVersion: 1, product: "changmen-chrome-extension", extensionId: "id", version: "1.3.73" }) }); }));
  const first = f.service.check(true), second = f.service.check(true);
  await new Promise(resolve => setImmediate(resolve)); release();
  await Promise.all([first, second]); assert.equal(f.requests(), 1);
});
test("background registers alarms/startup and rejects update requests from content scripts", async () => {
  const f = fixture(); f.service.install(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.alarms.get(RELEASE_ALARM).periodInMinutes, 10);
  const reply = () => { throw new Error("Unauthorized reply"); };
  assert.equal(f.listeners.message({ type: "extensionRelease:check" }, { id: "id", url: "https://changmen.fun/" }, reply), false);
  assert.equal(f.listeners.message({ type: "extensionRelease:check" }, { id: "other", url: "chrome-extension://id/popup.html" }, reply), false);
  const state = await new Promise(resolve => assert.equal(f.listeners.message({ type: "extensionRelease:get" }, { id: "id", url: "chrome-extension://id/sidepanel.html" }, resolve), true));
  assert.equal(state.latest, "1.3.73");
  f.advance(600000); f.listeners.alarm({ name: RELEASE_ALARM }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests(), 2);
  f.listeners.startup(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests(), 3);
});
test("cached download addresses are never trusted", async () => {
  const f = fixture(); f.store[RELEASE_STATE_KEY] = { ...release("1.3.73"), latest: "1.3.73", downloadUrl: "https://evil.example" };
  assert.equal((await f.service.getState()).downloadUrl, "https://changmen.fun/esport2/extensions/1.3.73.zip");
  f.store[RELEASE_STATE_KEY] = null; assert.equal((await f.service.getState()).downloadUrl, "");
});
test("A8, wrong extension and malformed release announcements cannot trigger updates", async () => {
  for (const data of [{ version: "2.0.149" }, { ...release("2.0.149"), product: "A8" },
    { ...release("2.0.149"), extensionId: "a8-plugin-id" }, release("../../secret")]) {
    const f = fixture(); await f.service.check();
    f.setResponse({ ok: true, json: async () => data });
    const state = await f.service.check(true);
    assert.equal(state.latest, ""); assert.equal(state.updateAvailable, false);
    assert.equal(state.downloadUrl, ""); assert.equal(f.badges.at(-1), "");
    assert.match(state.error, /不属于此插件/);
  }
});
test("unpublished metadata clears obsolete unbranded A8 cache rather than offering it", async () => {
  const f = fixture(); f.store[RELEASE_STATE_KEY] = { latest: "2.0.149", checkedAt: 1000000, error: false };
  assert.equal((await f.service.getState()).latest, "");
  f.setResponse({ ok: false, status: 404 });
  const state = await f.service.check();
  assert.equal(f.requests(), 1); assert.equal(state.downloadUrl, "");
  assert.equal(state.updateAvailable, false); assert.equal(f.badges.at(-1), "");
  assert.match(state.error, /尚未发布插件版本公告/);
});
test("missing ZIP or HTML fallback cannot be advertised as a release", async () => {
  for (const archive of [{ ok: false, status: 404 }, { ok: true, headers: { get: () => "text/html" } }]) {
    const f = fixture(); f.setArchive(archive);
    const state = await f.service.check();
    assert.equal(state.downloadUrl, ""); assert.equal(state.updateAvailable, false);
    assert.match(state.error, /有效的插件安装包/);
  }
});
test("popup renders version/download safely and wires a manual check", () => {
  const elements = new Map(); let checks = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { addEventListener: (name, fn) => { elements.get(id)[name] = fn; }, removeAttribute: name => { delete elements.get(id)[name]; } });
    return elements.get(id);
  };
  const state = { latest: "1.3.73", updateAvailable: true, downloadUrl: "https://changmen.fun/esport2/extensions/1.3.73.zip" };
  const api = { runtime: { getManifest: () => ({ version: "1.3.72" }), sendMessage: (msg, reply) => {
    if (msg.type.startsWith("extensionRelease:")) { checks++; reply(state); } else reply({});
  } }, storage: { onChanged: { addListener() {} }, local: { set() {} } } };
  vm.runInNewContext(fs.readFileSync(new URL("./popup.js", import.meta.url), "utf8"), { chrome: api, document: { getElementById: element }, setInterval() {} });
  assert.match(element("updateStatus").textContent, /有新版本/);
  assert.equal(element("downloadUpdate").href, state.downloadUrl);
  element("checkUpdate").click(); assert.equal(checks, 2);
  state.downloadUrl = "javascript:alert(1)"; element("checkUpdate").click();
  assert.equal(element("downloadUpdate").hidden, true); assert.equal(element("downloadUpdate").href, undefined);
});
