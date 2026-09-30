# changmen 文档索引

日常开发从 [readme.md](../readme.md)（摘要）与 [CLAUDE.md](../CLAUDE.md)（命令与细节）入手；本页汇总专题文档。

## 文档地图

| 类型 | 位置 | 例子 |
|------|------|------|
| 架构 / 运维 / 多运动 / catalog | `docs/` | 本文、`ARCHITECTURE.md`、`CATALOG.md` |
| 前端实现 | `client/web/src/ARCHITECTURE.md` | stores、采集链路、数据流 |
| A8 对齐（parity） | `client/web/docs/` | `A8_PARITY_REGISTRY.md` |
| 平台探针 | `devtools/platform-probes/{id}/docs/` | OB 状态映射、RAY 对照 |
| 产品线锚点 | `lines/` | `line.json`、esport/baseball |
| 共享包 | `packages/` | `shared`、`api-contract`、`client-core` |
| 历史笔记 | `docs/archive/` | 已结案排查记录 |

## 架构与部署

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Monorepo 结构、`client/*` / `server/*` / `packages/*`、数据流、**本地开发端口** |
| [MODULARIZATION_PLAN.md](./MODULARIZATION_PLAN.md) | **模块化再分析**：热点定量、P0/P1/P2 清单、与阶段 19 冻结关系 |
| [OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md) | 代码优化跟踪（数据正确性 / 性能）；与模块化计划分工见该文 |
| [MATCH_IDENTITY_MODEL.md](./MATCH_IDENTITY_MODEL.md) | **赛事/队伍身份模型与不变量**：合场、人工关联、队伍解析三者的共同契约 |
| [ARB_MULTI_SPORT.md](./ARB_MULTI_SPORT.md) | **多运动维护态**：棒/足 Tab + PM∥PF + N3 moneyline 合并；不开 N4；电竞主线见 `client/web/docs/A8_NEXT_STEPS.md`；熊猫体育试玩协议见 [OB_SPORT.md](../client/web/docs/platforms/OB_SPORT.md) |
| [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) | monorepo 目录 / `lines/` manifest / 脚本落点（服从 ARB_MULTI_SPORT） |
| [CATALOG.md](./CATALOG.md) | `sport` / `game` / `market` catalog 字段与扩展规则（**配置单一入口**） |
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
| `server/db` | [README.md](../server/db/README.md) |
| `server/storage` | [README.md](../server/storage/README.md) |
| `server/match/identity` | [README.md](../server/match/identity/README.md) |
| `server/match/resolver` | [README.md](../server/match/resolver/README.md) |
| `server/match/matcher` | [README.md](../server/match/matcher/README.md) |
| `server/realtime-hub` | [README.md](../server/realtime-hub/README.md) |
| `chrome-extension` | [README.md](../chrome-extension/README.md) · `npm run chromeplug:pack` |
| `packages/venue-adapter` | [README.md](../packages/venue-adapter/README.md) |
| `packages/` | [README.md](../packages/README.md) — `shared` · `api-contract` · `client-core` |

## 客户端 / Parity

| 文档 | 内容 |
|------|------|
| [../LOCAL_DEV.md](../LOCAL_DEV.md) | 本机 `A8/` 布局：`index0706.js` + `A8插件/` |
| [../client/web/docs/README.md](../client/web/docs/README.md) | A8 parity 文档集索引 |
| [../client/web/docs/A8_PARITY_REGISTRY.md](../client/web/docs/A8_PARITY_REGISTRY.md) | 对齐总览 |

## 运维脚本

见 [scripts/README.md](../scripts/README.md)（`changmen/scripts/` + `server/backend/scripts/` 索引）。

Windows 启动：[BAT/README.md](../../BAT/README.md)（在**本仓库根**执行；`BAT\` 本地 gitignore，见 [LOCAL_DEV.md](../LOCAL_DEV.md)）。
