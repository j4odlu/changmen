interface ChromeRuntime {
  lastError?: { message?: string };
  sendMessage: (
    extensionId: string,
    message: A8PluginMessage,
    options: Record<string, never>,
    callback: (response?: A8PluginEnvelope) => void,
  ) => void;
  connect?: (
    extensionId: string,
    connectInfo?: { name?: string },
  ) => A8PluginPort | undefined;
}

export interface A8PluginPort {
  name: string;
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (fn: (message: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
}

interface A8PluginMessage {
  type: string;
  uuid: string;
  url?: string;
  data?: unknown;
  options?: {
    tabId?: number;
    headers?: Record<string, string>;
    timeout?: number;
    withCredentials?: boolean;
    platform?: string;
    provider?: string;
    venueMemberId?: string;
  };
}

interface A8PluginEnvelope {
  response?: unknown;
}

let resolveDefaultExtensionId: () => string = () => "mogfpjihgoghabicofkbcmcidlcoofee";

/** web 启动时注入（对齐 gamebetExtensionId） */
export function registerGamebetExtensionIdResolver(fn: () => string): void {
  resolveDefaultExtensionId = fn;
}

function getRuntime(): ChromeRuntime | undefined {
  return (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
}

/** 页面是否可调用 Gamebet / A8 协议扩展（扩展上下文代发 HTTP，可绕过页面 CORS） */
export function hasA8PluginRuntime(): boolean {
  return Boolean(getRuntime()?.sendMessage);
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** content script 写入的实际 ID，优先于构建时默认值 */
export function readDomExtensionId(): string {
  return document.documentElement.dataset.gamebetExtId?.trim() ?? "";
}

export function readDomExtensionVersion(): string {
  return document.documentElement.dataset.gamebetExtVersion?.trim() ?? "";
}

export function resolveGamebetExtensionId(): string {
  const fromDom = readDomExtensionId();
  if (fromDom) {
    localStorage.setItem("gamebet:extensionId", fromDom);
    return fromDom;
  }
  const fromStorage = localStorage.getItem("gamebet:extensionId")?.trim();
  if (fromStorage)
    return fromStorage;
  return resolveDefaultExtensionId();
}

export async function a8PluginSend(message: Omit<A8PluginMessage, "uuid">): Promise<unknown> {
  const runtime = getRuntime();
  if (!runtime?.sendMessage)
    throw new Error("Gamebet 扩展未安装或不可访问");

  const extensionId = resolveGamebetExtensionId();
  return new Promise((resolve, reject) => {
    runtime.sendMessage(extensionId, { ...message, uuid: uuid() }, {}, (envelope) => {
      const lastError = runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message || "Gamebet 扩展通信失败"));
        return;
      }
      if (!envelope) {
        reject(new Error(`未安装 Gamebet 扩展（ID: ${extensionId}）`));
        return;
      }
      resolve(envelope.response);
    });
  });
}

/** 长连接（足球 OB yewuws2）：页面不能直连源站 WS。 */
export function a8PluginConnect(name: string): A8PluginPort | null {
  const runtime = getRuntime();
  if (!runtime?.connect)
    return null;
  try {
    const port = runtime.connect(resolveGamebetExtensionId(), { name });
    return port || null;
  }
  catch {
    return null;
  }
}

export async function a8PluginGetStore(key: string): Promise<unknown> {
  return a8PluginSend({ type: "getStore", data: { key } });
}

export async function a8PluginSetStore(key: string, data: unknown): Promise<void> {
  await a8PluginSend({ type: "setStore", data: { key, data } });
}

export async function a8PluginGet(
  url: string,
  options?: A8PluginMessage["options"],
): Promise<unknown> {
  return a8PluginSend({ type: "GET", url, options });
}

export async function a8PluginPost(
  url: string,
  data: unknown,
  options?: A8PluginMessage["options"],
): Promise<unknown> {
  return a8PluginSend({ type: "POST", url, data, options });
}

export async function a8PluginDelete(
  url: string,
  data: unknown,
  options?: A8PluginMessage["options"],
): Promise<unknown> {
  return a8PluginSend({ type: "DELETE", url, data, options });
}

export interface GamebetExtensionInfo {
  name?: string;
  version?: string;
  extensionId?: string;
  error?: string;
}

function probeFromDom(): GamebetExtensionInfo | null {
  const extensionId = readDomExtensionId();
  const version = readDomExtensionVersion();
  if (!extensionId || !version)
    return null;
  localStorage.setItem("gamebet:extensionId", extensionId);
  return { name: "じらいや", version, extensionId };
}

export async function probeGamebetExtension(): Promise<GamebetExtensionInfo | null> {
  const dom = probeFromDom();
  if (dom)
    return dom;
  if (!hasA8PluginRuntime())
    return null;
  try {
    const info = (await a8PluginSend({ type: "version" })) as GamebetExtensionInfo | null;
    if (!info || (!info.version && !info.name))
      return null;
    info.extensionId = resolveGamebetExtensionId();
    return info;
  }
  catch {
    return null;
  }
}

export async function initGamebetExtension(
  minVersion = 1,
): Promise<GamebetExtensionInfo | undefined> {
  const info = await probeGamebetExtension();
  if (!info)
    return undefined;
  if (info.version) {
    localStorage.setItem("extensionVersion", info.version);
    globalStorageDispatch(info.version);
  }
  const numeric = Number.parseFloat(info.version ?? "");
  if (info.version && !Number.isNaN(numeric) && numeric < minVersion) {
    info.error = `当前版本 ${info.version} 低于要求的最低版本 ${minVersion}`;
  }
  return info;
}

function globalStorageDispatch(version: string) {
  globalThis.dispatchEvent(
    new CustomEvent("gamebet-extension-version", { detail: version }),
  );
}
