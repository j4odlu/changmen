# changmen 文档索引

日常开发从 [readme.md](../readme.md)（摘要）与 [AGENTS.md](../AGENTS.md)（命令与开发规则）入手；本页汇总专题文档。

## 文档地图

| 类型 | 位置 | 例子 |
|------|------|------|
| 架构 / 运维 / 多运动 / catalog | `docs/` | 本文、`ARCHITECTURE.md`、`CATALOG.md` |
| 前端实现 | `client/web/src/ARCHITECTURE.md` | stores、采集链路、数据流 |
| A8 对齐（parity） | `client/web/docs/` | `A8_PARITY_REGISTRY.md` |
| 平台探针 | `server/platform-probes/{id}/docs/` | OB 状态映射、RAY 对照 |
| 产品线锚点 | `lines/` | `line.json`、esport/baseball |
| 双端共享包 | `packages/` | `shared`、`api-contract` |
| 客户端共享包 | `client/packages/` | `client-core`、`arb-core`、`venue-browser` |
| 历史方案 / 笔记 | [docs/archive/](./archive/README.md) | 退役方案、已结案排查记录 |
| 审计证据 | [docs/audits/](./audits/README.md) | 原批次快照、失败与验收结果 |

## 文档状态

[changmen 扩展] 2026-10-22 整理：现行规范、未实施设计和历史记录分别标识。文件名中的 PLAN 不等于废弃，日期化验收也不等于当前已上线。8 份被取代的旧方案/验收正文见 [归档清单](./archive/20261022-retired-plans/README.md)，原路径仅留状态和跳转。

## 架构与部署

| 文档 | 内容 |
|------|------|
| [WORKSPACE_LAYOUT.md](./WORKSPACE_LAYOUT.md) | **当前物理目录、24 个 workspace、后端定向安装与归档布局** |
| [INDEPENDENT_DEPLOYMENT.md](./INDEPENDENT_DEPLOYMENT.md) | 当前独立发布、候选校验与回退 |
| [ACTIONS_VALIDATION_PERFORMANCE_20261019.md](./ACTIONS_VALIDATION_PERFORMANCE_20261019.md) | 当前通用发布验收归属，FOK 专项按需执行 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Monorepo 结构、`client/*` / `server/*` / `packages/*`、数据流、**本地开发端口** |
| [MATCH_IDENTITY_MODEL.md](./MATCH_IDENTITY_MODEL.md) | **赛事/队伍身份模型与不变量**：合场、人工关联、队伍解析三者的共同契约 |
| [ARB_MULTI_SPORT.md](./ARB_MULTI_SPORT.md) | **多运动维护态**：棒/足 Tab + PM∥PF + N3 moneyline 合并；不开 N4；电竞主线见 `client/web/docs/A8_NEXT_STEPS.md`；熊猫体育试玩协议见 [OB_SPORT.md](../client/web/docs/platforms/OB_SPORT.md) |
| [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) | monorepo 目录 / `lines/` manifest / 脚本落点（服从 ARB_MULTI_SPORT） |
| [CATALOG.md](./CATALOG.md) | `sport` / `game` / `market` catalog 字段与扩展规则（**配置单一入口**） |
| [RAY_PM_BASKETBALL_PHASE1_PLAN.md](./RAY_PM_BASKETBALL_PHASE1_PLAN.md) | 篮球加入电竞分类：RAY/PM 仅增加采集配置、全场获胜；篮球图标与单馆下发例外，含验证记录 |
| [../server/README.md](../server/README.md) | **服务端包索引**、进程图、常用命令 |
| [DATA_STORAGE.md](./DATA_STORAGE.md) | 云库 vs 本机 JSON、迁移目录、快照生命周期与 archive |
| [TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md) | 客户端 / 服务端目录边界 |
| [PATH_REGISTRY.md](./PATH_REGISTRY.md) | **路径单点登记**（`CHANGMEN_LAYOUT`、消费方索引） |
| [../PRODUCTION_DEPLOYMENT.md](../PRODUCTION_DEPLOYMENT.md) | 生产拓扑、环境变量、PM2 |
| [ARCHITECTURE_TRUTH_AUDIT.md](./ARCHITECTURE_TRUTH_AUDIT.md) | **架构真相审计**（2026-09-19）：Truth 清单 / 状态与运行时 ownership 矩阵 / 冲突登记（F-01..F-15）/ 最小 Index → `../.ai/architecture/index.json` |
| [AI_DEVELOPMENT_BENCHMARK.md](./AI_DEVELOPMENT_BENCHMARK.md) | **AI 开发对照实验**（Phase 3）：Baseline vs Truth-aware ×6 任务 / Safety Probe / Resolver-Truth failure log → `ai-benchmark/` |
| [../deploy/ecosystem.config.cjs](../deploy/ecosystem.config.cjs) | `changmen-esport` + `changmen-pm-sports` 进程清单 |

## 应用

| 路径 | 文档 |
|------|------|
| `server/` | [README.md](../server/README.md) — 包索引与进程图 |
| `server/backend` | [README.md](../server/backend/README.md) |
| `client/web` | [README.md](../client/web/README.md) · [MIGRATION.md](../client/web/MIGRATION.md) · [src/ARCHITECTURE.md](../client/web/src/ARCHITECTURE.md) |
| `rds` | [README.md](../rds/README.md) |
| `server/storage` | [README.md](../server/storage/README.md) |
| `packages/shared/match-identity` | 共享赛事身份纯实现；参见 [身份模型](./MATCH_IDENTITY_MODEL.md) |
| `server/match/resolver` | [README.md](../server/match/resolver/README.md) |
| `server/match/matcher` | [README.md](../server/match/matcher/README.md) |
| `server/realtime-hub` | [README.md](../server/realtime-hub/README.md) |
| `chrome-extension` | [README.md](../chrome-extension/README.md) · `npm run chromeplug:pack` |
| `client/packages/venue-browser` | [README.md](../client/packages/venue-browser/README.md) |
| `server/venues` | [README.md](../server/venues/README.md) |
| `client/packages/client-core` | [README.md](../client/packages/client-core/README.md) |
| `client/packages/arb-core` | [README.md](../client/packages/arb-core/README.md) |
| `packages/` | [README.md](../packages/README.md) — `shared` · `api-contract` |

## 客户端 / Parity

| 文档 | 内容 |
|------|------|
| [../LOCAL_DEV.md](../LOCAL_DEV.md) | 本机 `A8/` 布局：`index0706.js` + `A8插件/` |
| [../client/web/docs/README.md](../client/web/docs/README.md) | A8 parity 文档集索引 |
| [../client/web/docs/A8_PARITY_REGISTRY.md](../client/web/docs/A8_PARITY_REGISTRY.md) | 对齐总览 |

## 认证与账号

| 文档 | 状态 / 内容 |
| --- | --- |
| [COOKIE_ONLY_AUTH.md](./COOKIE_ONLY_AUTH.md) | 当前 Cookie 单轨政策；dual/legacy 仅为显式回滚保留 |
| [AUTH_MODULE_BOUNDARIES.md](./AUTH_MODULE_BOUNDARIES.md) | 认证职责与依赖边界 |
| [ACCOUNT_BACKEND.md](./ACCOUNT_BACKEND.md) | 投注账号与 RDS 持久化规则 |
| [CLIENT_CERTIFICATES.md](./CLIENT_CERTIFICATES.md) | 当前证书管理功能说明 |

## PM 交易执行

| 文档 | 内容 |
|------|------|
| [PM_GTC_MODULE_ISOLATION.md](./PM_GTC_MODULE_ISOLATION.md) | FOK/GTC 与公共订单链路的职责 |
| [GTC_COMPAT_RETIREMENT_20261014.md](./GTC_COMPAT_RETIREMENT_20261014.md) | 当前两表存储边界与旧兼容退役记录 |
| [PM_GTC_RECOVER_API.md](./PM_GTC_RECOVER_API.md) | 当前增量恢复接口 |
| [PM_PRECHECK_OPTIMIZATION_PLAN.md](./PM_PRECHECK_OPTIMIZATION_PLAN.md) | PM 预检优化方案：第一期代码与本地验收完成；一次预检确定订单、本地构单、请求并行、路由冷却及出口校时；待部署与真实性能验收 |
| [PM_SINGLE_LEG_9999_TRADING_STRATEGY_PLAN.md](./PM_SINGLE_LEG_9999_TRADING_STRATEGY_PLAN.md) | PM 9999 单边仓位交易策略研究：多场馆公允价收敛、跟价与做市候选、动态退出、费用、回测对照及分阶段验收；尚未实施或回测 |

## 未实施设计与历史记录

| 文档 / 范围 | 状态 |
| --- | --- |
| [MATCH_PUBLICATION_CONSISTENCY_PLAN.md](./MATCH_PUBLICATION_CONSISTENCY_PLAN.md) | 合场统一产出设计，未实施 |
| [PM_BOOK_RECOVERY_AND_EVIDENCE_PLAN_20261017.md](./PM_BOOK_RECOVERY_AND_EVIDENCE_PLAN_20261017.md) | 恢复与差异取证设计，未实施；原启用限制继续适用 |
| [PM_OPPOSITE_SIDE_PREMIUM_SIGNAL_PLAN.md](./PM_OPPOSITE_SIDE_PREMIUM_SIGNAL_PLAN.md) | 对侧溢价观察设计，未实施 |
| `VENUE_BROWSER_*_20261019.md` 及客户端 / Node / manifest 隔离记录 | 历史迁移证据，当前布局见 WORKSPACE_LAYOUT |
| 日期化认证 / 证书 / GTC 显示发布验收 | 原批次证据，当前规则见对应功能文档 |
| [OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md) | 2026-08-13 旧清单，待逐项复核；不再作为统一执行入口 |
| [ARCHITECTURE_TRUTH_AUDIT.md](./ARCHITECTURE_TRUTH_AUDIT.md) 与 [AI_DEVELOPMENT_BENCHMARK.md](./AI_DEVELOPMENT_BENCHMARK.md) | 日期化审计 / 实验记录，按其生命周期及证据范围引用 |

## 运维脚本

见 [scripts/README.md](../scripts/README.md)（`changmen/scripts/` + `server/backend/scripts/` 索引）。

Windows 启动：[BAT/README.md](../BAT/README.md)（在**本仓库根**执行；`BAT\` 本地 gitignore，见 [LOCAL_DEV.md](../LOCAL_DEV.md)）。
