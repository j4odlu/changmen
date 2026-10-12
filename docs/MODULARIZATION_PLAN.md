# changmen 模块化再分析与落地计划

> **状态**：方案文档（2026-09-19）。不改运行时行为的重构 backlog；执行时按条目认领、小步验证。  
> **关联**：[ARCHITECTURE.md](./ARCHITECTURE.md)（阶段 19 冻结）、[OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md)（数据正确性 / 性能优化入口）、[TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md)、[PATH_REGISTRY.md](./PATH_REGISTRY.md)。  
> **原则**：问题集中在四五个热点；**不做全面重构**。每步零行为变更优先，验证用现成 `check:boundaries` / exports 白名单 / `npm test`。

---

## 1. 总结论

monorepo（约 22 个 workspace、约 28 万行）已较健康：exports 白名单、包边界检查、match 三层拆分、前端 betting phases 化均已落地。余量不在「再拆一轮大包」，而在：

| 热点 | 问题本质 |
|------|----------|
| `server/ws_forward` | hub 入口 / lifecycle / PM 双副本大量复制粘贴 |
| `server/backend` | `esport-api` ↔ `account` 循环依赖；ops 脚本与运行时混居 |
| `client/venue-adapter` | polymarket 一头沉；7 个 paused 平台事实死重 |
| `client/web` | **不建议拆 workspace**；仅大文件与 lint 约定 |

---

## 2. 现状定量（探查基线）

| 区域 | 规模（约） | 评估 |
|------|------------|------|
| `client/web` | 9.0 万行 | 健康，不拆包 |
| `server/backend` | 6.2 万行（`core/` ~2.9 万） | 循环依赖 + ops 混居 |
| `client/venue-adapter` | 5.2 万行 | polymarket ~36%；paused 死重 |
| `ws_forward` + collectors | ~1.1 万行 | hub 复制最严重，去重空间最大 |
| 其余包 | 均 &lt;1.5 万行 | 边界清晰，不动 |

核对摘录（文档落笔时）：

- 4 个 `*_market_hub_server.js` 入口各 ~68–76 行样板；`pm_market_hub.js` / `pm_sport_market_hub.js` 各 ~864–865 行近乎字面副本。
- `server/backend/scripts/ops` ~1.5 万行；大量 `_tmp_*` 已在 `scripts/archive/`，仍需与运行时包边界厘清。
- manifest 中 `implementation: "paused"` **7 条**（IM / TF / XBet / HG / Dex / SXBet / Azuro）；目录仍在且 `adapters.ts` 仍 import，合计 ~5.5k 行 TS/JS。
- 前端 &gt;1000 行热点：`AccountEditDialog.vue`(1773)、`PodFollowPanel.vue`(1447)、`obSportFootballFetch.ts`(1021)。

---

## 3. 关键发现

### 3.1 `server/ws_forward` — 重复最严重

- 4 个 hub server 入口 ~90% 相同（health / listen / identity / attach）。
- `pm_sport_market_hub.js` 与 `pm_market_hub.js` **~97% 相同**（功能隔离副本是历史决策，见 §6「明确不建议」）。
- 生命周期 helper（idle-close / reconnect / client registry）多份复制；可去重约 **1500–1700** 行。
- **先例**：`core/forward_stats.js`、`ws_backpressure.js`、`hub_identity.js` 已是成功共享模块——P0-2/3 照此模式扩展。

### 3.2 `server/backend` — 结构性问题最多

- `core/esport-api` → `core/account`（路由/服务）与 `core/account` → `core/esport-api`（`store` / `stubs` / `user_kv` / `market_hub_route`）**双向循环**。这是后端无法按域拆包的根本阻塞。
- `scripts/ops` 非运行时代码与运行时同包；`_tmp_` 事故脚本应彻底离开活跃面。
- `http_routes.js`（~650+ 行、大量分支）属**包内**接线 monolith。
- `proxy/` 反向依赖 core 内部多处；抽包前需「平台凭证/会话提供者」接口。

### 3.3 `client/venue-adapter` — 一头沉

- `polymarket` + `predictfun` 合计约近半包体；独占 viem/ethers/centrifuge 等外部 SDK。
- `contract` 中 `VenueOrder` 已混入 PM/PF 专属字段——最硬耦合点之一。
- 7 个 paused 平台：manifest 仍登记但 `collect/bet: false` 且 `implementation: "paused"`；源码与 adapter 注册仍在，构成 esport-freeze / 认知死重。
- 跨平台生产 import 极少；imports 纪律已够，无需再加「每平台一包」。

### 3.4 `client/web` — 不用拆包

- 无 &gt;1000 行视图惯例；store 规模可控；`stores/betting/autoBet` 已 phases + colocated 测试；`extensions/` 已是功能模块制。
- 性价比：把目录约定落到 lint（如禁 `views/` 直引 `@changmen/*`）远高于拆 `web-ui` / `web-arb`。

---

## 4. 与阶段 19 冻结的关系

见 [ARCHITECTURE.md §目录整理冻结](./ARCHITECTURE.md)。

| 条目 | 是否触碰冻结 | 处理 |
|------|--------------|------|
| P0-1 归档 paused 到包内 `_archive/` | 否（包内） | 直接做；补 fence |
| P0-2/3/4 hub / collector-kit | 否（包内共享模块） | 直接做 |
| P1-8 `@changmen/venue-prediction` | 否（新 workspace，非大规模搬家） | 做前更新本表 + exports 同步脚本 |
| P0-5 ops 迁出运行时包 | **是** | 先更新 `ARCHITECTURE.md` 迁移进度 / 脚本落点表 |
| P1-6/7 account 成包 | **是** | 同上；破环后再迁 |

---

## 5. 方案与可执行清单

**建议落地顺序**：`1 → 2+3+4（一批）→ 5 → 6+7 → 8`。  
状态约定：`TODO` / `进行中` / `已完成` / `搁置`。同时只允许一个 `进行中`（与 OPTIMIZATION_PLAN 相同纪律）。

### P0 — 低风险、纯收益

#### P0-1 归档 venue-adapter 的 7 个 paused 平台

| | |
|--|--|
| **收益** | 主包体量下降；esport-freeze 面收窄 |
| **风险** | 低（不改变 done 平台行为） |
| **状态** | TODO |

**范围**：`im` / `tf` / `xbet` / `hg` / `dex` / `sxbet` / `azuro`。

**步骤**：

- [ ] 确认无运行时仍 `require` / 动态加载这些目录（除 manifest 元数据、历史测试）。
- [ ] 移入 `client/venue-adapter/_archive/{platform}/`（或约定等价路径）；保留 README 说明如何恢复。
- [ ] 从 `registry/adapters.ts` 去掉对应 adapter import / 数组项；manifest 条目改为指向 archive 或保留元数据但 `implementation: "archived"`（团队二选一，文档写死一种）。
- [ ] 加 fence：`check:boundaries` 或 venue-adapter 包内脚本禁止 `_archive` 被非测试生产 import。
- [ ] 更新 `esport-freeze.json` / sync 瘦包脚本若引用这些路径。
- [ ] 验证：`npm run check:boundaries`、`npm run test:frontend`（或 venue-adapter 相关 vitest）、`npm run typecheck:frontend`。

---

#### P0-2 hub server 工厂化

| | |
|--|--|
| **收益** | 约 −280 行样板 |
| **风险** | 低 |
| **状态** | TODO |

**步骤**：

- [ ] 新增 `server/ws_forward/core/create_hub_server.js`（或同级）：`createHubServer({ name, portEnv, defaultPort, path, attach, getStatus, close, healthPaths })`。
- [ ] 四个入口改为薄包装：`pm_market` / `pm_sport_market` / `predictfun` / `sxbet`。
- [ ] 保持 env 端口、Caddy 路径、PM2 进程名不变。
- [ ] 验证：既有 `server/ws_forward` tests；本地起一个 hub 打 `/health`。

---

#### P0-3 抽 `hub_upstream_lifecycle`

| | |
|--|--|
| **收益** | 约 −400–500 行 |
| **风险** | 中偏低（触碰 reconnect / idle） |
| **状态** | TODO |
| **依赖** | 可与 P0-2 同批；建议 P0-2 先合入减少入口噪声 |

**步骤**：

- [ ] 从四个 hub core 抽出：定时器管理、client registry、status 骨架、idle-close / reconnect 约定。
- [ ] 各 hub 只保留协议差异（订阅消息、thin frame、上游 URL）。
- [ ] **不**合并 `pm_market` 与 `pm_sport_market` 进程（见 §6）。
- [ ] 验证：各 hub 既有单测 + 手工连一条上游（若环境有凭证）。

---

#### P0-4 轻量 collector-kit

| | |
|--|--|
| **收益** | 每个 collector 约 −60 行重复引导 |
| **风险** | 低 |
| **状态** | TODO |

**步骤**：

- [ ] 在 `server/collectors/` 或共享小模块中提供：tick 防重入、shutdown hook、env 参数化采集窗助手。
- [ ] 迁移 polymarket-sports / polymarket-esports / predictfun-collector 等现有 daemon（只改壳，不改业务 tick）。
- [ ] 验证：各 collector 包内测试；进程能 SIGTERM 干净退出。

---

#### P0-5 backend ops 治理

| | |
|--|--|
| **收益** | 运行时包约 −1.5 万行非运行时噪声 |
| **风险** | 低（脚本搬家）；触碰阶段 19 → 须先改架构表 |
| **状态** | TODO |

**步骤**：

- [ ] 更新 [ARCHITECTURE.md](./ARCHITECTURE.md) 迁移进度（新阶段或 I 条目）与脚本落点表。
- [ ] 扫 `scripts/ops` + `scripts/archive/_tmp_*`：一次性事故脚本确认只读归档；删除或移入 `scripts/archive/` / 仓库级 `scripts/ops/`。
- [ ] 决定目标：新 workspace `@changmen/backend-ops` **或** 仓库级 `scripts/ops/`（推荐后者，避免假包）。
- [ ] 修正文档 / README / CODEOWNERS 中的旧路径。
- [ ] 验证：backend 启动与 `npm run test:backend` 不依赖已迁脚本；CI 无破碎 path。

---

### P1 — 结构性（破而后立）

#### P1-6 破 `esport-api` ↔ `account` 循环

| | |
|--|--|
| **收益** | 后端一切域拆分的前置条件 |
| **风险** | 中（import 图重构，行为应不变） |
| **状态** | TODO |
| **冻结** | 触碰 → 先更新 ARCHITECTURE |

**循环锚点（落笔时）**：

- account → esport-api：`store.js`、`stubs.js`（`emptyPage`）、`user_kv.js`、`market_hub_route.js`
- esport-api → account：`account_service` / `account_store` / `admin_service` / presence / login meta 等

**步骤**：

- [ ] 画依赖图（脚本或手工），列出全部反向边。
- [ ] 下沉或反转：`stubs` / `user_kv` / market_hub 相关 → 中立模块（如 `core/user-kv`、`core/session-store`）或归入 account，使 esport-api **只**依赖 account，或双方只依赖新中立层。
- [ ] 禁止新的反向 import（边界检查规则）。
- [ ] 验证：backend 全量测试；关键 Client_* 冒烟（登录、SaveData、admin）。

---

#### P1-7 抽账号订单域包

| | |
|--|--|
| **收益** | `core/account`（含 order/）可成 `@changmen/account` 或等价 |
| **风险** | 中；依赖 P1-6 |
| **状态** | TODO |

**步骤**：

- [ ] P1-6 合入后，包边界 + `package.json` exports 白名单。
- [ ] 迁移 import 站点；保留薄 re-export 过渡一个版本（可选）。
- [ ] 验证：同 P1-6 + 订单 / PF·PM 写路径相关测试。

---

#### P1-8 拆 `@changmen/venue-prediction`（pm + pf）

| | |
|--|--|
| **收益** | venue-adapter 瘦身；SDK 依赖隔离；`VenueOrder` 去污染 |
| **风险** | 中（~48 import 站点 + 瘦包同步） |
| **状态** | TODO |

**步骤**：

- [ ] 新 workspace：迁入 `polymarket/` + `predictfun/`。
- [ ] `VenueOrder` 改为扩展字段机制（基类/通用字段在 adapter contract；PM/PF extras 在 prediction 包）。
- [ ] 更新 `sync-package-exports`、web barrel、backend `requirePlatform` / 瘦包拷贝列表。
- [ ] 验证：`typecheck:frontend`、`app:build`、相关 vitest、boundaries。

---

#### P1-9（可选）`integrations/predictfun` + `polymarket` 服务端集成独立成包

| | |
|--|--|
| **依赖** | P1-6/7（账号域） |
| **状态** | 搁置至 P1-7 完成后评估 |

---

### P2 — 顺手做（不排期强绑定）

| ID | 动作 | 备注 |
|----|------|------|
| P2-a | `proxy/` → `@changmen/http-proxy` | 先抽平台凭证/会话提供者接口 |
| P2-b | `core/shared` 治理 | 基建类并入 `@changmen/shared`；凭证/路径随域——**治理不拆包** |
| P2-c | `http_routes.js` 按域拆 route 模块 | 包内重构 |
| P2-d | 前端 3 个热点文件拆分 | AccountEditDialog / PodFollowPanel / obSportFootballFetch |
| P2-e | 扩充 `check-team-boundaries` | 如禁 views 直引深层 `@changmen/*` |

---

## 6. 明确不建议

- ❌ 前端拆 `web-ui` / `web-arb` 子包（无痛点、纯增构建链）。
- ❌ venue-adapter 每平台一包（消费者少；exports 白名单已给隔离收益）。
- ❌ 抽 `venue-shared` 包（shared 小且引用集中）。
- ❌ 合并 `realtime-hub` 与 `ws_forward`（分工清晰）。
- ❌ 动 `value-bet`、`platform-probes`（已独立）。
- ❌ **合并** `pm_sport` hub 与 `pm_market` hub 进程：虽 ~97% 相同，但「隔离副本」是明确决策；若要推翻须单独 RFC，不塞进本计划的去重项（P0-3 只抽共享 lifecycle，不合并进程）。

---

## 7. 验证机制（每步）

```bat
npm run check:boundaries
npm test
```

按触及面追加：

- hub / ws_forward：`npm test --workspace=@changmen/ws-forward`（或包内等价）
- 前端 / venue：`npm run typecheck:frontend`、`npm run test:frontend`
- 后端域：`npm run test:backend`

新包必须接入现有 `sync-package-exports` + exports 白名单。

---

## 8. 进度日志

| 日期 | 条目 | 摘要 | 验证 |
|------|------|------|------|
| 2026-09-19 | 文档 | 四路并行探查汇总成文；可执行清单入库 | 对照 hub 行数、paused=7、ops≈15k、循环 import 锚点 |

---

## 9. 下一步（执行入口）

默认从 **P0-1** 开始。认领时把对应条目状态改为 `进行中`，并在本节或 §8 追加一行。若某条需改冻结表，**先 PR 文档再动目录**。
