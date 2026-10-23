# client/web 架构说明

本文档描述 `src/` 目录的职责划分与数据流，便于新增平台或排查问题。

**外行快速导航（按角色 5 分钟读文件）**：[`docs/QUICK_START_FILES.md`](../docs/QUICK_START_FILES.md)

## 四条主线

```
┌──────────────────────────────────────────────────────────────────────┐
│ ① 本系统 API     api/ + types/       →  server/backend /esport、/v4.0 │
│ ② 比赛列表       matcher → client_matches（浏览器 saveMatch 上报）   │
│ ③ 赔率上报       packages/venue-adapter/{平台}/collect.ts → SaveBet（+ fo）        │
│ ④ 平台下注       packages/venue-adapter/{平台}/bet.ts  →  场馆 gateway + 账号 token │
│ ⑤ UI 编排        stores/ + views/ + components/                      │
└──────────────────────────────────────────────────────────────────────┘
```

| 目录 | 职责 | 典型入口 |
|------|------|----------|
| `api/` | 封装 `Client_*` 等后端接口 | `api/esport.ts`（barrel）→ `client` / `auth` / `match` / … |
| `api/v4.ts` | A8 v4 信用盘试玩（平博/OB/SABA） | `enterCreditPlate` — 详见 [docs/CREDIT_PLATE.md](../docs/CREDIT_PLATE.md) |
| `src/types/` | web 本地类型（`extensionPrefs`、`admin`）；`esport`/`order` 核心形状见 client-core |
| `src/models/` | web 薄 shim：`match`（`getOrderOptions` 扩展）、`platformAccount`（Pinia）、`loseOrder` re-export |
| `@changmen/client-core/models` | `ViewMatch`、`BetOption`、`LoseOrder` 等领域类 |
| `@changmen/client-core/types` | `esport` DTO re-export、`order` 补单记录类型 |
| `domain/` | **下注编排胶水**（部分纯逻辑在 `@changmen/arb-core`） | `domain/betting` |
| `packages/venue-adapter/` | **平台清单、能力与平台实现**（`@changmen/venue-adapter`） | `registry/adapters.ts`, `ob/collect.ts`, `ob/bet.ts` |
| `shared/` | **Web 横切工具**（与采集/下注无关；HTTP/模型见 `@changmen/client-core`） | `betTiming`, `a8MatchTime` |
| `runtime/` | **运行时入口注册** | `runtime/collectors.ts`, `runtime/providers.ts`, `runtime/appSession.ts` |
| `packages/venue-adapter/{id}/collect.ts` | **赔率上报链路** | `start*Collector` |
| `packages/venue-adapter/shared/` | **仅采集专用** | `collectSession`, `collectNotify`, `socket/` |
| `packages/venue-adapter/{id}/bet.ts` | **下注** | `obProvider` 等 |
| `stores/` | Pinia 状态与编排 | `matchStore`, `accountStore`, `bettingStore` |
| `packages/venue-adapter/hg/follow.ts` | HG 跟单循环 | `startHgFollowLoop` |

**原则**：`bet.ts` 不依赖 `collect.ts`；二者都可用 `src/shared/`，但 `bet.ts` 不应依赖 `venue-adapter/shared/`（采集专用）。

### 平台能力矩阵（`packages/venue-adapter/registry/adapters.ts`）

| 平台 | 采集 | 下注 | 备注 |
|------|------|------|------|
| OB / IM / RAY / TF / IA / SABA / PB / IMT / HG | ✓ | ✓ | |
| XBet | ✓ | — | A8 Socket 频道，无 provider |
| Stake | ✓ | ✓* | *`pluginOnly`：需 Chrome 扩展 + stake.com tab；`stakeProvider` 已实现 GraphQL 下单 |
| Polymarket | ✓ | ✓ | **[changmen 扩展]** A8 无此场馆；采集开赛窗过去 6h（见下） |

`PLATFORMS` 从 `@changmen/venue-adapter/shared`（`shared/platforms.ts`）导出；`ALL_PLATFORMS` 从 `@changmen/venue-adapter/registry`（`registry/meta.ts` + `manifest.json`）。新增平台时改 `packages/venue-adapter/registry/`，并在 `runtime/collectors.ts` / `providers.ts` 经 registry 自动注册。

账号鉴权（与采集解耦）：`packages/venue-adapter/pb/auth.ts`、`packages/venue-adapter/tf/auth.ts` ← `@changmen/client-core/shared/platformHttp` 与采集侧共同使用。

---

## 数据流

### 比赛列表（后端入库，Changmen 主路径）

```
浏览器 saveMatch / saveBet（`packages/venue-adapter` / `@changmen/venue-adapter` 采集）
         ──► API_SaveMatch / API_SaveBet
         ──► matcher → client_matches
         ──► Client_GetMatchs
         ──► matchStore（前端只读列表）
```

入库时间窗校验在 `store.saveMatches`（过期赛程不写入）。

### 赔率上报（前端）

```
场馆 API / WS / MQTT ──► venue-adapter/{平台}/collect.ts
         ──► 解析为 CollectBetDto（+ 本地 oddsStore）
         ──► collectStore.saveBets（开关控制）
         ──► api/esport API_SaveBet
         ──► backend → platform_bets
         ──► matcher compose/ 合场 → client_matches
         ──► Client_GetMatchs 读取 → matchStore → UI
```

上报开关：`collectStore`（由 `runtime/collectors.ts` 启动）。语义是”是否调用 `saveBets` 写入后端”，不是”是否连接平台拉赔率”。  
比赛列表以服务端 `client_matches` 为准。

### 下注（出单）

```
UI 点击 ──► accountStore.checkBetting / betting
        ──► venue-adapter/{平台}/bet.ts (checkBet / betting / getBalance)
        ──► @changmen/client-core/shared/platformHttp (账号 gateway + token + 代理)
        ──► 场馆 API
```

账号模型：`models/platformAccount.ts`；列表与选中：`accountStore`。

### 自动套利（编排）

```
matchStore.runMainLoopTick（A8 `P()`，轮间 100ms）
  ──► 30s 门控 fetchMatches + oddsStore.clean，否则 refreshOddsOnBets
  ──► runArbBetRound（config.betting 时走 a8 调度）
        └── a8/runA8ArbRound — 全表串行 executeArbBet
              └── executeArbBet（单场单 bet）
              ├── domain/betting.buildOrderOptions（经 ViewBet.getOrderOptions）
              ├── accountStore.getAccount / checkBetting / betting
              ├── autoBet/retryFailedLeg（一侧失败换平台）
              ├── autoBet/rejectWait（拒单等待 + updateVenueOrders）
              ├── autoBet/makeUp（补单门控 + loseOrder 入队）
              └── successMarkers.markSuccessfulBet + betTiming 计数
  ──► processLoseOrders（补单队列，与执行模式无关）
  ──► 10min 门控 fetchMatchDefaultOdds
```

套利调度与 A8 bundle 一致：`runArbBetRound` → `a8/runA8ArbRound` → `executeArbBet`。加载 USERCONFIG 时会剥离已废弃的 `arbDetectEngine` / `arbExecuteEngine` 字段。

### 调度 vs `extensions/`（勿混淆）

| 层级 | 目录 | 职责 |
|------|------|------|
| **调度** | `stores/betting/a8/` | 套利**调度**：决定跑哪些 bet、以何种顺序调用 `executeArbBet` |
| **执行** | `stores/betting/autoBet/` | 单场下注管线 |
| **扩展能力** | `extensions/arbOpportunity`、`arbMarketWatch`、`arbBet`、`notify` | 检测输入、盯盘、UI、Telegram；**不是**调度本身 |

- `@changmen/arb-core/opportunity` 供通知旁路与盯盘；自动下注仍走 A8 主循环全表遍历。

手动双击：`bettingStore.manualBet` → `manualBet.ts`（同样走 `accountStore` + `successMarkers`）。

登录后会话生命周期由 `runtime/appSession.ts` 统一编排（`HomeView` 调用 `startAppSession` / `mountAppSession` / `stopAppSession`）；采集/HG 细节仍在 `runtime/sessionBoot.ts`。

### 用户信息与延迟显示（`Client_GetUserInfo`）

- 对齐 A8：延迟值来自统一请求封装 `api/client.ts` 的 `post()` 耗时采样。
- `/esport` 主请求通道对齐 A8 `Ar.post`：`a8Axios.post()` + `application/x-www-form-urlencoded;` + `response.data`。
- `post()` 按 A8 `Ar.post` / `Ut.delay`：250ms 门控 + finally 同步写 `api/apiDelay.ts` 的 `delay`（UserInfoView `xxms`）；`counter` 供 ExtensionsView 刷 `document.title`。
- 不再使用定时 `Client_GetUserInfo` 心跳探针，因此不会出现该接口高频轮询。

---

## 目录约定

### `domain/`（套利与下注规则）

与 Pinia / Vue 解耦，优先放这里便于单测与 A8 对照。

[changmen 扩展] 报价规则通过 `domain/betting/quoteSource.ts` 的只读端口取数；
`services/quoteSource.ts` 在原有读取位置解析当前 Pinia。PM 与 PF 的应用入口分别为
`services/polymarketQuotes.ts`、`services/predictFunQuotes.ts`，PM 建腿和预检共用原有冻结状态。
纯 EV 配置归 `config/valueBet.ts`，扩展旧入口只转导出；订单展示与进度公共类型归 `types/`。

`npm test --workspace=@changmen/web` 会先执行依赖方向检查。该检查统计生产源码，
测试文件仍由 Vitest 和前端类型检查验证。

[changmen 扩展] POD 跟单执行由 `runtime/podFollowPayload.ts` 构造原有请求，
`podFollowOrderGate.ts` 读取当前订单与限额，`podFollowPlacement.ts` 处理下单及回执，
`podFollowAutoRunner.ts` 串行调度与恢复。面板持有原有响应式状态和唤醒事件。
停止或重启执行器后，旧轮次只完成已经发送的订单，不再向下一馆发单，旧恢复请求也不发布就绪状态。

| 路径 | 用途 | 对齐 A8 |
|------|------|---------|
| `@changmen/arb-core` `pickArbLegs` | 跨平台选最优主客腿、隐含利润率 | bundle 套利检测 |
| `domain/betting/singleLegRate.ts` | 比例 9999 单边模式、linkId | [changmen 扩展] |
| `domain/betting/betFilters.ts` | 账号主过滤（初赔、lastOdds、maxBetCount） | A8 对齐 |
| `domain/betting/describeArbPrepareSkip.ts` | GetOrderOptions 跳过原因文案 | [changmen 扩展] |
| `extensions/arbBet/` | BetRow 红线/flash UI（规则见 `domain/betting/singleLegRate`） | [changmen 扩展] |
| `extensions/arbBet/ui/` | 赔率涨跌动画、套利腿连线与利润角标 | [changmen 扩展] |
| `domain/betting/buildOrderOptions.ts` | 对冲金额、`betSorting`、WinRate | `IQ.GetOrderOptions` / `oJe` |
| `@changmen/arb-core/providerKeys` | `auto` = `getProviders()` | A8 下单平台范围 |

场馆拒单判定在 `@changmen/venue-adapter/adaptation` / 各场馆 `resolveLegOutcome`；编排层不再维护 `domain/betting/venueReject.ts`。

`models/match.ts` 的 `ViewBet.getOrderOptions` 委托 `buildOrderOptions`，保持模型 API 不变。

### `stores/account/`（账号与下注网关）

| 路径 | 用途 |
|------|------|
| `accountStore.ts` | Pinia 门面（对齐 A8 `Io`） |
| `account/accountCrud.ts` | 列表加载、保存、创建/删除、充提流水 |
| `account/accountPicker.ts` | `getProviders`、`getAccount` 轮询选号 |
| `account/betGateway.ts` | `checkBetting`、`betting` 通知与场馆下单 |
| `account/balanceRefresh.ts` | 余额刷新循环（120s + 随机 60s） |
| `account/venueOrders.ts` | 场馆订单同步、拒单检测用 |

### `stores/betting/`（下注编排）

| 路径 | 用途 |
|------|------|
| `bettingStore.ts` | 手动下注、补单入口；主循环在 matchStore |
| `runArbBetRound.ts` | 主循环单轮：a8 套利调度 + 补单 |
| `a8/runA8ArbRound.ts` | [A8 可证实] **调度 a8**：全表串行 `executeArbBet` |
| `autoBet/executeArbBet.ts` | 单场套利编排入口（两种调度共用） |
| `autoBet/arbExecutionTrace.ts` | 套利进度 trace 类型与 `createArbExecutionTrace` |
| `autoBet/arbProgressTrace.ts` | `beginArbExecutionTrace`（接 messageStore / notify） |
| `autoBet/phases/prepareArbAttempt.ts` | 选腿、选号、linkId |
| `autoBet/phases/checkArbLegs.ts` | 预检 + checkTimeout |
| `autoBet/phases/placeArbLegs.ts` | 下单（并行/串行/单边）+ retryFailedLeg |
| `autoBet/phases/settleBothArbLegs.ts` | 并行 `settleArbLeg` + `bindArbLegOrder` |
| `autoBet/phases/finalizeArbBet.ts` | 瘦编排：settle → makeup → mark → notify |
| `autoBet/phases/finalizeArbMarkers.ts` | 成功腿 `markSuccessfulBet` |
| `autoBet/phases/syncArbFinalizeUi.ts` | `activeBetRun` 收尾 |
| `autoBet/phases/finalizeArbMessaging.ts` | trace / `bettingMessage` |
| `autoBet/arbLegSettle.ts` | 单腿 `resolveLegOutcome` → `{ orders, rejected, pendingConfirm }` |
| `autoBet/arbMakeUpPair.ts` | 套利补单配对 `arbMakeUpSides` |
| `autoBet/arbMakeUpFromRejects.ts` | 拒单/失败腿补单入队 |
| `autoBet/makeUp.ts` | 补单阈值 + 入队 |
| `autoBet/rejectWait.ts` | `legRejectWaitSec` + Oe tip（实际 wait 在场馆层） |
| `arbOrderBind.ts` | `resolveArbBindOrderId` + `bindArbLegOrder` |
| `autoBet/retryFailedLeg.ts` | `anyOdds` 失败腿换平台重试 |
| `loseOrder.ts` | 补单队列处理 |
| `manualBet.ts` | 双击手动下单 |
| `betFilters.ts` | `passesDefaultOddsAccount` 薄包装（规则在 `domain/betting/betFilters`） |
| `successMarkers.ts` | 成功标记、`BETACCOUNT` sessionStorage |

### `extensions/`（扩展能力，非调度模式）

| 路径 | 用途 |
|------|------|
| `extensions/arbOpportunity/` | 套利机会检测（`detect`）；通知旁路 / 盯盘 |
| `extensions/arbMarketWatch/` | 非买入时全盘口 Telegram 盯盘 |
| `extensions/arbBet/` | BetRow UI 增强 |
| `extensions/notify/` | Telegram 格式化与配置；trace 正文见 `formatArbProgress.ts` |

依赖方向：`domain` ← `stores/betting` ← `extensions`（下注编排不 import notify；`messageStore` 负责投递 Telegram）。

### `shared/`（Web 本地横切）

| 文件 / 包 | 用途 |
|------|------|
| `@changmen/client-core/shared` | `http`、`platformHttp`、`format`、`wait`、`a8Axios` 等通用工具 |
| `@changmen/venue-adapter/shared` | `PLATFORMS`、采集桥接（`webBridge`）、`socket/` |
| `betTiming.ts` | 下注通知时长、`lastOdds`、`BETCOUNT`（对齐 A8 `T()`） |
| `a8MatchTime.ts` | A8 采集开赛窗 re-export（见下「采集开赛时间窗」） |
| `arbBetTraceFormat.ts` | trace 事件文案（`formatBetResult` / `formatLegAccount`） |
| `winRate.ts` | WinRate 排序（`betSorting: WinRate`） |
| `md5.ts` / `totp.ts` | OB 签名、谷歌验证码 |

### 采集开赛时间窗

| 范围 | 规则 | 实现 |
|------|------|------|
| **A8 平台**（OB/IM/TF/…） | 仅拒绝「现在 +1h」之后的开赛；**无过去下限**（已开赛只要平台仍返回就保留） | `shared/a8MatchTime.ts` → `@changmen/shared/time/match_time` 的 `a8StartTimeCollectAllowed` |
| **Polymarket** [changmen 扩展] | 主 pass 过去 **6h**、未来 **1h**（另补 live） | **仅** `server/collectors/polymarket-esports/api.js`；浏览器不扫盘 |

### `venue-adapter/{平台}/`（扁平结构）

采集与下注文件与平台目录同级，无 `collector/` / `provider/` 子目录：

| 文件 | 用途 |
|------|------|
| `index.ts` | `PlatformAdapter`（`collector` + `provider` 的汇总入口） |
| `collect.ts` | `startXxxCollector()` — 采集主循环 |
| `bet.ts` | `xxxProvider` — 实现 `PlatformProvider`（checkBet / betting / getBalance） |
| `parse.ts` | 字段解析（采集 + 下注共用） |
| `markets.ts` | OB 专用：盘口灌 fo（`game/view`） |
| `mqtt.ts` | OB 专用：MQTT 订阅与增量处理 |
| `auth.ts` / `ws.ts` 等 | 协议细节（按需，如 PB/TF/IMT） |

`bet.ts` 使用各 venue adapter 内的 `accountHttp.ts`，底层可复用 `@changmen/client-core/shared/platformHttp` 的通用 http-relay；不要把平台特化 headers/paths 放回 shared。

### `venue-adapter/shared/`

| 路径 | 用途 |
|------|------|
| `collectSession.ts` | 解析 PB/IMT 等采集用 gateway+token |
| `collectNotify.ts` | 采集错误 → Telegram |
| `socket/hub.ts` | A8 Socket.IO 连接（IM / XBet 共用） |
| `socket/collector.ts` | `startA8BetsCollector`：A8 Socket 频道薄采集入口 |
| `socket/accumulator.ts` | 赔率增量合并与 fo 写入（Socket 收到的 bets 消息） |

---

## types 与 models

| | `types/` | `models/` |
|---|----------|-----------|
| 内容 | API 入参/出参、配置 JSON | 类 + 业务方法 |
| 例子 | `CollectBetDto`, `UserConfig` | `BetOption`, `PlatformAccount` |

新增接口字段先改 `types/`，再在 store/model 里组装。

---

## 待确认订单的写入与会话

[changmen 扩展] `services/pendingPmOrderWrites.ts` 按会话版本、账号和原单号登记 Pending 保存。`api/order.ts` 的 PM 后续写入在原 Pending 完整保存后继续；状态查询与场馆 POST 回执不等待该屏障，原 Pending 写入也不等待自身。同步投影前保留原屏障，投影后再次匹配原单，避免异步投影或会话切换绕过保存顺序。

`betGateway.ts` 的待确认任务只保留 `realtime/bettingEventPayload.ts` 定义的原广播字段，包括客户端比赛与盘口 ID；不从场馆 ID 推算广播 ID。退出/切换工作区经 `accountStore.resetSession()` 同步暂停确认与 RDS 恢复定时器，保留原单记录，待账号重新加载后恢复。旧会话或旧暂停代次的响应不能计数、通知或重启定时器。

## 账号编辑弹窗

[changmen 扩展] `components/account/AccountEditDialog.vue` 保留表单、监听器与界面装配；钱包与保存流程按职责拆到同目录模块：

- `polymarketAccountEditor.ts`：PM 密钥来源、本机仓、地址/API 凭证及 Relayer。
- `predictFunAccountEditor.ts`：PF Privy 密钥、地址显示、内存与持久化 token。
- `obSportAccountEditor.ts`：OB 体育凭证表单与保存前身份校验。
- `accountCredentialPaste.ts`：粘贴识别、凭证填充与网关测速。
- `accountEditSave.ts`：字段规范化、会员绑定、新建/编辑及管理端乘网保存。

模块通过 `accountEditContext.ts` 接收当前表单的 getter，共享原有响应式对象与 props；`v-model:form` 替换表单后仍读取最新对象。PM 异步序号归各编辑器实例所有，原有重置及关闭监听器在原位置调用取消操作。创建账号、写入本机密钥仓、保存和关闭后刷新的顺序保持原样。行为对照测试直接执行固定 Git 版本中的原函数，覆盖保存失败、场馆身份校验、密钥来源和异步取消；完整模板、监听器和 37 个迁移函数另作源码比较。

## 新增平台 Checklist

**权威清单**（browser / plugin / vps-house 三类）：[docs/ADD_PLATFORM_CHECKLIST.md](../../../docs/ADD_PLATFORM_CHECKLIST.md)。

摘要：

1. `packages/api-contract` — `PlatformId`
2. `venue-adapter/registry/manifest.json` — 含正确 `collectionMode`（VPS = `vps_http_ws`）
3. `venue-adapter/{平台}/` + `registry/adapters.ts` — `PlatformAdapter`
4. **不要**手改 `runtime/collectors.ts` 逐馆列表（registry 自动）
5. `platform_sync` — **仅**需要启动灌 `platforms.json` 凭证时才加
6. VPS 馆：`server/collectors/` + ecosystem；浏览器只报价/下单
7. UI — 随 `ALL_PLATFORMS`；Save* 门控读 manifest

---

## 相关脚本

- 开发：`npm run dev`（Vite：Win `5274` / 其它 `5174`，`/` base）
- 构建：`npm run build`
- 依赖基线：`npm run analyze:deps`（在 `changmen/` 根目录；`--check` 校验架构硬规则，违规非零退出）
- 后端代理：见 `vite.config.ts` 中 `/esport` → `VITE_API_PROXY`

---

## 依赖基线（批次 5f，2026-06-18）

在 `changmen/` 执行 `npm run analyze:deps`，或于 `client/web/` 执行 `npm run analyze:deps:check`。脚本输出模块规模、分层流向、stores/extensions 边，并校验下列**硬规则**（违反则 exit 1）：

| 规则 ID | 约束 |
|---------|------|
| `domain-no-stores` | `domain/*` 不得 import `stores/*` |
| `types-no-stores-extensions` | `types` 不得 import `stores/*` 或 `extensions/*` |
| `betting-no-notify` | `stores/betting` 不得 import `extensions/notify`（trace 已迁至 `autoBet/`） |

**当前快照**（`analyze-module-deps.mjs` 一次运行）：

| 指标 | 值 |
|------|-----|
| 最大模块（文件数） | `stores/betting`（55） |
| 入度最高 | `types`（28）、`shared`（20） |
| `stores/betting` 外向依赖 | `domain/*`、`extensions/arbOpportunity`、`stores/*`（无 `extensions/notify`） |
| 顶层分层 | `domain → models, shared, types`；`types → shared` |
| 入口链 | `main → App, chrome-plugin, lib, router, stores/user` |

**有意保留的跨层依赖**（不在 `--check` 中禁止，勿强行拆）：

| 来源 | 目标 | 原因 |
|------|------|------|
| `stores/message` | `extensions/notify`、`extensions/arbMarketWatch` | Telegram / 盯盘投递层 |
| `stores/betting` | `extensions/arbOpportunity` | 通知旁路检测输入 |
| `extensions/arbOpportunity` | `stores/config` | `syncArbRuntime` 启停盯盘 |
| `extensions/arbBet/ui` | `stores/match`、`stores/odds`、`stores/account` | BetRow Vue 组合式，读 store 状态 |
| `extensions/notify` | `stores/betting/autoBet/*` | 仅 **类型/trace API** 与格式化，非调度 |

`extensions/*` 整体可依赖 `stores/*`（UI / 运行时同步）；`stores/betting/autoBet` 与 `extensions/notify` 之间仅允许 **messageStore 投递** 方向，不允许 autoBet 直接 import notify。

---

## api 分域（`api/*.ts`）

| 文件 | 职责 |
|------|------|
| `client.ts` | token、`post`、`unwrap` |
| `auth.ts` | 登录、用户信息 |
| `platform.ts` | 采集平台配置、`updatePlatform` |
| `match.ts` | `SaveMatch` / `SaveBet` / `getMatchs` |
| `kv.ts` | `Client_GetData` / `SaveData` / 用户 setting |
| `order.ts` | 订单列表与保存 |
| `account.ts` | 余额、账变、标签平台 |
| `report.ts` | 月报、利润、默认赔率 |
| `chat.ts` | 聊天、用户列表、日志 |
| `hg.ts` | 皇冠跟单队列（`/common`） |
| `v4.ts` | 信用盘试玩（OB/SABA 官方；`/v4.0` 已停用） |

### 信用盘（试玩入口）

经 `api.a8.to` 的 v4 信用盘已停用；`/v4.0/*` 返回 `V4Disabled`。当前仅 OB / SABA 官方试玩。详见 [docs/CREDIT_PLATE.md](../docs/CREDIT_PLATE.md)。

业务代码可继续 `import { … } from "@/api/esport"`，或按域从 `@/api/match` 等直接引用。
