# changmen 架构

当前源码归属见 [workspace 总览](WORKSPACE_LAYOUT.md)，开发规则以本机 `AGENTS.md` 为准，常用命令见 [LOCAL_DEV.md](../LOCAL_DEV.md)，生产发布见 [独立部署](INDEPENDENT_DEPLOYMENT.md)。本文描述当前结构；历史迁移记录不作为现行操作步骤。

changmen 保持单仓：客户端位于 `client/` 与 `chrome-extension/`，服务端位于 `server/`，数据层位于根目录 `rds/`。workspace 清单以根 `package.json` 为准。身份领域包 `packages/match-identity` 只依赖 shared，供 matcher、resolver 和 RDS 使用，客户端禁止引用。

## 当前目录

```text
changmen/
├── client/
│   ├── web/                         # Vue 控制台
│   ├── listener/                    # 监听版入口及构建配置
│   ├── packages/                    # arb-core、client-core、venue-browser、pm-market-data-browser
│   └── devtools/venue-adapter/       # 前端维护工具
├── chrome-extension/                # MV3 扩展
├── server/
│   ├── backend/                     # HTTP API、代理、宿主服务
│   ├── venues/                      # @changmen/venue-node：平台运行模块、loader、registry、打包工具
│   ├── platform-probes/             # 可选 Node 平台探针
│   ├── collectors/                  # VPS discovery 与平台快照采集
│   ├── match/{matcher,resolver}/     # 合场与队名规范化
│   ├── storage/                     # 本地路径、JSON、环境配置
│   ├── ws_forward/                  # WebSocket 转发及独立 market hubs
│   ├── realtime-hub/                # 用户频道实时推送
│   └── value-bet/                   # 正 EV 服务
├── rds/                             # @changmen/db：数据访问、assets、maintenance
├── packages/{shared,api-contract,match-identity}/
├── packages/venue-adapter/           # 历史兼容检查入口与生成资产；不是运行时 workspace
├── devtools/runtime-tooling/         # 开发与构建共享工具
├── scripts/                         # 仓级检查、发布控制、同步工具
├── deploy/                          # 进程配置、VPS 激活与回滚脚本
├── sh/                              # Linux 本机脚本
├── lines/                           # 产品线 manifest
└── docs/
```

历史目录迁移与验收见 [源码隔离记录](SOURCE_FILE_ISOLATION_20261017.md)、[文件夹隔离记录](FOLDER_ISOLATION.md) 和 [后端动态路径认证](BACKEND_DYNAMIC_PATH_CERTIFICATION.md)。旧目录、安装数量及当时待办不代表当前状态。

### 新文件归属

新文件按职责放入现有模块；目录整理不随日常业务改动扩大范围：

| 类型 | 落点 |
|------|------|
| Actions 发布控制与运输 | `scripts/deploy/` |
| 本机 → VPS env | `scripts/sync/` |
| VPS bash | `deploy/scripts/` |
| 后端启动 / 日常 CLI | `server/backend/scripts/` 根（**冻结**，极少新增） |
| 数据库资产 / 维护 / 历史脚本 | `rds/assets/`、`rds/maintenance/`、`rds/maintenance/legacy/` |
| 排障 / deploy 自检 | `server/backend/scripts/ops/diagnostics/` |
| 后端业务事故编排 | `server/backend/scripts/ops/incidents/`；数据库操作经 `@changmen/db` |
| 临时探针 | `*/archive/` 或 `backend/scripts/archive/` |
| 新运动 VPS collector | `server/collectors/{name}/` |

## 依赖方向

```text
client/web ──平台实现──► @changmen/venue-browser
client/web ──共享模型/套利──► @changmen/client-core / @changmen/arb-core
client/web ──HTTP/实时频道──► server/backend
浏览器/插件 ──采集上报──► server/backend ──持久化──► @changmen/db (rds)
VPS collectors ──平台快照──► @changmen/db
server/backend ──宿主端口注入──► @changmen/matcher
matcher ──合场算法──► compose/ ──数据访问──► @changmen/db
matcher / resolver / rds ──身份规则──► @changmen/match-identity
server/backend / probes ──Node 平台加载──► @changmen/venue-node
```

客户端不导入服务端或 RDS 实现；matcher 不反向导入 backend，宿主能力经 `runtime_ports.js` 注入。跨端共享规则和 HTTP 契约分别归 shared 与 api-contract。

## packages 说明

### `packages/shared` (`@changmen/shared`)

跨进程共享：游戏/玩法 catalog、赔率格式化、IM 解析、**A8 采集开赛时间窗**（仅未来 1h 上限，无过去下限）。Polymarket 电竞 discovery 窗（主 pass 过去 6h + 未来 1h）在 `server/collectors/polymarket-esports/api.js` [changmen 扩展]；浏览器不扫盘。  
数据库访问见 `@changmen/db`；本地路径和环境加载见 `@changmen/storage`。
npm workspace 成员；通过 `@changmen/shared` 包名引用。

### 浏览器平台与 Node 平台设施

浏览器采集、报价、下单实现归 `client/packages/venue-browser`，经 `@changmen/venue-browser` 公共入口使用；Node loader/registry 及瘦包工具归 `server/venues`，公开包名为 `@changmen/venue-node`。探针位于 `server/platform-probes`，不参与默认浏览器采集链。旧 `packages/venue-adapter` 只保留兼容检查入口、生成资产和历史文档。

平台目录的唯一维护源为 `packages/shared/catalog/venue_manifest.json`；修改后运行 `npm run sync:venue-manifest` 和 `npm run check:venue-manifest`，一并提交生成副本。

Node 资源解析由 `server/venues/loader/adapter_paths.mjs` 的 `getAdapterRoot()` 管理：先看显式 `CHANGMEN_ADAPTER_ROOT`（兼容 `GAMEBET_ADAPTER_ROOT`），再看 `@changmen/storage` 定义的默认资源根 `server/venues/registry/runtime`、Node 包根与已有瘦包位置。不要恢复旧 adapter 运行实现。

可选瘦包工具：从仓库根运行 `npm run sync:platform-adapter --workspace=@changmen/backend`。生产仍统一从 Actions 发布经过验收的制品，不能用本机打包代替发布验收。参见 [浏览器包](../client/packages/venue-browser/README.md)、[Node 探针](../server/platform-probes/README.md)。

## `server/match` — 赛事匹配模块

身份领域包位于 `packages/match-identity`，resolver 与 matcher 位于 `server/match`；三个包按依赖层划分，**不合成单包**：`rds/rds/team_store.js` 依赖 identity，而 resolver 依赖 `@changmen/db`，四合一会造成包级循环；identity 唯一依赖是 `@changmen/shared`，这份纯度是 backend / db / 诊断脚本能安全引用它的前提。

### `packages/match-identity` (`@changmen/match-identity`)

队名工具、开赛时间窗、`client_match_ids` 与对应测试；旧 `merge/` 合并管线已下线。
resolver 与 matcher 通过 workspace 依赖复用；测试：`npm run test --workspace=@changmen/match-identity`。

### `server/match/resolver` (`@changmen/team-resolver`)

队名规范化插件；TS 根入口统一导出 RDS 队伍映射和体育队名规则。matcher `matchMerge` 与 UI `merge_mode` 动态加载 `@changmen/team-resolver/team_db`（源码 `team_db.ts`）；backend 经 `@changmen/team-resolver/sport_team_plugin` 使用体育队名规则。包内实现均参加严格 TS 检查。
旧 RAY / OB / PB 手动队伍爬虫、外部 provider 在线查询、本地队伍缓存和 seed/在线诊断命令已退役，resolver 不再依赖平台 Node loader 或 HTTP 客户端。RDS 字段、通用 provider ID 索引和历史 SQL 保留。环境变量通过 `@changmen/storage` 的 `loadChangmenEnv()` 加载。

### `server/match/matcher` (`@changmen/matcher`)

合场算法（`compose/`）、调度循环、运维动作（`ops/`）、人工关联（`link/` + `ui/`）、只读对照页（`ui/compare/`）。

## client / server 说明

### 后端订单日志诊断

[changmen 扩展] `server/backend/core/admin_tools/user_log_lookup.js` 保留原有公共导出，
内部由 `user_log_lookup/query.js` 编排用户、订单、执行观察及旧日志的只读查询；
`rules.js` 保留时间窗与相关性匹配，`logs.js` 解析日志和切分尝试，`sections.js` 组织平台、订单和主客腿，
`payload.js` 处理订单字段白名单、API 投影及 CLI 报告。权限检查仍由外层 `core/account/admin_orders.js` 执行。

### 本地开发端口

| 组件 | Windows | Linux / 其它 |
|------|---------|----------------|
| Vite（`client/web`） | `5274` | `5174` |
| `server/backend` | `3700` | `3456` |

Windows 上 Hyper-V 常保留 TCP `5123–5222`，故 Vite 不用 `5174`。配置见 `client/web/vite.config.ts` 与 `server/backend/server.js`。

| 路径 | 职责 |
|------|------|
| `server/backend` | `server.js`、`/esport/*` API、HTTP 代理、静态资源 |
| `server/match/matcher` | 30s matchMerge 调度壳、matcher UI、`/matcher/*`、archive；唯一合场写算法为包内 `compose/` |
| `client/web` | Vue 3 + Vite；开发端口 Win `5274` / 其它 `5174`（`vite.config.ts`） |
| `chrome-extension` | MV3 跨域代理与凭证捕获 |

## 数据流

```
浏览器/插件 (venue-browser) → API_SaveMatch/SaveBet/SaveLiveTimer → backend → RDS platform_*
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
- [../LOCAL_DEV.md](../LOCAL_DEV.md) — 本机开发、依赖和环境配置；执行规则另见本机 `AGENTS.md`
- [DATA_STORAGE.md](./DATA_STORAGE.md) — RDS / JSON 边界与 **API 数据策略**（memory-first）
- [../PRODUCTION_DEPLOYMENT.md](../PRODUCTION_DEPLOYMENT.md) — 生产部署
