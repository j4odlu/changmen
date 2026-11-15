# 团队边界（单仓）

本文记录当前源码依赖与职责边界。目录和 workspace 清单见 [WORKSPACE_LAYOUT](WORKSPACE_LAYOUT.md)，验证与发布见 [INDEPENDENT_DEPLOYMENT](INDEPENDENT_DEPLOYMENT.md)，日常命令见 [LOCAL_DEV.md](../LOCAL_DEV.md)，执行规则另见本机 `AGENTS.md`。历史安装实验、源码数量和迁移阶段不作为当前操作要求。

身份领域包 `packages/match-identity` 只允许依赖自身及 shared；数据库、网络和宿主能力通过接口注入。matcher、resolver 与 RDS 可以使用它，客户端及双端 shared 禁止引用。

共享 catalog 只做纯计算；`AGGREGATE_GAME_CODES` 等环境读取通过服务端 `@changmen/storage/game_catalog`，不放回 shared。

## 团队与目录

| 团队 | 拥有目录 | 职责 |
|------|----------|------|
| **客户端** | `client/web/`、`client/packages/`、`client/devtools/`、`chrome-extension/` | UI、采集、下注、插件、浏览器包及前端工具 |
| **服务端（核心）** | `server/backend/`、`server/match/`（resolver / matcher）、`server/venues/`、`rds/`、`server/storage/` | API、合并、RDS、本机 JSON 路径、代理/余额、运维脚本 |
| **服务端（库，backend 挂载）** | `server/ws_forward/`、`server/realtime-hub/` | WebSocket 转发、Changmen Socket.IO 推送（market hubs 按进程配置独立运行，用户频道服务由 backend 挂载） |
| **服务端（扩展守护进程）** | `server/collectors/`、`server/value-bet/` | VPS 采集 daemon；详见 [collectors/README.md](../server/collectors/README.md) |
| **开发工具** | `server/platform-probes/` | 可选：直连各平台探针 CLI（非主链路） |
| **产品线** | `lines/`、[docs/SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) | 对称锚点 `lines/{code}/`；电竞主栈在仓库根；棒球见 `lines/baseball/` |
| **共同协商** | `packages/shared/`、`packages/api-contract/`、`packages/match-identity/`、`docs/TEAM_BOUNDARIES.md`、`.github/CODEOWNERS` | 跨端工具、catalog、HTTP 契约、web/adapter 共用 TS |

服务端包索引：[server/README.md](../server/README.md)。

浏览器运行实现归 `client/packages/venue-browser`，Node 平台基础设施归 `server/venues`，Node 探针归 `server/platform-probes`。各自通过公开包入口使用；旧 `@changmen/venue-adapter` 不再是运行时 workspace。

不得恢复 `server/db`、`server/backend/db`、旧 adapter 平台运行源码及旧 identity 实现。SQL 和数据维护归 `rds`；兼容清单与历史证据不赋予旧路径新增实现的资格。

Node 平台加载使用 `@changmen/venue-node` 的 `requirePlatform(..., "node")`，不能导入浏览器采集/下单实现。后端平台运行模块归 `server/venues/registry/runtime`，瘦包输出为 `server/backend/platform_adapter/`；可选探针工具单独交付。

## 新增平台（摘录）

完整三类清单见 **[ADD_PLATFORM_CHECKLIST.md](./ADD_PLATFORM_CHECKLIST.md)**。归属速查：

| 类型 | 主要改谁 |
|------|----------|
| browser | `client/packages/venue-browser`；可选服务端 `platform_sync` / proxy |
| plugin | 客户端 + `chrome-extension` |
| vps-house（`vps_http_ws`） | 服务端 `server/collectors` + ecosystem；客户端仅报价/下单 adapter |

`collectionMode` 唯一维护源为 `packages/shared/catalog/venue_manifest.json`，同步生成 Node 兼容资产，前后端门控同源；**禁止**在 Save* 路径再硬编码馆名。

## 客户端与服务端集成

客户端通过 HTTP API 与受鉴权的实时频道使用服务端能力（禁止在 `client/web/src` 里 `import` 服务端或 DB 包）：

| 方向 | 端点（示例） | 说明 |
|------|----------------|------|
| 上报 | `POST /esport/API_SaveMatch` | 平台原始比赛 |
| 上报 | `POST /esport/API_SaveBet` | 平台原始赔率 |
| 上报 | `POST /esport/API_SaveLiveTimer` | OB 局数/计时 |
| 拉取 | `POST /esport/Client_GetMatchs` | 合并后比赛列表（真相源） |
| 拉取 | `POST /esport/Client_GetData` | KV / 配置 |
| 辅助 | `POST /esport/http-relay` | 插件/跨域代发 |
| 鉴权 | `/auth/*` 与 `/esport/*` | Cookie 会话；写请求按接口要求校验 CSRF，旧 JWT 仅限显式兼容模式 |

实现参考：`client/web/src/api/`、`@changmen/api-contract`。改响应形状须同步契约与消费者，并核对新旧客户端兼容性。

各 action 的**内存 vs RDS 读写策略**（M→A / M→S / R 等）见 [DATA_STORAGE.md § API 数据策略](./DATA_STORAGE.md#api-数据策略memory-first-与-rds)。改 Save* / GetMatchs / 订单 / 鉴权相关 API 时须对照该表，避免把强一致路径改成 fire-and-forget。

### `@changmen/api-contract`（阶段 1）

| 导出 | 用途 |
|------|------|
| `EsportAction`、`ESPORT_ACTIONS` | 与 `router.ts` 同步的 action 名 |
| `ClientMatchDto` 等 | 共享 DTO |
| `buildEsportUrl` / `buildHttpRelayUrl` | 前端 `VITE_API_BASE`、脚本联调 URL |
| `openapi.yaml` | OpenAPI 索引 |

分离部署（**可选**）时前端设置 `VITE_API_BASE=https://api.example.com`（见 `client/web/.env.example`）。单机同源 `http://IP/` 时未设置即可，仍用相对路径 `/esport/...`。

## 允许 / 禁止的源码依赖

### 客户端（`client/web/src`、`chrome-extension/src`）

| 允许 | 禁止 |
|------|------|
| `@changmen/venue-browser/*` | `@changmen/db`、`@changmen/match-identity`、`@changmen/platform-probes` |
| `@changmen/shared`（展示、时间窗、账号倍数等） | `server/backend`、`server/match` 任意路径 |
| `@changmen/api-contract` | |
| `@/` 应用内模块 | |

`client/web/scripts/`：允许 `@changmen/match-identity` 做离线 parity 测试；仍禁止 `@changmen/db` 与直接引用 backend。

### 浏览器平台 `client/packages/venue-browser/`

| 允许 | 禁止 |
|------|------|
| `@changmen/venue-browser/adapter/contract`、`@changmen/venue-browser/adapter/shared`、同平台 `shared/` | `@changmen/db`、`client/web`、`server/backend` |
| `@changmen/shared` | `@changmen/platform-probes`、`@changmen/match-identity` |

### 服务端（`server/backend`、`server/match`、扩展守护进程）

| 允许 | 禁止 |
|------|------|
| `@changmen/db`、`@changmen/match-identity`、`@changmen/shared`、`@changmen/storage` | `client/packages/venue-browser` 等浏览器实现 |
| `@changmen/venue-node` 公共 loader/registry 入口 | `client/web/src/**` |
| `@changmen/polymarket-sports`、`@changmen/realtime-hub`、`@changmen/ws-forward`（backend 依赖） | |
| `server/value-bet` 仅依赖 `@changmen/db` + `@changmen/shared` + `@changmen/storage` | |

`server/collectors/`（`@changmen/polymarket-sports` 等）、`server/value-bet` 为独立 Node 进程，**只**通过 `@changmen/db` 与 HTTP 通知 backend 集成，不得 `import` `client/*`。

### matcher 与 backend 的内部边界

`server/match/**` 禁止导入 backend 源码或 `@changmen/backend`。backend 通过
`@changmen/matcher/runtime_ports.js` 注入采集快照、提交后发布、人工结束的内存失效和面板鉴权。
适配器归属 `server/backend/core/matcher/`，在 backend 采集 store 构造完成后安装。
独立人工 UI 由 `server/backend/scripts/matcher-ui.mjs` 装配后启动；直接运行 matcher UI
却未装配鉴权时拒绝访问，开发环境仍保留原有显式跳过开关。

列表读取共用 `@changmen/db/client_match_snapshot.js`，仅缓存已确认的活跃行及其不透明版本。
合场身份与关联需要已结束行，使用一次 `fetchClientMatchesAll({ snapshot: true })` 的完整生命周期视图。
两个视图范围不同，不能按 `built_at` 大小互相替换。版本只用于判断相等，进程内失效代次负责阻止旧请求覆盖新状态。

### backend 业务与数据库访问

已收口的登录元数据、在线信息和管理用户业务通过 `@changmen/db/profile_metadata.js`、`@changmen/db/admin_users.js` 及既有公开业务方法访问数据。验证输入、权限、API 错误文本和缓存刷新属于 backend；连接池、SQL 和既有事务实现属于 `rds`。

`npm run check:boundaries` 用 TypeScript AST 检查 backend core 的连接池导入、数据库内部路径、SQL 执行、别名、动态导入及 re-export。当前 `scripts/verification/backend-db-access-exceptions.json` 为空，不得重新登记已迁移模块。

正 EV 仪表盘通过 `@changmen/db/value_signals.js` 读取信号与聚合，诊断计算仍在业务层。Predict.fun 体育 relay 通过 `@changmen/db/relay_identity.js` 选择原有用户身份，通过公开 `@changmen/db/jwt.js` 使用原签发器；token 优先级、缓存和请求策略不变。

backend 不直接访问数据库；管理诊断使用 `@changmen/db/admin_maintenance.js`，报表分组、排序、金额转换和提示文字留在 backend。运行版本观察的数据实现归 `rds/runtime_schema.js`。边界检查不替代运行时鉴权。

数据库历史维护、诊断及事故脚本归 `rds/maintenance/legacy/`，不恢复旧 backend 入口。数据层不得反向导入 backend、平台采集或客户端实现；混合脚本须先拆出数据访问，再按职责归属。

### 探针（`server/platform-probes`）

| 允许 | 禁止 |
|------|------|
| `@changmen/shared`、`@changmen/db` | 浏览器平台实现及旧 `@changmen/venue-adapter` 入口 |
| `@changmen/venue-node/runtime/*`、同平台调试模块及 CLI | `client/web`、`client/packages/venue-browser` |

探针单向依赖平台运行包；backend、venue-node 的生产依赖不得包含探针。backend 的手动命令只通过开发依赖使用探针。

## 本地校验

```bat
cd changmen
npm run check:boundaries
```

CI 在 `npm test` 前执行。违规时根据报错移除跨边界 `import`，或把共享逻辑下沉到 `packages/shared` 并经双方评审。

### 当前门禁与历史证据

`check:boundaries` 检查源码依赖方向、PM 动态 loader 来源、安装声明、退役入口和资源契约。类型导入也计入依赖边界；动态目标与 unknown 必须保留证据，不能当作无依赖。浏览器公共簿属于 `@changmen/pm-market-data-browser`，运行代码不得从纯核心反向依赖宿主或 Node 能力。

日常检查按改动范围选择；固定 FOK 历史基线、完整迁移等价审计和验证器全套自测不因普通业务修改自动追加。当前冻结路径、SQL 不可变性及业务回归继续执行，具体规则见 [独立部署](INDEPENDENT_DEPLOYMENT.md)。

历史阶段与证据按需查阅：[源码隔离](SOURCE_FILE_ISOLATION_20261017.md)、[PM 入口边界](audits/PM_COMPONENT_ENTRY_BOUNDARY_AUDIT_20261017.md)、[PM 动态依赖](audits/PM_DYNAMIC_DEPENDENCY_AUDIT_20261017.md)、[loader 来源绑定](audits/PM_LOADER_BINDING_GATE_AUDIT_20261017.md)、[浏览器公共簿](audits/PM_BROWSER_MODULE_EXTRACTION_AUDIT_20261017.md)。这些记录不证明当前提交或生产状态。

## CODEOWNERS

将 `docs/CODEOWNERS.example` 复制为仓库根 `.github/CODEOWNERS`，把占位符换成真实 GitHub 用户或 team slug：

```bat
copy docs\CODEOWNERS.example .github\CODEOWNERS
```

当前只有模板，尚未启用。模板路径以本仓根目录为起点；共同维护项并列登记双方负责人，实际审查要求另由仓库规则配置，不应将模板存在视为审查已经强制生效。

## 开发习惯

1. **客户端**改采集/下注 → 修改 `client/packages/venue-browser` 与 `client/web` 对应模块；用 Save* API 验证，不直连 RDS。
2. **服务端**改合并 → `server/match/matcher` / `resolver`；表结构主资产只在 `rds/assets/migrations` 维护，backend 不保留副本。公共身份规则归 `packages/match-identity`，不恢复旧 identity 实现；用 `Client_GetMatchs` 契约测试或 web 冒烟验证。
3. **`packages/shared`** 变更：谁改谁提 PR，另一方扫一眼受影响 API 字段/展示。
4. 生产发版按现有组件流程选择 frontend / backend / full；共享依赖或 API 联动时后端先行验收。构建、封包、切换和回滚规则见 [INDEPENDENT_DEPLOYMENT.md](INDEPENDENT_DEPLOYMENT.md)，`app:build` 或手工重启不能代替发布验收。

## 阶段路线与完成情况

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | `@changmen/api-contract`（OpenAPI + TS 类型）、`VITE_API_BASE` | 已完成（monorepo workspace） |
| 2 | 原计划 `packages/client-shared` 从 `shared` 拆出并 semver | 部分具备：已有 `client-core`，独立版本管理及升级流程未完成；不另建同职能包 |
| 3 | `changmen-client` / `changmen-server` 双仓库 | 未实施，本轮不启动 |

### 第四轮兼容演练与包边界

数据库升级流程与隔离 PostgreSQL 演练见 [DATABASE_UPGRADE_COMPATIBILITY.md](DATABASE_UPGRADE_COMPATIBILITY.md)。共享包保留统一协议和纯逻辑，环境专属能力按入口隔离；当前消费者证据与后续拆分顺序见 [SHARED_PACKAGE_BOUNDARIES.md](SHARED_PACKAGE_BOUNDARIES.md)。本轮未修改生产结构或业务协议，也未改变发布分类。

## 平台目录与迁移记录

平台目录的唯一维护源为 `packages/shared/catalog/venue_manifest.json`；`npm run sync:venue-manifest` 生成旧 adapter、Node registry 和 Node runtime 中的兼容副本，`npm run check:venue-manifest` 只读核对一致性，不自动修复。

当前浏览器包、客户端基础包和 Node 基础包的位置以 [workspace 总览](WORKSPACE_LAYOUT.md) 为准；后端定向安装与发布范围以 [独立部署](INDEPENDENT_DEPLOYMENT.md) 为准。历史迁移细节见 [客户端基础包](CLIENT_PACKAGE_ISOLATION_20261019.md)、[Node 基础包](NODE_PACKAGE_ISOLATION_20261019.md)、[catalog 单源](VENUE_MANIFEST_ISOLATION_20261019.md) 和 [浏览器实现](VENUE_BROWSER_ISOLATION_20261019.md)。

## Node 动态路径边界

默认 Node 资源根为 `server/venues/registry/runtime`。动态 loader 的默认目标与调用来源由当前门禁检查；显式外部根、环境覆盖或资源布局变化须核对实际解析与交付内容。历史认证范围和证据见 [后端动态路径认证](BACKEND_DYNAMIC_PATH_CERTIFICATION.md)，不能用当时的安装数量或验收结果替代本次检查。
