# A8 对齐总览（Parity Registry）

**用途**：把 changmen 相对 A8 前端 bundle 的对齐项集中在一处；细节仍见各专题文档。

对照基线：仓库根 `A8/index0706.js` 与 `A8/A8插件/`（只读）。CSS 对照使用现有提取资产，不使用已不存在的独立 `index.css`。

文档修复：2026-11-13。损坏正文从 Git 提交 `7491349b727b` 的 UTF-8 原文恢复，保留后续可确认的手动门控、实时频道及 settle 说明。

一至九节及十一节中的对齐状态、审计数量和待办是 2026-06-19 的历史快照，不代表当前提交重新验收通过。当前目录、鉴权、运行命令及发布规则以 [本机开发说明](../../../LOCAL_DEV.md)、[架构](../../../docs/ARCHITECTURE.md) 和 [独立部署](../../../docs/INDEPENDENT_DEPLOYMENT.md) 为准；本次恢复未重新执行历史审计。

---

## 图例

| 状态 | 含义 |
|------|------|
| ✅ 已对齐 | 行为与 bundle 可证实一致 |
| ⚠️ 部分 | 主路径对齐，有已知差异 |
| 🔶 扩展 | changmen 有、A8 bundle 无 |
| ⏸ 暂缓 | 刻意不做或资源缺失 |
| 📄 | 详见链接文档 |

标签：`[A8 可证实]` / `[changmen 推测]` / `[changmen 扩展]`（定义见仓库根 `AGENTS.md`）

---

## 文档地图（原先分散在哪）

| 文档 | 覆盖范围 |
|------|----------|
| **本文件** | 全量对齐索引 + 配置/时序/投注行为摘要 |
| [A8_UI_PARITY_GAPS.md](./A8_UI_PARITY_GAPS.md) | UI 结构、用户中心 Tab、自动投注行为表、**未对齐/部分**项 |
| [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md) | OB/IM/TF/PB/RAY/IMT/STAKE/IA 采集·下注·回传开关 |
| [A8_OB_REPLICATE_PLAN.md](./A8_OB_REPLICATE_PLAN.md) | OB 专项（MQTT、模式 P、token） |
| [A8_NEXT_STEPS.md](./A8_NEXT_STEPS.md) | 待办、验收命令、阶段勾选 |
| [A8_WALKTHROUGH_CHECKLIST.md](./A8_WALKTHROUGH_CHECKLIST.md) | 同屏走查勾选 |
| [A8_SCRIPT_PLUGIN_PLAN.md](./A8_SCRIPT_PLUGIN_PLAN.md) | 脚本 + Chrome 插件、Mode P |
| [../MIGRATION.md](../MIGRATION.md) | bundle 模块 → changmen 目录映射、阶段进度 |
| [platforms/A8_COMPARE_ALL_PLATFORMS.md](./platforms/A8_COMPARE_ALL_PLATFORMS.md) | 全平台横向对照 |
| [A8_PARITY_AUDIT_MACHINE.json](./A8_PARITY_AUDIT_MACHINE.json) | 机器审计（历史审计输出） |

---

## 一、架构与数据流

| 项 | A8 | changmen | 状态 |
|----|-----|----------|------|
| 客户端采集 + 服务端聚合 | 浏览器 saveMatch/saveBet → 服务端 GetMatchs | 同 | ✅ |
| CollectConfig 语义 | 仅门控 **回传** API，不停止采集器连接 | `collectStore` + `runtime/collectors` | ✅ [A8 可证实] |
| CollectConfig 空库 seed | 全关，`Client_GetData("CollectConfig")` 回填 | 已对齐 | ✅ |
| matcher / client_matches | bundle 无 | RDS + `server/match/matcher` | 🔶 [changmen 扩展] |
| 服务端 API 形状 | 由 bundle 反推 | `server/backend` | 📄 [changmen 推测] |

---

## 二、主循环与时序（`Vg` / `P()`）

| 项 | A8 | changmen | 状态 |
|----|-----|----------|------|
| 主循环轮间延迟 | ~100ms | `MAIN_LOOP_DELAY_MS = 100` | ✅ |
| 比赛列表拉取 | 30s 门控 `GetMatchs` | `MATCH_POLL_MS = 30_000` | ✅ |
| 轮间仅刷新赔率 | 非 30s 轮 `updateOdds` | `refreshOddsOnBets` | ✅ |
| 初赔轮询 | 10min | `DEFAULT_ODDS_MS` | ✅ |
| 补单队列 prune | 60s 与列表门控同轮 | `LOSE_ORDER_PRUNE_MS` | ✅ |
| 空列表 `[]` | 仍跑补单 + 10min 初赔门控（仅 `null` 早退） | `runMainBetLoopTick` 不对 `matchs.length` 早退 | ✅ |
| **投注间隔 `betInterval`** | 配置默认 30，**不参与调度** | 同（仅 UI/存库） | ✅ |
| 各平台 saveMatch 间隔 | RAY/Stake/TF 30s；OB/PB/XBet 60s 门控等 | `client/packages/venue-browser/adapter/*` | 📄 [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md) |

实现：`src/stores/match/mainBetLoop.ts`

---

## 三、用户配置 `D8` / `userConfig.ts`

| 配置项 | A8 行为 | changmen | 状态 |
|--------|---------|----------|------|
| 表单字段全集 | UserConfigView | `UserConfigDialog` + `userConfig.ts` | ✅ |
| `waitTime` 加载规范化 | `Number(k)\|\|0` 逐键 | `normalizeWaitTime` + `mergeUserConfig` | ✅ |
| `waitTime` 自动套利通知 `Oe` | `max(wait??0, …, 10)`；`-1` 仍 floor 10 | `arbBetToastSeconds` | ✅ |
| `waitTime` 补单 `Pe` | `-1→0`，否则 `max(wait??0,10)` | `makeUpBetToastSeconds` | ✅ |
| `waitTime` 手动下单 | `betting(_, opt)` 第三参默认 **10**，不读 waitTime | `manualBetToastSeconds()` | ✅ |
| `waitTime` 拒单等待 `q` | 成功腿 `waitTime??5`，`max(...)` | `rejectWaitSeconds` | ✅ |
| 拒单弹窗 countdown | 显示 **Oe**，实际等 **q** | `waitRejectDetection(waitSec, rejectWait)` | ✅ |
| `checkTimeout` | 超时报 tip | `executeArbBet` + `a8Tip` | ✅ |
| `betSorting` / WinRate | `oJe` | `buildOrderOptions` + `winRate.ts` | ✅ |
| `anyOdds` + 重试 | 最多 3 轮换 | `retryFailedLeg` | ✅ |
| `makeUp_*` / `makeProfit` | jb 补单阈值 | `makeUp.ts` + `loseOrder.ts` | ✅ |
| `noSameBet` / `allowSameBet` | sessionStorage `BETACCOUNT:` | `readUsedAccounts` | ✅ |
| `noSameProvider` | 仅补单 | `processLoseOrders` | ✅ |
| `maxBetCount` / `BETCOUNT` | sessionStorage | `betTiming.ts` | ✅ |
| `lastOdds` | 拒更低赔重复 | `passesLastOddsGate` | ✅ |
| 账号 `game[游戏].betCount` | 仅存库/UI；主循环不累计、不拦单 | 同（已删 `GAMEBETCOUNT` 运行时） | ✅ |
| 账号 `rateConfig` 保存时过滤 `rate===0` | `filter(C=>C.rate!==0)` | `normalizeAccountRateConfig` | ✅ |
| 账号 `rate===0` 运行时 | 当 1（全额） | `getBetMoney` 同逻辑 | ✅ |
| **`rate===9999`** | A8 无此语义 | 单边模式：本侧不自动下，对侧真下单 + 负 linkId | 🔶 `domain/betting/singleLegRate.ts`（UI 见 `extensions/arbBet/ui`） |

测试：`src/shared/betTiming.test.ts`

---

## 四、自动投注与下单（`Io.betting` / `executeArbBet`）

| 项 | A8 | changmen | 状态 |
|----|-----|----------|------|
| 投注中 loading 通知 | `notification loading ${provider}` | `placeBet` / `betGateway.ts` | ✅ |
| 结果通知 duration | `T===0 ? 3s : T*1s` | `placeBet` | ✅ |
| 并行 / 顺序下单 | `betSorting` Parallel 等 | `executeArbBet` | ✅ |
| 预检超时 | tip 3s | `a8Tip("前置检查超时")` | ✅ |
| 成功后 refreshBalance | 有 | 有 | ✅ |
| 拒单检测 | `updateBalance`（不 await）→ tip(Oe) → wait(q) → `updateOrders` | `void refreshBalance` → `waitRejectDetection(Oe,q)` → `updateVenueOrders` | ✅ |
| 套利收尾侧栏 | 不调用 `E()`；仅 `updateOrders`→`saveOrders` | 同（已移除 `fetchOrders`） | ✅ |
| 四平台 getOrders→reject | OB `bet_status=2`；RAY `status=4`；IA `receive_status=2`；PB `_Q`+缓存 | 同左 + 单元测试 | ✅ |
| 拒单 q<=0 | 仍弹「拒单检测」(Oe)，不 wait | `waitRejectDetection` 同 | ✅ |
| 补单拒单前 refreshBalance | 无 | 无（与 A8 jb 一致） | ✅ |
| 绑单 `SaveOrderBind` | 有绑单行才 POST；空数组跳过；`vx` 仅 LinkID+Provider+OrderID | `api/order.saveOrderBind` | ✅ |
| 随机 `betMoney` | 每 **bet** roll | `prepareArbAttempt` 内 per bet | ✅ |
| 双腿 linkId | GetOrderOptions 后 `Date.now()` 正数 | `prepareArbAttempt` 内 `linkTs` | ✅ |
| 9999 单边 linkId | A8 无 | 负数 `-Date.now()`，展示 `gb{ts}` | 🔶 |
| 9999 单边 Telegram | A8 无 | 双腿版式；9999 侧标注不下单 | 🔶 |
| 补单入队 | 一腿成功一腿失败 | `enqueueMakeUpOrder` | ✅ |
| 手动双击下单 | check + betting | `manualBet.ts` | ✅ |
| 手动下注门控 | [A8 可证实] `index0706.js` 手动入口 `p`：`getAccount(type, 0)` → 输入金额 → 平台预检 → 下注；不执行自动账号筛选或输入后的余额门控 | 普通手动入口对齐，不受账号自动筛选、地图静音和赛前全场过滤限制；选账号的原有规则与平台预检保留。[changmen 扩展] 金额按用户输入，仅换算币种、不应用账号比例；PM GTC 保留原有检查。静音/筛选中的盘口可仅展开查看，不打开自动下注 | ✅ |
| Telegram 套利机会提醒（关投注） | 无 | `arbMarketWatch` + `notifyArbOpportunity` | 🔶 |
| 套利执行进度报告 | 无 | `stores/betting/autoBet/arbExecutionTrace` + `arbProgressTrace`；Telegram 正文 `extensions/notify/formatArbProgress`；跳过文案 `domain/betting/describeArbPrepareSkip` | 🔶 |
| BetRow 套利红线 / flash | bundle 内联 / 无 | `extensions/arbBet/ui` | 🔶 |

实现：`src/stores/betting/autoBet/*`、`src/domain/betting/*`、`src/stores/bettingStore.ts`

---

## 五、补单（`jb`）

| 项 | A8 | changmen | 状态 |
|----|-----|----------|------|
| 队列 session | jb | `loseOrderStore` | ✅ |
| 创建补单 UI | CreateLoseView | CreateLoseDialog | ✅（弹窗字段同 A8；挂载于各 BetRow，非 HomeView 单例） |
| 赔率 / 初赔过滤 | minDefault/maxDefault | `domain/betting/betFilters`（`passesDefaultOddsAt`）；Pinia 入口 `stores/betting/betFilters` | ✅ |
| 补单 waitTime | `Pe` 逻辑 | `makeUpBetToastSeconds` | ✅ |
| `isCreateOrder` 跳过拒单复检 | 有 | 有 | ✅ |
| 拒单仍绑单、不移队 | 有 | 有 | ✅ |
| 消费门控 | `makeUp`（不要求 `betting`） | `makeUp` only | ✅ |
| 发布群通知 | 仅 `isCreateOrder` 创建 | 同左 | ✅ |
| 自动入队 | 套利失败即入队（不要求 `makeUp`） | 同左 | ✅ |
| 手动创建赔率 | 切换主客 `maxOdds + 0.5` | `createLoseTargetOdds` | ✅ |
| Follow→补单 | GoEasy `Publish` | 暂缓（非补单核心） | ⏸ |

---

## 六、UI / 用户中心

**完整逐项表** → [A8_UI_PARITY_GAPS.md](./A8_UI_PARITY_GAPS.md) 第一～五节、第九节。

| 区域 | 状态 | 备注 |
|------|------|------|
| HomeView 布局 / BetRow / AccountBar | ✅ | |
| LoginView | ✅ | |
| UserDiag 11 Tab | ✅～⚠️ | 密码 Tab：TOTP 为 **增强** |
| UserConfigDialog | ✅ | |
| 赛事采集 Tab 像素 | ✅ | [A8_COLLECT_VIEW_PIXEL_PARITY.md](./A8_COLLECT_VIEW_PIXEL_PARITY.md) |
| 充提 / 账号编辑 | ⚠️ 基本对齐 | P3 pixel diff |
| HG 采集 | ⚠️ | 无电竞赔率流；60s 余额 |
| CSS 选择器 vs A8 | ✅ 1816 一致 | 历史机器审计 |

---

## 七、八平台采集与下注

**总表与验收** → [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md)

| 平台 | 采集 | 下注 | 状态 |
|------|------|------|------|
| OB | HTTP + MQTT | obProvider | ✅ |
| IM | A8 Socket `IM` | imProvider | ✅ |
| TF | REST 30s + WS | tfProvider | ✅ |
| PB | Chrome 扩展 | pbProvider | ✅ 需扩展 |
| RAY | HTTP + SC WS | rayProvider | ✅ |
| IMT | 快照 + Delta | imtProvider | ✅ |
| STAKE | GraphQL + 插件 | stakeProvider | ✅ 需扩展+tab |
| IA | HTTP + WS；下注 Zn/PROXY | iaProvider | ✅ wQe/CYe + `iaMrPost` 已对齐 |

HG / 跟单：⚠️ 见 [platforms/HG.md](./platforms/HG.md)、`hgFollowLoop`

---

## 八、服务端与 matcher（changmen 独有）

| 项 | 说明 | 标签 |
|----|------|------|
| RDS 表 platform_* / client_matches | 快照生命周期、matchMerge、archive | 🔶 |
| `*_history` 归档 | 过期/隐藏行移出活跃列表 | 🔶 |
| legacy json 双写 | 开发用 | 🔶 |

当前存储边界见 [DATA_STORAGE.md](../../../docs/DATA_STORAGE.md)。

---

## 九、已知缺口与暂缓（汇总）

| 项 | 说明 | 文档 |
|----|------|------|
| HG 电竞赔率流 | 仅余额/跟单 | A8_UI_PARITY_GAPS §六 |
| 账号编辑 / 充提 pixel | 同屏 diff | A8_UI_PARITY_GAPS §9.3 |
| 生产部署 / 远程 API 联调 | 历史 M1 待办；当前发布状态以 Actions 及部署记录为准 | [独立部署](../../../docs/INDEPENDENT_DEPLOYMENT.md) |
| Stake / PB 实机 | 依赖扩展与 tabId | A8_REPLICATE_8_PLATFORMS |

**不是缺口**：`betInterval` 不参与调度（A8 同样）；CollectConfig 不关采集器。

---

## 十、当前验证入口

按实际改动选择检查，不把本节命令当作必须依次执行的清单。旧自动化验收结果只代表当时版本；当前发布由 Actions 对精确候选执行检查。

从仓库根启动开发：Windows 使用本机 `BAT\dev-esport.bat`，其它系统使用 `./sh/dev-esport.sh`；后端默认端口分别为 3700 / 3456，Vite 为 5274 / 5174。

以下离线组件/场馆测试在 `client/web/` 执行：

```text
npm exec -- vitest run src/stores/betting/autoBet/rejectWait.test.ts ../packages/venue-browser/adapter/ob/bet.test.ts ../packages/venue-browser/adapter/ray/bet.test.ts ../packages/venue-browser/adapter/ia/bet.test.ts ../packages/venue-browser/adapter/pb/bet.test.ts ../packages/venue-browser/adapter/pb/rejectPoll.test.ts
npm run test:ob
```

OB 离线测试不设置 `ESPORT_TEST_BASE`；在线验收使用当前 Cookie 登录客户端与 Network 抓包，见 [OB 说明](platforms/OB.md)。旧 `test:ob-live` / `test:ob:all` 不作为当前在线验收入口。

完整前端测试与构建从仓库根执行：

```text
node client/web/vite/runFrontendTests.mjs --maxWorkers=2
npm run app:build
```

构建已含类型检查，不再叠加 `test:frontend` / `typecheck:frontend`。同屏走查见 [走查清单](A8_WALKTHROUGH_CHECKLIST.md) 和 [走查脚本](A8_WALKTHROUGH_SCRIPT.md)。

---

## 十一、严格 A8 全量审计（2026-06-19）

对照 `index.js` 逐段抽取 + 历史机器审计（25 View 全映射、CSS 1816 选择器 0 diff）。

### 11.1 订单 / 绑单 / 套利收尾（核心）

| 项 | A8 bundle | changmen | 状态 |
|----|-----------|----------|------|
| 侧栏 `E()` | `getOrders` → Link 降序 → `groupBy(Link)` → `updateTodayProfit` | `orderStore.fetchOrders` + `orderLink.ts` | ✅ |
| 套利收尾 `saveOrderBind` | `vx(LinkID, Provider, OrderID)`；`R.length>0` 才 push | `finalizeArbBet.ts` 同 | ✅ |
| 套利收尾 **不**调 `E()` | 仅 `updateOrders`→`saveOrders` | 已移除收尾 `fetchOrders` | ✅ |
| 拒单等待 | `updateBalance` 不 await → tip(Oe) → wait(q) → 单次 `updateOrders` | `finalizeArbBet` + `venueRejectSync` | ✅ |
| OB 下单后 orderList 重试 | `ZT` + 300s 窗口 + max 3 | `ob/bet.ts` `betSuccessAtByAccount` | ✅ |
| RAY `getOrders` | 单次 GET，无重试、无 `ZT` | `ray/bet.ts` 同 | ✅ |
| 绑单前轮询拉单 | **无** | **已删除** `syncVenueRejectFlagsForBind` | ✅ |
| RAY 下单后 getOrders 重试 | **无** | **已删除** `fetchRayOrderList` | ✅ |
| 绑单带 `PlayerID` | **无**（仅 3 字段） | **已删除** | ✅ |

**侧栏刷新时机（A8）**：`Io.f` finally `E()`；`loadAccounts(true)` → `f` + `E()`；OrderView 手动刷新。套利下注成功**不会**自动刷新侧栏。

**sz01 未合并根因（严格 A8 语义）**：拒单等待后 `updateOrders` 若返回空列表（RAY 无重试、场馆延迟），`saveOrderBind` 不执行；之后 `Io.f` 才把订单 sync 入库（hash Link），但绑单时机已过。这是 **A8 同等行为**，非排序逻辑错误。

### 11.2 仍为 changmen 扩展（勿标「已对齐 A8」）

| 项 | 路径 |
|----|------|
| 比例 9999 单边 / 负 linkId | `domain/betting/singleLegRate.ts` |
| 套利进度 Telegram | `arbExecutionTrace.ts`、`messageStore` |
| 套利机会盯盘 | `extensions/arbMarketWatch/` |
| BetRow 红线 / flash | `extensions/arbBet/ui/` |
| legend 负 Link 前缀、`orderlink--paired` | `orderLink.ts`、`OrderView.vue` |
| matcher / RDS | 服务端 |

### 11.3 UI / 结构（机器审计）

- bundle **25** 个 `*View` → Vue 全映射（`unmappedViews: []`）
- `a8.css` 与官方 **1816** 选择器一致
- 待 pixel diff：账号编辑、充提弹窗（见 `A8_UI_PARITY_GAPS.md` §9.3）

---

## 当前 Realtime pub/sub

| 项 | A8 bundle | changmen | 状态 |
|----|-----------|----------|------|
| 连接 | GoEasy SDK → 自管 `wss://47.115.75.57` | 同源 Socket.IO `/esport/realtime` + Cookie 会话 | [changmen 扩展] |
| 客户端适配 | `kv.pubsub.*` | `client/web/src/realtime/pubsubClient.ts` | 已对齐频道名 |
| BetTarget | `BetTarget` 频道 | `betTargetChannel.ts` / `betTargetPublish.ts` | 已对齐 |
| 跟单 Publish | `Publish` 频道 | `publishChannel.ts` / `publishBetting.ts` | 已对齐 |
| 操盘 USER/TRADE | `USER:{id}` / `TRADE:{adminId}` | `userChannel.ts` | 已对齐 |

---

## 当前拒单 / settle 入口

| 层级 | 模块 | 说明 |
|------|------|------|
| 编排 | settleBothArbLegs | 传统场馆按 A8 空等后依次拉单；待确认场馆可并发核验，Oe tip 不阻塞 |
| 编排 | legRejectWaitSec | UI config.waitTime -> 场馆 rejectWaitSec |
| 编排 | resolveVenueLegOutcome | 有 resolveLegOutcome 时**不预拉**；只传 fetchVenueOrders（2026-07 修：曾先拉再 wait，导致拒单漏检） |
| 场馆 | resolveLegOutcome / venueRejectWaitBeforePoll | wait + 拉单 + orders[0].status；对齐 A8 tip→wait→updateOrders |
| 场馆 | a8LegOutcome 短轮询 [changmen 扩展] | wait 后若空列表或 orders[0]=none，再最多 2 次、间隔 1s；终态仍只认 reject |
| 补单配对 | arbMakeUpSides | 锚腿 vs 败腿 -> enqueueA / enqueueB / null |
| 手动 A8 | betGateway.placeBet | 不做 A8 拒单复检；PM delayed settle 为扩展 |

历史表中的 `venueRejectSync`、`rejectWaitSeconds` 和 `waitRejectDetection` 已退役；当前以 `settleBothArbLegs`、`rejectWait.ts`、场馆适配器及对应测试为准。

---

## 维护说明

1. **新增对齐项**：在本文件对应章节加一行，并在专题 doc 补细节。
2. **仅 UI 像素差异**：只更新 `A8_UI_PARITY_GAPS.md`。
3. **仅单平台**：只更新 `A8_REPLICATE_8_PLATFORMS.md` + 本文件 §七 一行。
4. **changmen 扩展**：必须标 🔶，勿写入「已对齐 A8」。
