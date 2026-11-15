# 全平台：A8 原版与 changmen 对照（采集 / Token / 下注）

> 历史记录：损坏文字依据 Git `069518ce5f67`（`client/web/docs/platforms/A8_COMPARE_ALL_PLATFORMS.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

基于 [`A8/index0706.js`](../../../../A8/index0706.js) 与 changmen 源码检索。**OB / RAY 细节见** [`A8_COMPARE_OB_RAY.md`](./A8_COMPARE_OB_RAY.md)。

---

## 总原则

| 原则 | 说明 |
|------|------|
| 采集凭证 ≠ 下注凭证 | 多数平台：采集读 `Client_GetCollectPlatform`（`platforms.json`）或写死对象；下注读剪贴板 `ACCOUNT` 各账号 `gateway`/`token` |
| `updatePlatform` 极少 | 全 bundle 仅 **OB**（试玩补 token）、**SABA**（页面解析写回）各 1 处 |
| A8 聚合 Socket | **IM / XBet / Stake（实时）** 订阅 `join room`，**不用**场馆 HTTP token 拉赔率 |
| changmen 特殊 | **RAY**：`Client_GetCollectPlatform` 被后端强制为 A8 写死 JWT；**IA**：采集/下注 HTTP 已对齐 A8 `Zn`/`mr.post`（见 [IA.md](IA.md)） |

---

## 一览表

| 平台 | A8 采集 Token | changmen 采集 Token | A8 采集方式 | changmen 采集 | A8 下注 | changmen 下注 |
|------|---------------|---------------------|-------------|---------------|---------|---------------|
| **OB** | `Vt.getPlatform(OB)`；失效时 `$Me` 试玩 API **只写 token** | 同左 + 后端可选 `syncObLogin` 写 gateway+token | HTTP `game/index`+`game/view` + MQTT 固定 relay | 同左（MQTT 走本站 relay） | `yYe`；账号 gateway/token | `obProvider`；剪贴板 `ACCOUNT` |
| **RAY** | 插件内 **写死** JWT + gateway | API 强制 `devtools/platform-probes/ray/collect_credentials.js` 同 JWT | HTTP `/v2/match|odds` + SC→`47.115.75.57` | 同逻辑，WS 经 `ray_http_proxy` | `vYe` `/v2/order` | `rayProvider` |
| **TF** | `Vt.getPlatform(TF)` | `getCollectPlatform` + env `TF_*` | HTTP `/api/v8/events` + 赔率 WS | 同左 | `bYe` `/api/game-client/v8/single-bet/` | `tfProvider` |
| **IA** | 插件内对象：`gateway=ilustre…`，**`token:""`**，固定 games | `iaCollectPlatform()` 硬编码 `t` | HTTP `Zn` + WS `/esport/ws/IA` | 同左；下注 `iaMrPost`（Zn/PROXY） | `CYe` | `iaProvider` |
| **IM** | 无场馆采集 token；Socket 用 `localStorage token` | `socketHub` 同：`localStorage token` | A8 Socket `join room` **IM**；只推赔率 | `startA8BetsCollector` 频道 `IM` | `TZe` | `imProvider` |
| **XBet** | 同 IM（聚合 Socket） | 同左 | 频道 `XBet` + `XBet:Score` | `startA8BetsCollector` | （无独立 Provider 类） | **不下注**（registry `bet:false`） |
| **SABA** | `Vt.getPlatform(SABA)`；解析页后可 `updatePlatform` | `resolveCollectSession` | 拉电竞 HTML → 解析 → 沙巴 WS | 同左 | `AZe` | `sabaProvider` |
| **PB** | `Vt.getPlatform(PB)` + **必须**已登录 PB 账号有余额 | `resolvePbCollectAccount`（仅有余额账号，无 platforms.json） | 账号驱动 `_Ze()` → 扩展 GET | `collectPbGet` → `pbPluginGet` | `PZe` | `pbProvider`（扩展 HTTP + `_Q` + `getOrders`） |
| **IMT** | `Vt.getPlatform(IMT)` + **必须**已登录 IMT 账号 | `resolveCollectSession` | `jQe()` 快照 + Delta 轮询 | `collectImtPost` GetBetInfo | `IZe` | `imtProvider` |
| **Stake** | 插件 `tabId`；Socket 频道 Stake；采集不用 `GetCollectPlatform` | 同 A8（插件 tabId + 频道 `Stake`） | GraphQL 30s + A8 频道 `Stake` | 同左 | `rJe`（需 `tabId` + `account.token`） | `stakeProvider`（对齐 `rJe`） |
| **HG** | 无 `saveMatch` 采集 | 占位日志 | A8 **`SQ`** 跟单循环 | `hg/followLoop`（无赔率采集） | `KZe` `transform.php` | `hgProvider` |

---

## 按平台说明

### OB

- **采集**：`UMe` 内 `s=Xt.OB`，`Vt.getPlatform(s)` → `game/index`；`data==="token"` → `$Me()` → `updatePlatform({provider:OB, token})`。
- **MQTT**：`wss://47.115.75.57/esport/ws/OB`，用户 `admin` / `Qazqaz123...`，**与** platform token **无关**。
- **changmen**：已对齐试玩直连 `djtop-capi`；见 [`OB.md`](./OB.md)。

### RAY

- **采集**：`vQe` 内字面量 `t`（`cfinfo.365raylinks.com` + Bearer JWT + 固定 `games`），**不**调用 `getPlatform(RAY)`。
- **changmen**：`getCollectPlatform("RAY")` 被 `router.js` 替换为 `getRayA8CollectCredentials()`。
- 详见 [`RAY.md`](./RAY.md)、[`A8_COMPARE_OB_RAY.md`](./A8_COMPARE_OB_RAY.md)。

### TF

- **采集**：`Uf=Xt.TF`，`UBe` → `Vt.getPlatform(Uf)`；REST 30s + `FBe`/`WBe` WS；HTTP 头 `$3(token)`。
- **凭证**：`POST …/esport/Client_GetCollectPlatform`（**form-urlencoded** + header `token`）→ `Gateway` / `Token` / `BetName`；`Client_GetGames` → `games`。`tf-authorization` 本地算；`public-token` 为 bundle 常量。
- **下注**：`bYe` — 钱包/下单用 `ly`（无 `tf-authorization`）；订单 `ly(,true)` 合并 `$3`；`uy` 将 transactions 的 gateway `api.` → `api-v4.`。
- **changmen**：`getTfA8CollectCredentials()` + `client/packages/venue-browser/adapter/tf/*` + `tfProvider`。**详解**：[`A8_TF_LOGIC_PARITY.md`](./A8_TF_LOGIC_PARITY.md)。

### IA

- **A8 `wQe` / `CYe`**：采集 `t` 写死 ilustre + 空 token；HTTP 经 **Zn**；WS 直连 `47.115.75.57`；下注经 **`mr.post` + `Cr.http`**（无 proxyId → Zn；有 proxyId 的余额/playMore → PROXY）。
- **changmen**：`a8Collect.ts` + `transport.ts`（Zn）+ `realtime.ts` + `bet_transport.ts`（`iaMrPost`）+ `bet.ts`。**已对齐** bundle 路由与盘口规则。
- **差异 [changmen 扩展]**：`saveMatch`/`saveBets` 上报；PROXY 落本站 `/esport/http-relay`。
- **运维**：`47.115.75.57/esport/ws/IA` 上游不可用时 WS 重连失败，HTTP 轮询仍可工作。详见 [IA.md](./IA.md)。

### IM / XBet（A8 频道）

- **A8**：全局 Socket（`ou.io`）连接后 `emit("join room", Xt.IM | Xt.Stake | Xt.XBet | "XBet:Score")`；`extraHeaders.token = localStorage.getItem("token")`（A8 登录 JWT，**非** IM 场馆 token）。
- **赔率**：如 `EZe` 类逻辑只 `oddsStore.save`，`homeSuffix` 1/2（XBet away 为 3）。
- **changmen**：`client/packages/venue-browser/adapter/shared/socket/*` + `@/chrome-plugin/bridge.ts`；IM 见 [`IM.md`](./IM.md)，XBet 见 [`XBet.md`](./XBet.md)。

### SABA

- **采集**：`getPlatform(Xt.SABA)` → `${gateway}/${token}/ESports/43/ALL?...` 拉页面；插件 `Zn.get`；解析后连沙巴 WS。
- **changmen**：`resolveCollectSession` + `saba/core` 解析；无账号时 `odds.clean(SABA)`。

### PB

- **采集 `AQ`**：`Oi=Xt.PB`，`getPlatform(Oi)`，且 `Io().accounts` 中须有 `provider===PB` 且 `balance!==undefined`；否则 `clean(PB)`。
- **changmen**：`resolvePbCollectAccount` 与 A8 `bv` 一致，**仅** `balance!==undefined` 的 PB 账号；HTTP 走 `client/chrome-extension`（`Zn`）。详见 [`A8_PB_LOGIC_PARITY.md`](./A8_PB_LOGIC_PARITY.md)。

### IMT

- **采集 `Pee`**：`ei=Xt.IMT`，`getPlatform(ei)` + 已登录 IMT 账号；周期 `jQe()` → `saveMatch`/`saveBets`（60s）。
- **changmen**：`resolveCollectSession` + `collectImtPost`；同样依赖 gateway/token（及 x-sc 等头）。

### Stake

- **采集 `MQ`**：`ra=Xt.Stake`；等待插件 `tabId`（10×3s）→ 各 sport GraphQL → `saveMatch` + 逐场 `saveBets`（`pp` 合并）→ `Zn.sendMessage` 订阅；频道 **Stake** 推实时赔率；30s 递归。
- **changmen**：`startA8BetsCollector` 频道 `Stake`；`client/packages/venue-browser/adapter/stake/collect.ts` 对齐 `MQ`。
- **下注**：插件 `tabId` + 账号 `token`；`client/packages/venue-browser/adapter/stake/bet.ts` 对齐 `rJe`。

### HG

- **A8**：无电竞赔率采集器；`fB=Xt.HG`，`KZe` 下注走 `transform.php`；**`SQ`** 为跟单而非 `saveMatch`。
- **changmen**：`hg/index.ts` 仅占位提示；跟单见 `hg/followLoop.ts`。

---

## 下注 Token（全平台共性）

| 步骤 | A8 | changmen |
|------|-----|----------|
| 粘贴账号 | `AccountInfoView`：`atob` → JSON `{ provider, token, referer, gateway[] }` | `AccountEditDialog.vue` 同格式 |
| 存储 | `Vt.saveData("ACCOUNT", …)` | `accountStore` / `ACCOUNT` KV |
| 请求 | `mr.post/get(this.account, …)` 用 **账号** 的 gateway、token、referer | `platformHttp` / 各 `*Provider` |

**Stake / HG** 另需插件或皇冠专用参数（`tabId`、`transform.php` ver 等），不用通用采集 JWT。

---

## A8 Provider 类 ↔ 平台（bundle 内 `extends Lu`）

| 类名 | 平台 | 备注 |
|------|------|------|
| `yYe` | OB | `/game/member/heartbeat` |
| `vYe` | RAY | `/v2/order` |
| `bYe` | TF | `/api/game-client/v8/single-bet/` |
| `CYe` | IA | |
| `TZe` | IM | |
| `AZe` | SABA | |
| `PZe` | PB | `member-service/v2` |
| `IZe` | IMT | `mobilesitev2/api` |
| `KZe` | HG | `fB=Xt.HG` |
| `rJe` | Stake | 需 `qs.tabId` |

---

## changmen 后端 `platform_sync`（启动写 platforms.json）

| 平台 | 来源 |
|------|------|
| OB | `syncObFromSession` / `syncObLogin` |
| RAY | **`syncRayFromA8()`**（写死 JWT） |
| PB / TF / IA / IMT / SABA | env 或各 feed `session` |
| IM / XBet | `A8_WS_URL` + `A8_SOCKET_TOKEN`（占位） |
| Stake | `STAKE_ACCESS_TOKEN` 等 |
| HG | `HG_GATEWAY` + `HG_TOKEN` |

见 [`server/backend/core/esport-api/platform_sync.js`](../../../../server/backend/core/esport-api/platform_sync.js)。

---

## 代码索引（changmen）

| 能力 | 路径 |
|------|------|
| 采集注册 | [`client/packages/venue-browser/adapter/registry/adapters.ts`](../../../../client/packages/venue-browser/adapter/registry/adapters.ts) |
| 平台能力 | [`client/packages/venue-browser/adapter/registry/`](../../../../client/packages/venue-browser/adapter/registry/) |
| A8 频道 | [`client/packages/venue-browser/adapter/shared/socket/`](../../../../client/packages/venue-browser/adapter/shared/socket/) |
| 采集 API | [`api/esport.ts`](../../src/api/esport.ts) → `Client_GetCollectPlatform` |
| 后端采集凭证 | [`esport-api/router.js`](../../../../server/backend/core/esport-api/router.js) `Client_GetCollectPlatform` |
| 下注 | [`providers/index.ts`](../../../packages/venue-browser/adapter/registry/adapters.ts) |
| 账号粘贴 | [`components/account/AccountEditDialog.vue`](../../src/components/account/AccountEditDialog.vue) |

---

*A8 以 `A8/index0706.js` 为准；changmen 变更时请同步各平台 `docs/*.md` 与本文件。*
