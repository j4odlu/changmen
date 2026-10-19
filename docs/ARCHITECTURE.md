# changmen 架构

单一架构文档入口。命令与日常开发见 [../AGENTS.md](../AGENTS.md)。

[changmen 扩展] 2026-10-20 当前物理归属：浏览器 adapter 与测试位于 `client/packages/venue-browser`，旧目录 595 个浏览器文件及 4 个 Node 兼容入口已退役；Node loader/registry 实现位于 `server/packages/venue-node-*`，后端瘦包工具实现位于 `server/packages/venue-adapter-tools`。旧 adapter 目录保留验证命令、生成 manifest 与配套文档，下方按日期保留历史记录。后端八进程的 19 个 workspace 已通过离线独立安装、路由编译和模块解析对比；原 11 处动态路径已在默认 workspace 根下完成有界认证，外部 SDK 内部与自定义运行根不在该结论内，详见 [动态路径认证](BACKEND_DYNAMIC_PATH_CERTIFICATION.md)。平台探针的 93 个文件已迁入 `server/platform-probes`；默认 Node 资源根也已收进 `server/packages/venue-node-registry/runtime`，后端独立安装不再复制旧 adapter 目录，生产发布方式未变。

[changmen 扩展] 2026-10-18 [文件夹隔离](FOLDER_ISOLATION.md)：浏览器公共簿包和前端维护工具已实际迁入 `client/packages` 与 `client/devtools`。下方目录树区分当前落点与冻结兼容区域；前端专属旧包、扩展及 Node 工具仍有剩余迁移项，不宣称全树已隔离。

[changmen 扩展] 2026-10-17 源码归属补充：浏览器诊断实现位于 `packages/venue-adapter/browser`；RDS 维护与结构观察位于 `server/db`；公共身份规则位于 `packages/shared/match-identity`，原 identity 目录保留兼容。resolver / matcher 仍为后端。当前冻结路径和未完成项见 [四类源码隔离记录](SOURCE_FILE_ISOLATION_20261017.md)。

[changmen 扩展] 2026-10-18 [matcher 只读检查](audits/MATCHER_READONLY_AUDIT_20261018.md)：生产内嵌合场持续运行；三个 scraper 不在日常启动链，但保有历史补数标签，不能直接认定无用。发现映射 DAL 丢失 game 字段和三个辅助命令的既有语法错误；本轮未改匹配算法或生产数据。

[changmen 扩展] 2026-10-19 [比赛显示一致性方案](MATCH_PUBLICATION_CONSISTENCY_PLAN.md)与[链路审计](audits/MATCH_PUBLICATION_CONSISTENCY_AUDIT_20261019.md)：确认 matcher 与用户列表存在筛选差异、active gap 旧盘口保留及失败被当作空结果的风险。当前收敛为三步公共读取与过滤修复，尚未实现；保持现有合场、生命周期与经典 FOK 规则，不新增发布状态机或通知协议，失败处理缺陷单独记录。

[changmen 扩展] RDS 的 43 个有效迁移 SQL 与结构基线主文件位于 `server/db/assets/`，维护代码经本包 `maintenance/assets.mjs` 读取；backend 原路径的 44 份兼容副本和 7 个维护入口已退役，4 个维护测试迁入 `server/db/maintenance/`。无 backend 目录的干净安装与维护验收通过，历史 SQL/checksum 保持；详情见同一源码隔离记录。

## 目标目录（monorepo，档 B）

```
changmen/
├── client/
│   ├── web/                     # Vue 控制台
│   ├── packages/pm-market-data-browser/ # 浏览器公共簿 workspace
│   └── devtools/venue-adapter/   # 前端维护工具
├── chrome-extension/            # MV3 扩展
├── server/
│   ├── backend/                 # HTTP API、代理、静态托管
│   │   └── scripts/             # 常驻运维；ops/；archive/
│   ├── collectors/              # VPS daemon：polymarket-sports、predictfun-collector
│   ├── match/                   # 赛事匹配模块（三层）
│   │   ├── identity/            # @changmen/match-identity（纯库：队名/时间窗/ID）
│   │   ├── resolver/            # @changmen/team-resolver（外部 provider + scraper）
│   │   └── matcher/             # @changmen/matcher（compose/ 合场 + 调度 + 人工 UI）
│   ├── db/                      # @changmen/db
│   ├── storage/                 # @changmen/storage（本机 JSON 路径）
│   ├── ws_forward/              # @changmen/ws-forward（backend 挂载）
│   ├── realtime-hub/            # @changmen/realtime-hub（Socket.IO 推送）
│   └── value-bet/               # @changmen/value-bet（正 EV 扫描 daemon）
├── scripts/
│   ├── deploy/                  # 本机 → HK VPS（deploy202.bat 等）
│   ├── sync/                    # 本机 .env 片段 → VPS
│   ├── fixtures/                # API 探针快照
│   └── archive/                 # 废弃仓级脚本
├── deploy/scripts/              # VPS bash（canonical；见 deploy/scripts/README.md）
├── lines/                       # 产品线锚点（line.json；电竞代码仍在根）
├── server/platform-probes/    # 可选探针 CLI
├── packages/
│   ├── shared/                  # @changmen/shared
│   ├── api-contract/            # HTTP 契约
│   ├── client-core/             # 前端共享模型；冻结旧目录，尚未迁入 client
│   └── venue-adapter/           # 当前双端目录，含冻结 loader/registry 与浏览器平台源码
└── docs/
```

## 迁移进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1–15 | 见历史（`packages/*` + `apps/*` 阶段） | ✅ 完成 |
| 16 | **档 B**：`client/` + `server/` 物理分区；`apps/` 退役 | ✅ 完成 |
| 17 | `server/collectors/` daemon 归集；server 子包 README；`backend/scripts` 再分层 | ✅ 完成 |
| 18 | `scripts/sync/`；`deploy/scripts/README`；`backend/scripts` 根目录收尾 | ✅ 完成 |
| 19 | 目录整理**冻结**；`scripts/sync` 边界收拢；collectors 子 README | ✅ 完成 |
| I1 | **路径单点登记**：`CHANGMEN_LAYOUT` + [PATH_REGISTRY.md](./PATH_REGISTRY.md) | ✅ 完成 |
| I2a | **venue-adapter 包化**：`exports` + web 去 tsconfig include | ✅ 完成 |
| I2b | **web import 包名化**：`@venue/*` → `@changmen/venue-adapter/*` | ✅ 完成 |
| I3a | **删 web shim**：`domain/arbitrage`、`providerKeys`、`arbOpportunity` 薄层 → `@changmen/arb-core` | ✅ 完成 |
| I3b | **venue-adapter barrel**：web 深 import 收拢到 `contract`/`registry`/`adaptation`/`shared`/`polymarket`/平台 index | ✅ 完成 |
| I3c | **删 client-core shim**：web 薄 re-export → 直连 `@changmen/client-core/*`；`arbOpportunity` 仅保留 `syncArbRuntime` | ✅ 完成 |
| I3d | **venue 包内聚**：`@venue/*` → `@changmen/venue-adapter/*`；web 移除 `@venue` tsconfig/vite alias | ✅ 完成 |
| I3e | **exports 白名单**：`sync-package-exports` + web barrel 校验；删 `shared/platform` shim | ✅ 完成 |

旧路径 `platform_adapter/`、`gamebet_*` 仅出现在历史章节或迁移对照中；**以本表与代码 `package.json` / `adapter_paths` 为准**。

### 目录整理冻结（阶段 19 后）

此后**不再大规模物理搬家**；新脚本按下列落点添加：

| 类型 | 落点 |
|------|------|
| 本机 → VPS 部署 | `scripts/deploy/` |
| 本机 → VPS env | `scripts/sync/` |
| VPS bash | `deploy/scripts/` |
| 后端启动 / 日常 CLI | `server/backend/scripts/` 根（**冻结**，极少新增） |
| 后端迁移 / 归档兜底 | `server/backend/scripts/ops/migrations/` |
| 排障 / deploy 自检 | `server/backend/scripts/ops/diagnostics/` |
| 事故修复 | `server/backend/scripts/ops/incidents/` |
| 临时探针 | `*/archive/` 或 `backend/scripts/archive/` |
| 新运动 VPS collector | `server/collectors/{name}/` |

## 依赖方向

```
client/web ──@changmen/venue-adapter──► packages/venue-adapter
client/web ──HTTP───────► server/backend
client/web ──@changmen/api-contract──► HTTP 路径与 DTO
server/backend ──@changmen/api-contract──► EsportAction
chrome-extension ─（代理/凭证）─► 各平台源站

packages/venue-adapter ──采集上报──► server/backend (API_SaveMatch/SaveBet)
server/backend ──读写────► server/db (@changmen/db)
server/match/matcher ──matchMerge──► 包内 compose/（合场算法）
server/match/matcher ──共享工具──► @changmen/match-identity (teams / ids / time windows)
server/match/matcher ──队名────► @changmen/team-resolver（workspace 依赖，可选）
resolver 辅助 scraper（开发工具） ──requirePlatform──► @changmen/venue-node-loader（原实现）

server/backend ──requirePlatform──► @changmen/venue-node-loader（原冻结实现）
server/db ──公共队名规则──► @changmen/shared/match-identity
server/backend ──可选拷贝──► server/backend/platform_adapter（瘦包 / GAMEBET_ADAPTER_ROOT）
```

## packages 说明

### `packages/shared` (`@changmen/shared`)

跨进程共享：游戏/玩法 catalog、赔率格式化、IM 解析、**A8 采集开赛时间窗**（仅未来 1h 上限，无过去下限）。Polymarket 电竞 discovery 窗（主 pass 过去 6h + 未来 1h）在 `server/collectors/polymarket-esports/api.js` [changmen 扩展]；浏览器不扫盘。  
数据层与路径解析见 `@changmen/db`（`paths.js`、`load_env.js`）。  
npm workspace 成员；通过 `@changmen/shared` 包名引用。

### `packages/venue-adapter` (`@changmen/venue-adapter`)

各平台采集与下注的 canonical 源码。前端通过 `@changmen/venue-adapter`（Vite alias → `packages/venue-adapter`）。

**目录语义**：`{platform}/` 为浏览器采集（`collect.ts` / `bet.ts`）；Node 探针与会话模块在 `@changmen/platform-probes`（`devtools/platform-probes/{platform}/`），经 `requirePlatform(id, "node", …)` 加载。详见 [venue-adapter/README.md](../packages/venue-adapter/README.md) 与 [platform-probes/README.md](../devtools/platform-probes/README.md)。

各平台 CLI 采集脚本定义在本包 `package.json`；`server/backend` 通过 `npm run <script> --workspace=@changmen/venue-adapter` 转发。

**服务端解析顺序**（`loader/adapter_paths.mjs`）：

1. `GAMEBET_ADAPTER_ROOT`（瘦包显式指定）
2. `packages/venue-adapter`（**标准 monorepo**，无需拷贝）
3. `server/backend/platform_adapter`（`npm run sync:platform-adapter` 生成，已 gitignore）

## `server/match` — 赛事匹配模块

三个包按依赖层划分，**不合成单包**：`server/db/rds/team_store.js` 依赖 identity，而 resolver 依赖 `@changmen/db`，四合一会造成包级循环；identity 唯一依赖是 `@changmen/shared`，这份纯度是 backend / db / 诊断脚本能安全引用它的前提。

### `server/match/identity` (`@changmen/match-identity`)

队名工具、开赛时间窗、`client_match_ids` 与对应测试；旧 `merge/` 合并管线已下线。
resolver 与 matcher 通过 workspace 依赖复用；测试：`npm run test --prefix server/match/identity`。

### `server/match/resolver` (`@changmen/team-resolver`)

队名规范化插件；matcher `matchMerge` 与 UI `merge_mode` 动态加载 `team_db.js`。  
爬虫脚本在 `scrapers/`，为手动队伍映射补数工具，当前不进入日常启动链；环境变量通过 `@changmen/storage` 的 `loadChangmenEnv()` 加载。当前可用性见上述只读检查，不以包声明或静态解析通过代替命令验收。

### `server/match/matcher` (`@changmen/matcher`)

合场算法（`compose/`）、调度循环、运维动作（`ops/`）、人工关联（`link/` + `ui/`）、只读对照页（`ui/compare/`）。

## client / server 说明

### 本地开发端口

| 组件 | Windows | Linux / 其它 |
|------|---------|----------------|
| Vite（`client/web`） | `5274` | `5174` |
| `server/backend` | `3560` | `3456` |

Windows 上 Hyper-V 常保留 TCP `5123–5222`，故 Vite 不用 `5174`。配置见 `client/web/vite.config.ts` 与 `server/backend/server.js`。

| 路径 | 职责 |
|------|------|
| `server/backend` | `server.js`、`/esport/*` API、HTTP 代理、静态资源 |
| `server/match/matcher` | 30s matchMerge 调度壳、matcher UI、`/matcher/*`、archive；唯一合场写算法为包内 `compose/` |
| `client/web` | Vue 3 + Vite；开发端口 Win `5274` / 其它 `5174`（`vite.config.ts`） |
| `chrome-extension` | MV3 跨域代理与凭证捕获 |

## 数据流

```
浏览器/插件 (venue-adapter) → API_SaveMatch/SaveBet/SaveLiveTimer → backend → RDS platform_*
matcher 30s 循环（内嵌 esport）→ matchMergeOnce → composeOnce（生产默认）写库 → client_matches
Client_GetMatchs 只读 client_matches → web（不做 Round/promote overlay）
embedded：SaveLiveTimer debounce ~3s 触发 matchMerge（`MATCHER_TIMER_DEBOUNCE_MS`）
```

> 自动合场写路径：`@changmen/matcher` 的 `compose/` 内嵌 esport，不占独立 PM2 槽。详见 [PRODUCTION_DEPLOYMENT.md](../PRODUCTION_DEPLOYMENT.md) §3.4 与 [matcher README](../server/match/matcher/README.md)。

巡检：`node server/match/matcher/scripts/audit-client-sources.mjs`（静态 + rebuild diff；`--strict` 有问题 exit 1）。

## 团队边界（单仓）

客户端 / 服务端目录归属、禁止的跨包 import、HTTP 集成面见 [TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md)。本地校验：`npm run check:boundaries`。

## 相关文档

- [TEAM_BOUNDARIES.md](./TEAM_BOUNDARIES.md) — 两团队 monorepo 边界
- [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) — 产品线分层与棒球路线
- [../lines/README.md](../lines/README.md) — 产品线锚点 `lines/{code}/`
- [CATALOG.md](./CATALOG.md) — sport / game / market catalog（配置单一入口）
- [../server/README.md](../server/README.md) — 服务端各 workspace 包与进程
- [../AGENTS.md](../AGENTS.md) — 命令、表结构、采集间隔
- [DATA_STORAGE.md](./DATA_STORAGE.md) — RDS / JSON 边界与 **API 数据策略**（memory-first）
- [../PRODUCTION_DEPLOYMENT.md](../PRODUCTION_DEPLOYMENT.md) — 生产部署
