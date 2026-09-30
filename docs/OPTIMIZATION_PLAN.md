# changmen 优化计划（活文档）

本文件是 changmen **代码正确性 / 性能优化的跟踪入口**：记录待办、风险、执行规约与进度。
AI 助手每次执行**优化类**任务都**按本文档进行**，用户可据此查看与验收。

> **分工**：包边界、去重、破循环依赖、新 workspace 拆分 → 见 **[MODULARIZATION_PLAN.md](./MODULARIZATION_PLAN.md)**（模块化）。本文不承接「全面拆包」类条目；两边发现可互相追加 backlog，但认领与进度日志分文档维护。

- 最近更新：2026-09-19（链到模块化计划）
- 关联：[ARCHITECTURE.md](./ARCHITECTURE.md)、[MODULARIZATION_PLAN.md](./MODULARIZATION_PLAN.md)、[DATA_STORAGE.md](./DATA_STORAGE.md)、[ACCOUNT_BACKEND.md](./ACCOUNT_BACKEND.md)、**[MATCH_LIFECYCLE_ROADMAP.md](./MATCH_LIFECYCLE_ROADMAP.md)**（合场 → 场次状态机演进）
- **目录注记（2026-08-07）**：match 模块已整合——`match-engine/` → `server/match/identity`、`team-resolver/` → `server/match/resolver`、`matcher/`+`match-composer/` → `server/match/matcher`。下文旧目录名为当时命名；现路径以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准。

---

## 一、审计范围与边界（诚实说明）

本计划基于一次 **中等深度（medium）走查**，不是穷尽式全量审计。

| 已覆盖 | 未覆盖（后续可补） |
|--------|--------------------|
| 全仓规模统计（大文件 / `@deprecated` / `any` / `console` / 依赖过期） | `chrome-extension/`（`content.js` 4315 行、`background.js` 3398 行）未深入 |
| `server/`（backend、db、match/identity、match/matcher link）中等深度 | `match-projector`（已删）/ `match-composer`（已并入 matcher）/ `ws_forward` / `collectors/*` 仅扫过 |
| `client/web/src` 前端（stores、大组件、打包）中等深度 | 测试有效性 / 覆盖率未评估 |
| eslint / turbo / test 脚本链路 | 未跑 profiler 做真实性能量化；未做安全审计 |

结论：下表是**高价值线索清单**，不是完整体检。新发现随时追加到 backlog。

---

## 二、执行规约（AI 每次按此执行）

每处理一个条目，严格走以下流程：

1. **认领**：把该条目状态从 `TODO` 改为 `进行中`，只允许同时一个 `进行中`。
2. **先设计**：涉及"改返回约定 / 并发时序 / 热路径"的条目，先在本文档该条目下补一段落地设计（改哪些函数、影响哪些调用方、兼容性），再动代码。
3. **小步改**：优先 `兼容 → 迁移 → 内部重构`，保留旧入口（薄 re-export）不破坏现有调用。
4. **必带验证**：
   - 新增/修改逻辑要有单测（vitest）；
   - 跑受影响的既有测试确认无回归；
   - `git stash` 对比确认**未新增 eslint 错误**（既有 lint 不强制修，除非顺手且安全）；
   - 前端改动跑 `npm run typecheck:frontend`。
5. **不擅自扩大范围**：只改本条目相关文件；发现新问题→追加到 backlog，不顺手改。
6. **记录**：完成后更新条目状态为 `已完成`，在「四、进度日志」追加一行（日期 + 改了什么 + 验证结果 + 与设计的偏差）。
7. **提交**：默认**不自动 commit**；用户明确要求时才提交，提交信息说明 why。

风险分级：`低` = 改动面小、边界清晰、易回滚；`中` = 波及多调用方或需逐一核对；`高` = 触及账号/余额/资金/下注等敏感数据，需灰度。

---

## 三、Backlog（按优先级）

### P0 — 数据正确性 / 一致性（优先）

| ID | 条目 | 位置 | 风险 | 状态 |
|----|------|------|------|------|
| P0-2 | 用户设置写：await + 失败回滚 + `ok:false` | `core/db/store.js`、`profile_store.js` 等 | 低 | ✅ 已完成 |
| P0-1 | RDS 写队列 drop 可观测 + 告警（先只加监控） | `server/db/rds/common.js` | 低（纯监控）/ 中（若改背压） | 🔶 第一步完成（可观测）；补 key / 背压待后续 |
| P0-4 | 数据层读接口区分「空」与「查询失败」 | `orders_store.js`、`client_matches_store.js`、`player_store.js`、`profile_store.js` 等 | 中 | ✅ D1~D5 已完成 |
| P0-3 | 账号读路径 `listAccountsForUser` 写副作用竞态 | `core/db/store.js` | 中→偏高 | ✅ 已完成 |

**执行顺序建议**：P0-2（已完成）→ P0-1（先只加告警）→ P0-4 → P0-3（最敏感，放最后）。

> **当前采用「混合排序」**（2026-08-03 决定）：先清 P2 里零行为变更的低风险快收益（P2-4 → P2-3 → P2-5 → P2-2），P0-1 尽早穿插（低成本"体检仪表"）；**P2-1 大文件拆分不单独提前**，并入对应 P0/P1 任务作为其第一步（改哪个文件顺手按 re-export 拆），避免同一文件返工。整体顺序：**P2-4 → P2-3 → P2-5 → P2-2 → P0-1 → P0-4 →（含 P2-1 的）P1/P0-3**。

条目细节：

- **P0-1**：`_offerWrite` 队列满且无同 key coalesce 时静默 drop。
  - ✅ **第一步（已做）**：加**按 label 的 drop 计数**（`getRdsWriteQueueStats().droppedByLabel`，自动进 `/health/diag`），drop 日志提到 `console.error` 级便于日志聚合告警。纯可观测、零写语义改动。
  - 🔶 **`_writeRds` key 审计结论**（供第二步）：高频采集写 `platform_matches`/`platform_bets`/`live_timers` **均已带 `key`**（coalesce，不丢，热路径安全）；**无 key** 的有 `client_matches`、`sport_client_matches:${sport}`（单写者 / 全量替换，**可安全补常量/按 sport 的 key**）与 `sport_venue_matches`/`sport_venue_bets`/`sport_team_venue_maps`（**increment upsert，补常量 key 会误 coalesce 丢数据，不可裸补**）。补 key 属写语义改动，留第二步逐一评估。
  - ⏳ **第二步（可选、需压测）**：给可安全的写补 key；对采集热路径做背压或调大队列。
- **P0-4**：catch 后统一 `return []`/`null`，调用方无法区分空/错。`client_matches` 链路已用 `null=失败/[]=空`（可参考）。**实测 42 个读函数全部混淆，但只有一小撮"读驱动写/结算"才是真 P0**——详见下「P0-4 落地设计」，只精修危险子集，不做 42 函数大扫除。
- **P0-3**：✅ 已完成。读函数里 `sb.saveAccountRecordsForOwner(...)` 无 await，与 `replaceAccountsForUser` 竞态。已改为读路径只更新内存规范化结果，不再写 RDS；落库仅由 `replaceAccountsForUser` / SaveData 等显式写路径完成。

#### P0-4 落地设计（区分「空」与「查询失败」）— 待批范围

**调查结论（2026-08-03，两轮子代理审计）**：`orders_store`(24) + `player_store`(14) + `profile_store`(4) 共 **42 个导出读函数，成功空结果与查询失败/无 pool 返回值完全相同**（catch 里 `console.warn` 后返回 `[]`/`null`/`0`，从不 rethrow）。

**关键判断：不做 42 函数大扫除。** 逐一改签名 + 改所有调用方风险极高、收益低。按"读结果是否驱动写/删/结算/放行"分级后，**真正 P0（读失败当空 → 数据损坏/资金错误）只有下面几处**；其余 ~37 个读只用于展示/分析，或已 fail-closed（失败=更严），失败顶多显示空列表/0，**属显示层，不在本条目改**。

**危险子集（按严重度）**：

| # | 调用点 | 读函数 | 失败当空的后果 | 严重度 |
|---|--------|--------|----------------|--------|
| D1 | `account_service.handleSaveAccounts` → `prepareAccountsForSave`（`core/db/store.js`） | `fetchAccountRecordsByOwner` | 读失败→`existing=[]`→合并丢服务端字段 / `prunePlayersNotInList` 软删账号 | **data-loss** |
| D2 | `account/order_store.saveOrder`（PF/PM 全经此） | `fetchOrdersByPlayerOrderIds` | 读失败→当新单→覆盖 `pfLedgerState`/`pmOrigin`/卖单 proceeds | **data-loss / 资金** |
| D3 | `admin_pf.ensurePredictFunHouseAccount` | `fetchAccountRecordsByOwner` | 读失败→`!existing`→重复 insert 第二条 PF 账号 | **data-loss** ✅ 已修（`loadAccountsForUserStrict`） |
| D4 | `account_store.createTagPlatform` / `findVenueAccountKeyConflict` | `fetchPlayerByVenueAccountKey`/`findVenueAccountKeyConflict` | 冲突检测失败→当"无冲突"→继续 insert（DB unique 兜底） | **security（已被约束缓解）** ✅ 已修（Strict + 写路径 fail-closed） |
| D5 | PF 结算/入账 `loadPfOrders`（`pf_player_account`/`pf_exec_settle`） | `fetchOrdersByPlayer` | 读失败→跳过结算/`pending_credit` 不入账（fail-safe 方向，重试可恢复） | **资金（可恢复）** ✅ 已修（`fetchOrdersByPlayerStrict` + `loadPfOrdersStrict`） |

**技术方案（兼容 → 迁移，零回归优先）**：

- **不改现有 lenient 读函数**（37 个 cosmetic 调用方继续依赖 `[]`/`null`，零影响）。
- 对危险子集用到的读，新增 **strict 变体**：不吞异常（去掉 try/catch 或 rethrow），DB 出错则 **throw**，真正无行才返回 `[]`/`null`。命名如 `fetchAccountRecordsByOwnerOrThrow`（或内部 `_strict`）。
- **只把危险调用方**切到 strict 变体，并在其外层 `try/catch`：读失败即 **中止该次写/删/结算**（返回 `ok:false` / 向上抛 / 保持旧值），绝不用失败结果驱动 mutation。
- happy-path（读成功）行为**完全不变**；唯一新增行为 = "DB 读失败时不再拿错数据去写，而是中止"，方向严格更安全。

**分步与风险**（账号/订单路径 = 项目定义高风险，逐个小步 + 各自单测 + 建议灰度）：

- 建议顺序 **D1 → D2 → D3 → D4 → D5**（数据丢失优先；D5 fail-safe 可最后）。
- 每步：加 strict 变体 + 改单一调用点 + 单测（模拟读 throw → 断言 mutation 被中止 / 不软删 / 不覆盖）+ 既有测试无回归 + lint 对比。
- **验证难点**：需能注入"读失败"。strict 变体让错误可抛出即可用 mock/stub 触发；`core/db/store.js` 缓存层要确认 strict 读失败不污染 `_cache`。

**待你定的范围选项**：
- (a) 只做 D1+D2 两个 data-loss（最高价值，收敛范围）；
- (b) D1~D3（含重复账号）；
- (c) 全部 D1~D5。

> 现状：已完成 D1~D5（范围 c）。P0-4 危险子集收口。

### P1 — 性能热点

> **合场相关**：见精简版 [MATCH_LIFECYCLE_ROADMAP.md](./MATCH_LIFECYCLE_ROADMAP.md)（三步：补丁写 → 馆变驱动 → 状态写清）。P1-1≈第一步；P1-2 随第二/三步自然减轻，不单独立项。

后端：

| ID | 条目 | 位置 | 风险 | 状态 |
|----|------|------|------|------|
| P1-1 | matchMerge 写库表锁 + 全表 id 扫描 | `client_matches_store.js` 写路径 | 中 | ➡️ 并入生命周期 **Phase 1**（补丁写） |
| P1-2 | `Client_GetMatchs` 缓存 miss 全量 `SELECT *` | `client_matches_store.js` + `store.loadClientMatchesFromDb` | 中 | ➡️ 并入生命周期 **Phase 2**（脏场投影） |
| P1-3 | 批量存账号 venue key 冲突 N+1 | `player_store.js:1042-1057` | 低 | TODO |
| P1-4 | canonical team 批量 upsert 逐条 query | `team_store.js:414-429` | 低 | TODO |
| P1-5 | 订单套利分析 `ABS(link)` 自连接无索引 | `orders_store.js:1278-1314` 等 | 中 | TODO |

前端：

| ID | 条目 | 位置 | 风险 | 状态 |
|----|------|------|------|------|
| P1-6 | 主循环每 100ms 全量扫盘读 fo | `stores/match/mainBetLoop.ts:48`、`matchStore.ts:153-174` | 中 | TODO |
| P1-7 | `matchStore.matchs` class 树被深度代理 | `matchStore.ts:32` + `client-core/models/match.ts` | 中 | TODO |
| P1-8 | 赛事列表无虚拟化，全量渲染 MatchCard | `HomeView.vue:156`、`SportMatchBoard.vue:79` | 中 | TODO |
| P1-9 | 订单展示函数模板内重复调用 | `OrderList.vue:664,681`、`OrderView.vue:31-38` | 低 | TODO |
| P1-10 | `oddsStore.clean()` 不清 `betIndex` 孤儿 | `stores/oddsStore.ts:246-259` | 低 | TODO |

### P2 — 可维护性 / 工程链路

| ID | 条目 | 位置 | 风险 | 状态 |
|----|------|------|------|------|
| P2-1 | 超大文件拆分（薄 re-export 保兼容） | `orders_store.js`、`match_merge.js`、`matcher/link/index.js`、`orderLink.ts`、`AccountEditDialog.vue`、`AdminPredictFunMembersView.vue` | 中 | TODO |
| P2-2 | 消除重复逻辑 | `parseTitleTeams`、`buildPlatformRows*`、`providerStartTimeListAllowed`（match_merge / link / store 各一份） | 低 | TODO |
| P2-3 | `test:catalog-smoke` 超长命令收敛为 runner | `package.json`、`scripts/catalog-smoke.mjs` | 低 | ✅ 已完成 |
| P2-4 | `turbo.json` test/typecheck 补 `inputs` 提升缓存 | `turbo.json` | 低 | ✅ 已完成 |
| P2-5 | 拆 Polymarket 密码学依赖（2.4MB chunk 瘦身） | `venue-adapter/polymarket/*`、`views/HomeView.vue`、`client/web/vite.config.ts` | ①中→偏高 / ②低 | ⏸️ 搁置（2026-08-03 用户决定，诊断+方案已存档，见下） |

### P2-5 落地设计（Polymarket 密码学依赖拆分）— 暂缓待批

**调查结论（2026-08-03 实测构建产物）**：

- `venue-polymarket` chunk = **2,446 KB（gzip 690 KB）**，全仓最大；`@polymarket` SDK + viem + PM 全部代码都在内。
- 它被 `HomeView.js` **静态 import**（`from"./venue-polymarket…"`）→ 在主交易路径**急加载**。
- 试过最小改动「异步化 `AccountEditDialog`」（候选 B）：重建后 HomeView 仍静态依赖该 chunk，2.4MB 照旧急加载。**B 单独无效，已回退。**
- **根因（急加载侧）**：`venue-adapter/polymarket/index.ts` 是大 barrel，`export *` 把轻量 helper（`resolvePmRemainingShares` 等，被 MatchCard/orderStore/BetRow/orderLink 等 ~18 个急加载模块静态引用）与重密码学模块（`depositWallet`/`relayer`/`polygonRpc`/`credentials`）汇到一起；`vite.config.ts` 的 `manualChunks`（`venueChunkName`）又把 `polymarket/` 下所有文件锁进同一个 `venue-polymarket` chunk。任一轻量消费者都会把整包 2.4MB 拽成急加载。

**深层诊断（2026-08-03 补测 `stats.html` 按包聚合 chunk 组成，绝对值 visualizer 会重复计数偏大，占比准确）**：

| 依赖 | raw | 说明 |
|------|-----|------|
| **viem** | ~2.5MB | 绝对主凶，约占一半 |
| ox / @noble/curves / @noble/hashes | ~1.1MB | viem 的底层密码学原语 |
| **@ethersproject/\*（ethers v5 全家桶）** | ~0.5MB | providers/abi/signing-key/hash/contracts… |
| axios / @polymarket SDK 本体 | ~0.3MB | SDK 自身其实很小 |

- **我们自己的 viem 引用是干净的**：`polygonRpc.ts` / `relayer.ts` / `depositWallet.ts` 全用精确子路径（`createPublicClient`、`encodeFunctionData`、`viem/chains` 的 `polygon`），可 tree-shake，占比很小。
- **真正元凶 = `@polymarket/builder-relayer-client`**：① 它一个包**同时依赖 `ethers 5.8` + `viem 2.31`**（两套 EVM 密码学栈都由它拖入）；② 它是**纯 CJS 包**（`package.json` 无 `type`/`module`/`exports`/`sideEffects`，`main: dist/index.js`）→ **打包器无法 tree-shake**，只能把它内部 `require("viem")`、`require("ethers")` 的**整份**塞进 chunk。viem 因此从"我们用的一小撮"膨胀成 2.5MB。

**方案对比（结论：懒加载只推迟不减量；治本要动依赖）**：

- **① 治本（最优，推荐立为独立任务）**：绕过 `@polymarket/builder-relayer-client` + `builder-signing-sdk`，用我们**已精确引入的 viem** 自实现 relayer 调用（`relayer.ts` 实际只用到其 `RelayerTxType` 枚举 + `Transaction` 类型 + 「构造 EIP-712 → 签名 → POST relayer」这一段）。删掉这两个 CJS SDK 即可连带甩掉它锁的**整套 ethers v5（~500KB raw）**与它 CJS 拉进的**整份 viem**，chunk 有望从 2.4MB 降到几百 KB。
  - 代价/风险：签名必须严格**对拍**（已有 `relayer.test.ts` 的 decode 测试可扩为对拍基线，比对旧 SDK 与新实现产出的 typed data / signature 字节一致）；触及资金签名路径，风险 `中→偏高`，需灰度。
  - 前置验证：先确认 `relayer.ts` / `depositWallet.ts` 到底依赖 SDK 哪些导出、能否用 viem `signTypedData` 等平替（可行性 spike）。
- **② 止血（低风险，可与①叠加）**：懒加载 defer——把 2.4MB 从主交易路径的**急加载**改为**按需/异步**加载。**不减总量**，但首屏与主界面初次渲染立即受益；用户进入 Polymarket 相关流程时才付这份下载。落地设计见下「② 落地设计」。
- **③ 服务端签名（不建议）**：浏览器彻底不打包 viem/ethers，收益最大，但违反 A8 parity（浏览器本地签名、直连场馆）且私钥上服务端，安全模型改变。
- **④ patch-package / externals+CDN（不推荐）**：前者对 CJS 包无效（根因是 CJS 而非缺 `sideEffects`）；后者总字节不减。

**建议节奏**：先做 ②（止血首屏，低风险快落地）→ 再把 ① 立为独立任务（自实现 relayer + 签名对拍 + 灰度）真正把 2.4MB 打下来。

> **⏸️ 现状决定（2026-08-03，用户拍板 A：暂不动）**：Polymarket 相关流程当前线上稳定、用户未反馈问题；① 触及资金签名路径，"大只是慢、不是 bug"，不值得为体积去冒签名出错（下注失败/被拒）的风险。**② 也一并暂不做**，避免打包层面误配置引入白屏风险。本条目整体搁置，诊断与方案原样留档；将来若有明确收益诉求或用户放心，再从 ①的只读可行性 spike 起步。

**② 落地设计（懒加载 defer，需两处配合，缺一不可）**：

1. **断开静态边**：`AccountEditDialog.vue`（唯一急加载的重密码学消费者）改为在 call site **动态 `await import(...)`** 加密函数（`normalizePolymarketPrivateKey` / `resolvePolymarketSignerAddress` / `resolvePolymarketDepositWalletFromPrivateKey` / `createOrDerivePolymarketApiCreds` / `preparePolymarketWallet` / `fetchPolymarketRelayerStatus`），不再经 barrel 静态引入。涉及保存 / 派生 / 探测 / watch 输入私钥多个用户流，逐个改。
2. **vite `manualChunks` 拆桶**：把 `depositWallet`/`relayer`/`polygonRpc`/`credentials`/`walletPrepUnified`/`pmWalletPrepSdk` + `@polymarket`/viem 路由到独立 `venue-polymarket-crypto` chunk（`venueChunkName` 加规则）。

**风险与验证要求**：

- 触及 canonical `venue-adapter`：`fetchPolymarketRelayerStatus` 等纯 fetch 函数建议拆到无 viem 的独立文件（`relayerStatus.ts` / `depositWalletPure.ts`），避免 watch 输入私钥也拉 viem；需过 `check:exports` / `check:web-imports`（`exports` 字段已支持 `./polymarket/orders` 等深路径，加新深路径同理）。
- `vite.config.ts` 注释**明确警告**：乱动 `manualChunks` 可能触发循环依赖 → **白屏**。改后**必须实机验证**：登录进主界面无白屏、账号编辑保存/派生正常、下注/卖出正常（建议浏览器子代理走一遍）。
- 完成判定：重建后 `HomeView.js` 不再 `from"./venue-polymarket…"`；venue-polymarket-crypto 仅被动态/异步 chunk 引用。

**参考**：详见探索报告 [PM 密码学依赖链路](77a5c7e8-beb2-40d4-9eaa-019d585ba360)（候选 A/B/C/D/E）。

### 待补充审计（覆盖盲区）

| ID | 范围 | 状态 |
|----|------|------|
| A-1 | chrome-extension（content.js / background.js） | 未审计 |
| A-2 | server/match/matcher（compose）/ ws_forward / collectors | 未审计 |
| A-3 | 测试覆盖率与有效性评估 | 未审计 |
| A-4 | 真实性能 profiling 量化 | 未做 |

---

## 五、Legacy 合场路径下线（P3，✅ 2026-08-04 完成）

**目标**：下线旧写路径 `MATCHER_WRITER=legacy`（`match-engine/merge/` 旧管线 + `match-projector` 覆写），生产已由 `match-composer` 独占。

**取舍（阶段 0 决策，动代码前须确认）**：
- [x] 确认放弃 `MATCHER_WRITER=legacy` 应急回滚窗口（下线后回滚靠 git revert / 版本回退）。
- [x] `audit:client-sources` 已迁移到 composer dry-run；`composer:diff` 保留。

**关键事实（来自耦合面盘点）**：composer **不** import `match-engine/merge`（有 CI 闸 `check-no-merge-import`），只共享 `match-engine` 的 `teams/` + `ids/` 与 matcher 的 `align_unmatched_to_client.js`。删 merge/projector **不波及 composer 编译与测试**。但有几处**共享边缘引用**必须先迁移，否则删 merge 会连带炸：
- `matcher/ui/matcher_data.js` 的 `normalizeMatchesShape`（composer 有自有副本 `src/io/snapshot.js`）
- `scripts/audit-client-sources.mjs` 的 `previewMatchMergeOnce` / `swapBetSource`
- `client/web/scripts/test-ob-getmatchs-shape.mjs` 的 `buildMatchListAccumulate`
- `devtools/platform-probes/ray/scripts/verify_save_bets.js` 直引 `merge/bet_builder.js`
- `match-engine/index.js` 对 merge 的 re-export（需修剪，保留 teams/ids 导出）
- `merge/match_lifecycle.js` 依赖 `match_merge.js` 的 `liveRound`（不能单留 lifecycle）

### 分阶段（每阶段独立可部署、可回退）

**阶段 1 [改] 断 legacy 写分支（不删包，先固定走 composer）**
- [x] `matcher/ops/match_merge_once.js`：删除 legacy 分支与 projector side engine，`matchMergeOnce` 恒走 composer。
- [x] `audit-client-sources.mjs` 迁移到 `composeOnce({ write:false, registerTeams:false })`。
- [x] matcher UI 写路径固定显示 composer，删 legacy/projector 文案。
- [x] `.env.example` 删 legacy/SIDE 开关。
- 验证：`composer:test`、`test --prefix server/match/matcher`、`app:build`、`check:boundaries` 全绿；matcher UI 手测合并/连线正常。

**阶段 2 [删] 整包 `match-projector`**（前置：阶段 1）
- [x] 删除 `server/match-projector/**`（含 tests/docs）。
- [x] 删除 workspace 与 `projector:*` scripts，更新 lockfile。
- [x] 删除 projector 边界规则。
- [x] composer write guard 删除 projector HB 检查，保留 matcher/composer 双写防护。
- 验证：`composer:test`、`check:boundaries`、`app:build` 全绿。

**阶段 3 [删] `match-engine/merge/`**（前置：阶段 1、2 + 边缘引用已迁移）
- [x] UI/audit/OB 离线测试/RAY 探针迁移到 composer 对应工具。
- [x] 删除 `merge/**` + 19 个 merge 专属测试；修剪根导出，保留 teams/ids/time windows。
- [x] 删除 `computeMatchMergeList` / `previewMatchMergeOnce`。
- 验证：match-engine 保留 **6 个** teams/ids/align 测试（31/31）；composer 78/78；matcher 27/27。`align_unmatched` 是 composer 共享行为，纠正原计划后保留其测试。`sync_platform_links` 既有失败随旧 merge 删除。

**阶段 4 [删] 开关层简化**（前置：阶段 1–3）
- [x] 删除 `matcher/lib/side_engine.js`。
- [x] 删除 `matcher_writer.js`；write guard 固定拒绝独立 WRITE，保留 FORCE 应急旁路。
- [x] 删除 `matcher_writer.test.mjs`，同步更新 write guard 测试。
- [x] 文档统一为“单写路径 composer”。

### [保留] 不可动（composer/matcher 仍依赖）
`match-engine/teams/**`、`ids/client_match_ids.js`、`time_windows.js`、`matcher/ops/align_unmatched_to_client.js`、`match-composer/**`、`matcher/loop.js`+link+UI 主体、composer write_guard 的 matcher/composer HB 防护、teams/ids/align 的 6 个测试。

---

## 四、进度日志

| 日期 | 条目 | 改动摘要 | 验证 | 偏差 |
|------|------|----------|------|------|
| 2026-08-03 | P0-2 | 用户设置写改 `await writeProfileAsync` + 失败回滚内存并返回 `ok:false`；新增 `writeProfileAsync`；3 个调用点（`Client_UpdateSetting`/`Client_SaveData`/`BetTarget`）await + 捕获失败 | 新增 `store.settings.test.mjs` 5 测全过；既有测试无回归；`git stash` 对比零新增 lint | 取消原设计的 dirty 后台重试队列（与"失败回滚"语义矛盾、有覆盖新值风险），改为回滚 + `ok:false` |
| 2026-08-03 | P2-4 | `turbo.json` 为 `test`/`typecheck`/`lint` 补 `inputs: ["$TURBO_DEFAULT$","!**/*.md","!**/docs/**"]`（不动 `build`） | web typecheck 输入 512→476；dry-run 验证改 markdown 后 hash 不变（`2e8ccd37`）；确认无测试读取 `.md` fixture | 无 |
| 2026-08-03 | P2-3 | 新增 `scripts/catalog-smoke.mjs`（数据驱动 STEPS 数组，顺序 + fail-fast，保持原 `&&` 语义）；`package.json` `test:catalog-smoke` 收敛为 `node scripts/catalog-smoke.mjs` | 全 15 步运行通过 exit 0；lint 仅 2 处 `no-console` 警告（CLI 打印，符合预期） | 无 |
| 2026-08-03 | P2-5（调查） | 实测基线构建 + 试候选 B（异步 AccountEditDialog）后**回退**；查明 2.4MB `venue-polymarket` 急加载的根因（barrel + manualChunk 耦合）；详细落地设计写入本文档「P2-5 落地设计」 | 构建产物 grep 证明 B 无效已回退；`HomeView.vue` 已 `git checkout` 还原干净 | 按用户决定：本条目暂缓，先存档设计待批 |
| 2026-08-03 | P0-1（第一步） | `common.js` 加 `droppedByLabel` 按 label 归因（自动进 `/health/diag`）+ drop 日志提到 `error` 级；纯可观测、不动写语义 | `write_queue.test.mjs` 新增归因测试，6/6 通过；`git stash` 对比零新增 lint | 缩小范围为「只加可观测」；补 key/背压（含审计结论）留第二步 |
| 2026-08-03 | P2-5（深层诊断） | `build:analyze` 生成 `stats.html` 后按包聚合 `venue-polymarket` 组成：查明 2.4MB 主凶是 **viem（~2.5MB）+ 双密码学栈（viem/ox/@noble + ethers v5）**，根因是 `@polymarket/builder-relayer-client` 为**纯 CJS 包**（无 ESM/exports/sideEffects）整份拉入 viem+ethers 无法 tree-shake；确认我方 viem 引用已精确。方案①（自实现 relayer 去 SDK 治本）②（懒加载止血）写入本文档 P2-5 段 | 仅诊断+文档，无代码改动；`stats.html` 数据经 nodeParts/nodeMetas 聚合复核 | 修正早期"SDK 本身很大"的判断；元凶为 CJS SDK 传递依赖 |
| 2026-08-03 | P2-5（决定） | 用户拍板 A：**整体搁置，不动代码**（PM 线上稳定、① 触及资金签名风险不划算、② 也暂不做）；P2-5 状态改 ⏸️ 搁置，诊断与方案原样留档 | 无代码改动 | 与"先②后①"建议节奏不同：按用户风险偏好整体暂停 |
| 2026-08-04 | P0-4 D1 | 新增 `fetchAccountRecordsByOwnerStrict`（查询失败抛、无 pool/无 uid/无行返回 `[]`）+ facade 导出；`prepareAccountsForSave` 改用 strict 回源；`handleSaveAccounts` 包 try/catch，读失败返回 `ok:false` 中止（不合并/不 prune）。保留 lenient 版给只读/刷新路径 | `store.settings.test.mjs` 新增 D1 3 测（成功回源/失败抛不污染缓存/内存有值不回源）全过；facade 运行时校验 4 导出均在、strict 早退不查库、真查询失败会抛 | 范围 a：只做 D1+D2 |
| 2026-08-04 | P0-4 D2 | 新增 `fetchOrdersByPlayerOrderIdsStrict`（同上语义）+ facade 导出；`saveOrder` 合并基线改用 strict，读失败 `return false` 中止（不 upsert 覆盖账本）；`order_store_link.test.mjs` mock 把 strict 与 lenient 指向同一 fn 让既有 29 用例继续驱动 | 新增 D2 abort 用例通过；`git stash` 对比 8 个 tracked 文件 lint 63=63 零新增 | pf_exec_buy 对 `false` 已有重试+清晰报错，读写共池"RDS 挂"两者同样失败，无实际回归 |
| 2026-08-04 | 顺手修（非 P0-4） | 修 `order_store_link.test.mjs > PM settled open buy...` 预存在失败：`money` 断言由写死 `50` 改为按结算公式 `shares*fx-bet` 动态算（`57b93bf8` 改结算 PnL、`3d6c6fff` 改汇率 6.8→6.7 后测试未同步）。34 是正确的 fee-inclusive 结算值 | 该文件 30/30 全绿；deploy 门 `npm run app:build` 通过；后端测试门 42/42；`check:boundaries` OK；两个 `user_*` node-assert 文件用 `node` 跑各自 ok（非 vitest 用例、`npm test` 不 glob 到） | 因编辑过该文件顺手清红，非 P0-4 范围；34≠50 本就不在 deploy/CI 门内 |
| 2026-08-07 | PM-ID 抖动（composer 审计 P0-3 根因） | `polymarket-esports`：新增 `polymarketEventForceDeletable`（只认稳定单调 `closed`，**不看**官方明示会抖的 `ended`）；exclude 仅收 `closed`，`ended` 仅跳过采集不强删；`loop.js` 的 `forceDeleteIds` 减去本轮 candidates（双保险）。根因：结算过渡期 `ended` 每 60~120s 翻转→仍 acceptingOrders 的场被反复写→强删→`platform_matches.match_id` 外键置空→ID 复用断裂→重建换新 ID（13 活跃却用到 id=913）。生产取证：PM 6h 内 114 次删除仅涉 46 场（均 2.5 次/场），757708 每 60s 写删一轮 863→885→null | PM 采集器 22/22（全新执行非缓存）；全量 turbo 9/11 通过，2 失败（web 7 汇率/URL、ws-forward RAY 握手）经 `git stash` 基线对照逐条一致，为既有无关问题；提交 `f56608e5` | 复核推翻早期"ended_filter 相邻周期翻转"假设：真因在 PM 采集器写删，非 composer 结束判定 |
| 2026-08-13 | P0-3 | `listAccountsForUser` 去掉 fire-and-forget `saveAccountRecordsForOwner`；乘网规范化仅更新内存，落库留给 `replaceAccountsForUser`/SaveData | `store.settings.test.mjs` 新增 2 测（读不写 RDS / 显式 replace 仍写），全文件通过 | 未另做 dirty 后台 flush：与「读不写、写路径唯一」一致；历史 multiply 待下次 SaveData 落库，运行时内存已规范化 |
| 2026-08-13 | P0-4 D3 | 新增 `loadAccountsForUserStrict`（失败抛、不污染缓存）；`ensurePredictFunHouseAccount` 改用 strict，读失败抛「已阻止重复开通」且不 CreateTagPlatform | `admin_pf_ensure.test.js` 3 测 + `store.settings` 2 测 strict 全过 | 列表/充值等展示路径仍用 lenient `loadAccountsForUser` |
| 2026-08-13 | P0-4 D4 | 新增 `fetchPlayerByVenueAccountKeyStrict` / `findVenueAccountKeyConflictStrict`；`createTagPlatform`、`insertPlayerRow`、`batchSavePlayerAccountRecords` 写路径改 strict，读失败中止建号/保存 | `account_store_create_tag.test.js` 4/4（含 D4 失败中止） | lenient 版保留给非写路径；DB unique 仍为第二道保险 |
| 2026-08-13 | P0-4 D5 | 新增 `fetchOrdersByPlayerStrict` + `loadPfOrdersStrict`；结算/入账/卖出/恢复/官方同步/client handlers 改 strict；读失败中止（不当「无单」跳过）。`publishPfBalanceKnown` 等展示仍用 lenient | `pf_player_account_d5` + `orders_store` D5 + `pf_recover_stuck`/`pf_client_handlers` mock 共用 Strict | P0-4 危险子集全部完成 |
| 2026-08-13 | 合场演进路线 | 用户确认终态=场次状态机（方案 3）；新建 `MATCH_LIFECYCLE_ROADMAP.md`：Phase0 契约 →1 补丁写 →2 脏投影 →3 增量合场 →4 状态机；P1-1/P1-2 并入 Phase1/2 | 仅文档 | 先过程后终态；当前停在 Phase 0 待批状态/事件表 |
| 2026-08-13 | Phase 0 冻结 | 用户拍板 **禁止 ended→active**；路线文档补状态/事件表、补丁写契约、对账信号；Phase 0 退出 | 仅文档 | 下一步：Phase 1 落地设计 |
| 2026-08-13 | 职责模型 + Phase1 设计 | 对齐「Save*=馆状态；changmen=自有状态+映射」；`MATCH_LIFECYCLE_ROADMAP` 补总览与 Phase1 文件/步骤/开关/退出标准 | 仅文档 | 待用户批准后再改写路径代码 |
