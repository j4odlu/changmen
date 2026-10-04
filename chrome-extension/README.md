# Gamebet Chrome 扩展（复刻 A8 插件）

changmen 前端通过 `chrome-plugin/bridge.ts` 与扩展通信，协议对齐 A8 的 `Zn`（`GET` / `POST` / `getStore` / `setStore` / `setTab` / `version` / `proxy`）。

Mode P 启动：`BAT\dev.bat parity` 或 `BAT\dev.bat`（浏览器 + 插件）。

## 固定扩展 ID

```
mogfpjihgoghabicofkbcmcidlcoofee
```

与 `client/web/src/config/gamebetExtension.ts` 中 `GAMEBET_EXTENSION_ID_DEFAULT` 一致。

## 安装

### Chrome / Edge（浏览器模式）

1. Chrome 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 执行 `npm run build`
4. 「加载已解压的扩展程序」→ 选择本目录 `changmen/chrome-extension`
5. 确认扩展 ID 为 `mogfpjihgoghabicofkbcmcidlcoofee`
6. 启动 changmen 前端（`client/web`），PB / Stake / v4 等会经扩展代发 HTTP
7. Stake：在同一 Chrome 配置文件中打开 `stake.com`，扩展会自动 `setTab`

## 功能（与 A8 一致）

| 能力 | 说明 |
|------|------|
| **跨域 HTTP** | 页面 `chrome.runtime.sendMessage` → 扩展 background 用 **axios** 代发（与 A8 `ht.request` 一致） |
| **标签页代发** | 带 `options.tabId` 时转发到 Stake 等标签页的 content script（GraphQL + WebSocket） |
| **凭证采集** | 在 PB / OB / RAY / IM 等站点登录后，页面顶部浮动图标 → 复制 Base64 凭证到 changmen 账号 |
| **ModifyHeader** | 外部页面经 `setStore` 写入 `{ key: "ModifyHeader", data: [{ UrlPattern, UserAgent }] }`，background 用 DNR 改写 UA |
| **Stake WS 重连** | graphql-transport-ws 断线自动重连 + ping |
| **Stake 实时赔率** | WS next → background `stake-odds` 端口 → 前端写 `fo`（替代 A8 `47.115.75.57`） |
| **Stake tabId** | 打开 `stake.com` 后自动 `setTab`，供采集/下注使用 |
| **Polymarket 凭证采集** | 登录 `polymarket.com` 后按需读取 storage 中可见的 API 凭证片段、钱包/资金地址，右上角图标复制到 changmen 账号 |

当前版本 **1.3.74**：content / background 均已可读化打包，协议对齐 A8 2.0.149（本地对照 `A8/A8插件/`）；常规设置使用 `storage.local`，PM 解锁会话仅使用 `storage.session`（无 sync）。

[changmen 扩展] PM 身份核验在生产固定访问 `https://api.changmen.fun/auth/pm-wallet-identity`，与网页登录的 HttpOnly Cookie 使用同一主机；开发使用受信任网页的同源 `/auth` 代理。API 地址不接受网页消息覆盖。缺少登录凭证不会误报为会话撤销，也不会向网页返回缓存私钥；明确撤销仍清空插件缓存。

[changmen 扩展] RAY 凭证检测兼容 `socketcluster.authToken.<服务器域名>`，保留原有 `gameAuthToken` / `socketCluster.authToken` / `userToken.JWT` 的读取优先级。

[A8 可证实] RAY 从 `https://api.365raylinks.com/configv4?platform=1` 的 `data.game_api` 动态获取网关；面板显示首个网关，Base64 数据保留网关数组供快速填充选择。[changmen 扩展] 已带 Bearer 的 token 避免重复前缀，配置获取失败时提示重试。

[changmen 扩展] 当前 RAY 官网（2026-10-03 `app.3d3117bb.js`）删除 storage 的 `gameAuthToken`，`/user` 改用 Vue `gameAccount.authToken`；点击时通过 MAIN world 读取此 HTTP 会话。SocketCluster 会话不能直接视为 HTTP token，复制前以 `/v2/user` 验证，并优先输出验证成功的官网网关；失败不生成凭证数据。

## 目录结构

```
chrome-extension/
  manifest.json       # MV3，含固定公钥 key
  dist/                 # esbuild 输出；gitignore，不手改
  src/background/       # background + ModifyHeader（DNR）
  src/content/          # content 可读实现（见 src/content/README.md）
  src/content/page-hooks/ # manifest world:MAIN 注入脚本
  scripts/build.mjs     # 打包 src → dist/ + dist/version.json
  assets/               # 图标与 content 样式
  sidepanel.html        # Side Panel 观测面板（点击图标打开）
  popup.html / popup.js # 面板逻辑（sidepanel 复用 popup.js）
```

## 开发

```bash
cd changmen/chrome-extension
npm run build               # 打包 dist/background.js、dist/content.js、dist/version.json
npm run pack                # build + 生成 dist/gamebet-chromeplug-v*.zip（发给朋友）
npm run icons               # 重新生成占位图标
```

仓库根目录也可：`npm run chromeplug:pack`（输出在 `changmen/dist/`）。

[changmen 扩展] 打包成功后同时生成 `server/backend/public/extensions/{version}.zip` 、专用公告 `server/backend/public/extensions/release.json` 和兼容公告 `server/backend/public/version.json`，ZIP 内含安装更新说明。版本检测与下载入口仅在插件内：浏览器启动、插件安装/更新及每十分钟检查专用公告 `https://changmen.fun/esport2/extensions/release.json`（校验产品名、扩展 ID 和公告格式版本，并用 HEAD 确认 ZIP 可下载）；有新版时插件图标显示 `NEW`，点击图标打开侧边栏查看版本、下载 ZIP 和更新步骤。侧边栏提供手动检查，打开时也会检查。网页不显示插件更新入口；插件不自动覆盖文件、不自动重载，不会因发现新版打断挂机或清理 PM 会话。更新到 1.3.73 时清除旧版未绑定插件身份的公告缓存，避免把 A8 版本误报为此插件的新版本；公告缺失或身份不匹配时不展示下载入口。首次安装仍需手动分发。

发布时须同步部署下载 ZIP、专用公告 release.json 和兼容公告 version.json（下载包被 Git 忽略，不会随普通 Git 推送上传）；只部署网页不等于发布插件。新版本必须先修改 manifest/package 版本号，再执行打包。用户下载后需覆盖原插件目录并在 Chrome 中重新加载；网页不自动安装插件。

Windows：在仓库根目录执行 `npm run chromeplug:pack`，或双击 `BAT\dev.bat` 后于 `changmen/` 运行该命令。

前端启动时会调用 `initGamebetExtension()`（`pluginBridge.ts`），将扩展版本写入 `localStorage.extensionVersion`，侧边栏 `ExtensionsBadge` 会显示该版本。

修改 `src/content/` 或 `src/background/` 后执行 `npm run build`。`dist/` 是生成物，不进 git；不再依赖 minified A8 bundle。

## 与 A8 官方插件区别

| 项 | A8 官方 | chrome-extension |
|----|---------|-------------------|
| 扩展 ID | `phnhdoaolljdeohmagpngbijbjbiecde` | `mogfpjihgoghabicofkbcmcidlcoofee` |
| 名称 | 电竞预测大师 | gamebet / じらいや |
| 协议 | Zn 消息 | 相同（含 ModifyHeader / setStore）；setTab 响应含 `value`/`tabId` |
| 采集挂载 | 任意 frame，全量馆 Check | **同左**（已对齐）；另保留 OB 体育 / Polymarket / Dex |
| OB 体育凭证 | 无 | 有（商户壳 `token+api+sessionId`；官网试玩 `token` + sessionStorage） |
| Stake | setTab + GraphQL WS + 推 A8 聚合机 | setTab + GraphQL WS **同 A8**；增量经扩展端口写 fo，**不连** `47.115.75.57` |
| ModifyHeader | webRequest 改 UA | MV3 **declarativeNetRequest**（能力等价） |
| 存储 | `storage.sync` | `storage.local`（Electron/MV3 兼容；键形状同 A8） |

可与 A8 官方插件**同时安装**，互不冲突。

## PB 使用提示

1. 浏览器登录 PB 站点：
   - 旧平博电竞：`*/compact/sports/*` 或 `*/esports-hub/*`
   - ps3838 等复刻站：`*/sports/*`（需已登录；游客不挂图标）
2. 点击顶部浮动图标 →「确认」复制 Base64
3. 在 changmen 账号编辑里粘贴凭证

凭证格式见后端 `account/clipboard_credential.js`。
ps3838 登录态为无后缀 `BrowserSessionId` / `custid`，以及顶层 `token` 中的 `X-Browser-Session-Id` / `X-Custid`。

## Polymarket 使用提示

1. 浏览器登录 `polymarket.com`
2. 手动打开账户页或交易页，让网页把账户相关信息写入本地 storage
3. 点击顶部浮动图标 → 复制 `数据` 或 `token` 到 changmen 账号设置

说明：为避免影响 Polymarket 登录，插件不再改写网页 `fetch`/XHR；官方 CLOB API 的 `secret` 不一定会出现在 storage 里，缺失时需要通过官方 API/SDK 生成后手动填入账号 Token。
