# OB / RAY：A8 原版与 changmen 对照

> 全平台总表见 [`A8_COMPARE_ALL_PLATFORMS.md`](./A8_COMPARE_ALL_PLATFORMS.md)。

本文档记录 **Token 获取**、**数据采集**、**下注** 三条链路在 A8 原版前端与 changmen 复刻中的实际实现（基于源码检索）。

> **Parity 基线**：A8 前端 bundle 可证实行为。changmen 后端/Node Feed 为反推或扩展，见 [../../docs/README.md](../../docs/README.md#项目共识)、[../../docs/A8_OB_REPLICATE_PLAN.md](../../docs/A8_OB_REPLICATE_PLAN.md)。

| 参考源（只读） | changmen 实现 |
|----------------|----------------|
| [`../../../../A8/index0706.js`](../../../../A8/index0706.js) | 前端：[`../ob/`](../ob/)、[`../ray/`](../ray/)、[`../../providers/`](../../providers/) |

---

## 总览：采集凭证 ≠ 下注凭证

两个平台在 A8 与 changmen 中均存在 **两套独立凭证**：

| 用途 | OB | RAY |
|------|-----|-----|
| **采集** | 常态从 A8 服务端 `Client_GetCollectPlatform` 读 `Gateway` + `Token`；失效时用试玩 API 补 `token` | A8：**写死**在采集插件内；changmen：调 API，但后端 **强制返回**与 A8 相同的写死 JWT |
| **下注** | 剪贴板 Base64 账号 → `ACCOUNT` → 各账号 `gateway` + `token` | 同左 |

采集 **不会** 自动使用下注账号的 token（除非 OB 经试玩 API 写回后与账号恰好相同）。

---

# OB 平台

## 1. Token 获取

### A8 原版

| 场景 | 实现 | 说明 |
|------|------|------|
| **采集（常态）** | `Vt.getPlatform(Xt.OB)` → `Client_GetCollectPlatform` | 每轮从 A8 服务器读 `Gateway`、`Token`、`BetName`、游戏列表 |
| **采集（补货）** | 函数 `$Me()` | 仅当 `game/index` 返回 `status==="false"` 且 `data==="token"` 时调用 |
| **试玩 API** | 常量 `gY` = `https://djtop-capi.v662n.com/cApi/v2/member/login?merchant=6107384714184464&demo=1` | `Rr.get(gY)` → 从 `data.pc` URL 解析 `?token=` → `Vt.updatePlatform({ provider: Xt.OB, token })`（**只写 token，不写 gateway**） |
| **UI「试玩」** | `UserCollectView` 内 `u(d)` | 同样 `Rr.get(gY)`，仅 `window.open(h.data.pc)`，**不** `updatePlatform` |
| **启动时** | 无 | **不** 在采集启动时调用 `$Me()` |
| **下注** | `AccountInfoView` 剪贴板 | `atob` → JSON `{ provider, token, referer, gateway[] }` → 写入 `ACCOUNT` |

全 bundle 检索：`updatePlatform({ provider: Xt.OB, ... })` **仅 1 处**（`$Me` 内）。

### changmen

| 场景 | 实现 | 说明 |
|------|------|------|
| **采集（常态）** | `getCollectPlatform("OB")` → `Client_GetCollectPlatform` | 读 `platforms.json`（与 A8 同 API 语义） |
| **采集（补货）** | `refreshObCollectToken()`（[`ob/helpers.ts`](../ob/helpers.ts)） | 条件与 A8 相同：`game/index` + `data === "token"` |
| **试玩 API** | `OB_DEMO_LOGIN_URL`（[`api/v4.ts`](../../api/v4.ts)） | 与 A8 相同：**浏览器直连** `gY`（不经 `/api/ob/demo-login`） |
| **UI「试玩」** | `enterCreditPlate("OB")` → `fetchObDemoUrl()` | 直连试玩 URL → 确认后 `window.open(pc)` |
| **后端扩展** | `ensurePlatformCredentials()` → `syncObLogin()` | 启动时可用试玩 API 写入 **gateway + token** 到 `platforms.json`（**A8 前端采集器无此步骤**） |
| **下注** | [`AccountEditDialog.vue`](../../components/account/AccountEditDialog.vue) | 与 A8 `AccountInfoView` 相同：剪贴板 Base64 → `ACCOUNT` |

后端仍保留 `GET /api/ob/demo-login`（[`server.js`](../../../backend/server.js)），供 `ob_session.js`、探针脚本使用；**Vue 采集与试玩 UI 已不对接该代理**。

### OB Token 对照

| 项目 | A8 | changmen |
|------|-----|----------|
| 采集常态来源 | A8 服务端配置 | 同左 |
| 试玩请求方式 | 浏览器直连 `djtop-capi` | 同左（已对齐） |
| 试玩写回字段 | 仅 `token` | 仅 `token` |
| 下注来源 | 剪贴板账号 | 同左 |

---

## 2. 数据采集

### A8 原版（插件 `UMe`）

```text
waitForUser
  → Vt.getPlatform(OB)                    # Gateway + Token
  → GET {gateway}/game/index?game_id=0&flag=1&day=1
      Header: Ak(d) = { device:"1", lang:"cn", token }
  → 若 data==="token" → await $Me() → return，下轮再 getPlatform
  → 过滤：Client_GetGames 游戏 ID + start_time < now+3600s
  → saveMatch
  → 每场 GET {gateway}/game/view?match_id=&stage_id=
  → saveBets（BetName 正则 platform.betName）
  → MQTT wss://47.115.75.57/esport/ws/OB（固定 admin / Qazqaz123...，不用 platform token）
  → syncObLiveTimer → game/getTimer
  → wait(30s) 循环
```

| 项 | 值 |
|----|-----|
| HTTP 客户端 | `Rr.get` 直连 OB `gateway` |
| MQTT | 主机 `47.115.75.57`，路径 `/esport/ws/OB` |
| 队徽 | CDN `uphw-cdn4.shudarong.com` → `pc.json` + `${base}/${path}` |

### changmen（[`ob/index.ts`](../ob/index.ts)）

**部署**（见 [A8_OB_REPLICATE_PLAN.md](../../docs/A8_OB_REPLICATE_PLAN.md)）：比赛列表来自浏览器 `saveMatch` → matcher → `Client_GetMatchs`。服务端 FeedHub 已删除（2026-06）。

```text
startObCollector（约 3s 后 connectObMqtt）
  → getCollectPlatform(OB)
  → collectObGet → directGet 直连 gateway（ob/http.ts）
  → game/index 失败且 data==="token" → refreshObCollectToken()
  → 前端静态 venueGames 过滤 + buildMatchesFromList → saveMatch（CollectConfig 开时）
  → 顺序每场：unsub → loadMarketsForMatch → saveBets → sub
  → fo.save + MQTT：/esport/ws/OB（经本地 relay，凭据 admin）
  → syncObLiveTimer → fetchMatches
  → wait(30s)
```

| 项 | A8 [可证实] | changmen 现状 | 分类 |
|----|-------------|---------------|------|
| 列表/盘口 API | `game/index`、`game/view` | 同左 | 已对齐 |
| saveMatch | 每轮 UMe | 每轮 `saveMatch` | 已对齐 |
| saveBets + fo | 有 | 有 | 已对齐 |
| HTTP | 直连 gateway | `directGet` | 已对齐 |
| MQTT 入口 | `47.115.75.57` | 本站 `/esport/ws/OB` → relay | 路径 [changmen 扩展] |
| 轮询周期 | 30s | 30s | 已对齐 |
| 开赛过滤 | now+3600s（秒） | 同左 | 已对齐 |
| 灌盘并发 | 顺序 | 顺序 `for...of` | 已对齐 |
| MQTT fo handler | 仅 `/market/oddsUpdate|statusUpdate|suspended` | 同左；`/odd/*` 订阅无 handler | 已对齐 |

详细模块见 [OB.md](./OB.md)。

---

## 3. 下注

### A8 原版

- Provider 类：bundle 内 OB 专用逻辑（`game/balance` 取 `uid`，`secret_key` = md5 等）。
- 使用 **`this.account`**（`ACCOUNT` 剪贴板），**不**读采集配置里的 token。
- 典型接口：`/game/balance`、`/game/view`（验盘）、`POST /game/bet`（`Ma.stringify` 表单）。

### changmen

- [`providers/obProvider.ts`](../../providers/obProvider.ts)：对齐 A8 的 `uid`、`secret_key`、`/game/bet` 表单结构。
- 经 `packages/venue-adapter/ob/accountHttp.ts` 的 `accountGet` / `accountPostForm`（底层仍复用通用 http-relay）。
- 离线契约（无需账号）：`npm run test:ob-provider`（或 `npm run test:ob` 含 GetMatchs 形态校验）。

| 项目 | A8 | changmen |
|------|-----|----------|
| 凭证 | `ACCOUNT` 账号 | 同左 |
| 与采集 token 关系 | 无自动同步 | 同左 |
| live 验收 | 双击 BetRow 下单 | 同左（需粘贴有效 OB 账号） |

---

# RAY 平台

## 1. Token 获取

### A8 原版

| 场景 | 实现 | 说明 |
|------|------|------|
| **采集** | 插件 `vQe`（vendor 格式化后或为 `bQe = () => { ... }`）内 **字面量对象 `t`** | `gateway: https://cfinfo.365raylinks.com`，固定 `Bearer …` JWT，`betName: ^获胜者$`，`games: ["70","151","140","74","37197927"]` |
| **采集 API** | **不调用** `Vt.getPlatform(RAY)` / `Client_GetCollectPlatform` | 全 bundle：`updatePlatform({ provider: Xt.RAY })` **0 次** |
| **试玩 / 登录 API** | **无** | RAY 无类似 OB `demo=1` 的采集补 token |
| **下注** | `AccountInfoView` 剪贴板 | 同 OB：`provider, token, referer, gateway[]` → `ACCOUNT` |

### changmen

| 场景 | 实现 | 说明 |
|------|------|------|
| **采集** | `getCollectPlatform("RAY")` | 后端 [`router.js`](../../../backend/core/esport-api/router.js) 对 RAY **忽略** `platforms.json` 中的 token，强制 [`collect_credentials.js`](../../../../devtools/platform-probes/ray/collect_credentials.js)（与 A8 bundle **相同** gateway + JWT） |
| **启动同步** | `syncRayFromA8()` | 将同一套凭证写入 `platforms.json`（便于探针；API 仍强制 A8 凭证） |
| **环境变量** | `RAY_COLLECT_USE_ENV=1` | 可用 `RAY_TOKEN` / `RAY_GATEWAY` 覆盖（**非 A8 行为**） |
| **下注** | `AccountEditDialog` 剪贴板 | 同 A8 → `rayProvider` 使用 `account.token` |

### RAY Token 对照

| 项目 | A8 | changmen |
|------|-----|----------|
| 采集 JWT | Bundle 写死 | API 返回，内容与 A8 写死相同 |
| 下注 JWT | 剪贴板账号 | 同左 |
| 采集是否读服务端 | 否 | 是（但被后端覆盖为写死值） |

---

## 2. 数据采集

### A8 原版（`vQe`）

```text
waitForUser
  → 写死 t.gateway + t.token + t.games
  → SocketCluster：hostname 47.115.75.57, port 443, path /esport/ws/RAY
  → 订阅 channel "match"，处理 source==="odds"
  → GET {gateway}/v2/match?match_type=2&page=1
      Header: { Authorization: t.token }
  → 过滤：t.games（写死）+ start_time < now+3600s
  → saveMatch
  → 每场 GET {gateway}/v2/odds?match_id=
  → 正则 ^获胜者$ → saveBets + fo 缓存
  → wait(30s) 循环
```

### changmen（[`ray/index.ts`](../ray/index.ts)）

```text
startRayCollector
  → RAY_A8_COLLECT（a8Collect.ts，对齐 bQe 内联 t）
  → SocketCluster：dev relayWsUrl /esport/ws/RAY；生产 location.host + /esport/ws/RAY
      → 后端 ray_http_proxy → wss://cfsocket.365raylinks.com/socketcluster/
  → collectRayGet /v2/match、/v2/odds（ray/http.ts 直连 gateway）
  → 写死 5 个 gameId + betName ^获胜者$ → saveMatch + saveBets（空盘也写）
  → WS match 频道 source=odds → fo.save
  → wait(30s)
```

| 项 | A8 | changmen |
|----|-----|----------|
| HTTP 路径 | `/v2/match`、`/v2/odds` | 同左 |
| Authorization | `Bearer …` | 同左（`ray/http.ts`） |
| 游戏 ID | 写死 5 个 | 同左（`RAY_A8_COLLECT.games`） |
| WebSocket | 浏览器 → `47.115.75.57/esport/ws/RAY` | dev backend relay；生产同源 relay |
| 队徽 CDN | `statics.freestaticsasia.com` | 同左（`rayLogo`） |

详细模块见 [RAY.md](./RAY.md)。后端 WS 说明见 [`devtools/platform-probes/ray/ws.js`](../../../../devtools/platform-probes/ray/ws.js)、[`proxy/ray_http_proxy.js`](../../../backend/proxy/ray_http_proxy.js)。

---

## 3. 下注

### A8 原版（`index0706.js` 类 `rHe`，旧版类名 `vYe`）

| 步骤 | API | Header |
|------|-----|--------|
| 余额 | `GET {gateway}/v2/user` | `kw(account)` → `authorization: account.token` |
| 验盘 | `GET {gateway}/v2/odds?match_id=` | 检查 `enable_parlay`、`status`、`bet_limit`、赔率 |
| 下单 | `POST {gateway}/v2/order` | body：`order=JSON.stringify(data)` |
| 失败 | `code===501` | 赔率下降 |
| 成功 | `code===200` | 消息含余额 |

凭证：**仅** `this.account`（剪贴板），与采集写死 JWT **无代码关联**。

### changmen（`client/packages/venue-browser/adapter/ray/bet.ts`）

[A8 可证实] 2026-10-21 按本地 `A8/index0706.js` 的 `rHe.checkBet` 恢复预检：原样发送账号 token，强制直连 `/v2/odds?match_id=`；使用 `odds_id == itemId` 查项，要求 `enable_parlay === 1`、`status === 1`，直接读取 `bet_limit[0/1]` 检查场馆金额。先更新实时赔率，再按原生浮点表达式 `option.odds > liveOdds + 0.01` 拒绝跌价。业务失败与跌价直接返回，不新增错误、不清除旧 data；缺失结果、盘口或限额沿用原始异常路径，公共账号入口对 RAY 使用 `JSON.stringify(error)`。

[A8 可证实] 预检按取整金额生成完整 order JSON，保留 `total_bet_bonus`、`number`、`oddsId`、`betMin/Max`，以及 `last_update`、`bet_limit`、身份、状态、赛段等盘口字段。`isLive` 仅由响应顶层 `result.start_time < Date.now()` 决定。下单直接序列化该 data，不再按官网精简字段；不增加账号风险限额、WS 有效期、数值校验或双腿收益门控。

[changmen 扩展] 现有订单监控、观察日志和订单身份字段保留；这些不是 RAY 预检条件。对照测试使用从 A8 原样提取并固定哈希的 `rHe.checkBet`，比较成功、拒绝、异常、旧 data 保留、浮点边界、完整提交 JSON 和实时赔率更新。

---

# 代码索引

## OB

| 能力 | A8（bundle） | changmen |
|------|--------------|----------|
| 采集入口 | `UMe` | [`ob/index.ts`](../ob/index.ts) `startObCollector` |
| Token 刷新 | `$Me` + `gY` | [`ob/helpers.ts`](../ob/helpers.ts) `refreshObCollectToken` |
| 采集 HTTP | `Rr.get` + `Ak` | [`ob/http.ts`](../ob/http.ts) `collectObGet` |
| MQTT | 插件内 `RMe.connect` | [`ob/mqtt.ts`](../ob/mqtt.ts) |
| 试玩 UI | `UserCollectView` | [`api/v4.ts`](../../api/v4.ts) `enterCreditPlate("OB")` |
| 下注 | OB Provider（bundle） | [`providers/obProvider.ts`](../../providers/obProvider.ts) |
| 后端 OB | — | [`devtools/platform-probes/ob/`](../../../../devtools/platform-probes/ob/)、[`esport-api/router.js`](../../../backend/core/esport-api/router.js) |

## RAY

| 能力 | A8（bundle） | changmen |
|------|--------------|----------|
| 采集入口 | `vQe` / `bQe()` | [`ray/index.ts`](../ray/index.ts) `startRayCollector` |
| 采集凭证 | 插件内对象 `t` | [`a8Collect.ts`](../ray/a8Collect.ts) + [`collect_credentials.js`](../../../../devtools/platform-probes/ray/collect_credentials.js) |
| 采集 HTTP | `Rr.get` + `Authorization` | [`ray/http.ts`](../ray/http.ts) `collectRayGet` |
| WS | `47.115.75.57` SC | [`ray/index.ts`](../ray/index.ts) + [`ray_http_proxy.js`](../../../backend/proxy/ray_http_proxy.js) |
| 下注 | `vYe` | [`providers/rayProvider.ts`](../../providers/rayProvider.ts) |
| 账号粘贴 | `AccountInfoView` | [`AccountEditDialog.vue`](../../components/account/AccountEditDialog.vue) |

---

# 与 OB 试玩相关的常见误解

| 误解 | 事实 |
|------|------|
| 采集每轮都调试玩 API | **否**。仅 `game/index` 报 `token` 时补货；数据来自 `game/index` / `game/view` + MQTT |
| 试玩 API 提供 gateway | **否**。`$Me` / `refreshObCollectToken` 只写 `token` |
| changmen 试玩必须走 `/api/ob/demo-login` | **否**（已改为与 A8 一致直连 `djtop-capi`）；该代理仅服务后端脚本 |
| RAY 采集用剪贴板账号 | **否**。A8 写死 JWT；changmen 经 API 注入同一 JWT |
| RAY 采集与下注共用 token | **否**（除非用户粘贴的账号恰好相同） |

---

*文档随 `changmen` 实现变更时请同步更新；A8 bundle 以 `A8/index0706.js` 为准。*
