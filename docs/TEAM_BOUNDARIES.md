# 团队边界（单仓阶段 0）

changmen 仍为 **一个 monorepo**，通过目录归属、CODEOWNERS 与 `check-team-boundaries` 让**客户端团队**与**服务端团队**可各自维护，减少跨团队改坏对方代码。

**目录层级**（详见 [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md)）：**平台层**（`packages/`、`packages/venue-adapter/`、`server/backend/`…共用）→ **能力层**（`server/match/identity`、`ws_forward`、`value-bet`…可复用引擎）→ **产品线层**（`lines/{code}/` 仅 manifest + `line.json`，电竞代码仍在根目录）。整理目录时改 manifest/文档即可，不必为产品线复制平台包。

完整两仓 / 契约包路线见本文末尾「后续阶段」。

## 团队与目录

| 团队 | 拥有目录 | 职责 |
|------|----------|------|
| **客户端** | `client/web/`、`chrome-extension/`、`packages/venue-adapter/` | UI、采集、下注、插件、各平台适配源码 |
| **服务端（核心）** | `server/backend/`、`server/match/`（identity / resolver / matcher）、`server/db/`、`server/storage/` | API、合并、RDS、本机 JSON 路径、代理/余额、运维脚本 |
| **服务端（库，backend 挂载）** | `server/ws_forward/`、`server/realtime-hub/` | WebSocket 转发、Changmen Socket.IO 推送（由 backend 进程加载，非独立主链路进程） |
| **服务端（扩展守护进程）** | `server/collectors/`、`server/value-bet/` | VPS 采集 daemon；详见 [collectors/README.md](../server/collectors/README.md) |
| **开发工具** | `devtools/platform-probes/` | 可选：直连各平台探针 CLI（非主链路） |
| **产品线** | `lines/`、[docs/SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) | 对称锚点 `lines/{code}/`；电竞主栈在仓库根；棒球见 `lines/baseball/` |
| **共同协商** | `packages/shared/`、`packages/api-contract/`、`packages/client-core/`、`docs/TEAM_BOUNDARIES.md`、`.github/CODEOWNERS` | 跨端工具、catalog、HTTP 契约、web/adapter 共用 TS |

服务端包索引：[server/README.md](../server/README.md)。

已移除的遗留目录（勿再创建）：`server/platform-node`、`server/platform-probes`、`packages/venue-adapter/node/`、`packages/venue-adapter/{platform}/backend/`。探针源码仅在 `devtools/platform-probes/`；瘦包同步产物为 `server/backend/platform_node/` 与 `server/backend/platform_adapter/`。

`packages/venue-adapter` 内的 `loader/`、`registry/`、`scripts/` 属**适配器基础设施**（`reqS` / `backendRequire` 在 `loader/adapter_paths.mjs`）；各平台 `{platform}/shared/` 为**浏览器采集**内部模块（collect / markets / parse 共用），**不同步**到瘦包。

`packages/venue-adapter` 整体是**双端共享包**（浏览器 + Node）：server 经 `registry` / `loader` 等基础设施目录反向依赖它。原挂在 `client/` 下是历史遗留命名，已于 2026-09-20 迁入 `packages/`（与 `packages/shared` 补进 workspaces 同为一次 workspace hygiene 变更）。

`devtools/platform-probes/{platform}/shared/` 为**探针/CLI** 内部模块（如 RAY 的 CJS `save_bets.js`），与浏览器 `shared/` 分离，由探针包 `sync:backend-bundle` 打入 `server/backend/platform_node/`。

服务端通过 `requirePlatform(..., "node")` 加载探针；**不得**引用各平台根目录下的采集/下注 ts（`packages/venue-adapter/{platform}/shared/` 亦不在瘦包内）。

## 新增平台（摘录）

完整三类清单见 **[ADD_PLATFORM_CHECKLIST.md](./ADD_PLATFORM_CHECKLIST.md)**。归属速查：

| 类型 | 主要改谁 |
|------|----------|
| browser | 客户端 `venue-adapter`；可选服务端 `platform_sync` / proxy |
| plugin | 客户端 + `chrome-extension` |
| vps-house（`vps_http_ws`） | 服务端 `server/collectors` + ecosystem；客户端仅报价/下单 adapter |

`collectionMode` 写在客户端 manifest，前后端门控同源；**禁止**在 Save* 路径再硬编码馆名。

## 唯一集成面（HTTP）

客户端 **只** 通过 HTTP 使用服务端能力（禁止在 `client/web/src` 里 `import` 服务端或 DB 包）：

| 方向 | 端点（示例） | 说明 |
|------|----------------|------|
| 上报 | `POST /esport/API_SaveMatch` | 平台原始比赛 |
| 上报 | `POST /esport/API_SaveBet` | 平台原始赔率 |
| 上报 | `POST /esport/API_SaveLiveTimer` | OB 局数/计时 |
| 拉取 | `POST /esport/Client_GetMatchs` | 合并后比赛列表（真相源） |
| 拉取 | `POST /esport/Client_GetData` | KV / 配置 |
| 辅助 | `POST /esport/http-relay` | 插件/跨域代发 |
| 鉴权 | `POST /esport/*`（带 `token` 头） | JWT 会话 |

实现参考：`client/web/src/api/`、`@changmen/api-contract`。改响应形状须升契约包版本并通知对方团队。

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
| `@changmen/venue-adapter/*` | `@changmen/db`、`@changmen/match-identity`、`@changmen/platform-probes` |
| `@changmen/shared`（展示、时间窗、账号倍数等） | `server/backend`、`server/match` 任意路径 |
| `@changmen/api-contract` | |
| `@/` 应用内模块 | |

`client/web/scripts/`：允许 `@changmen/match-identity` 做离线 parity 测试；仍禁止 `@changmen/db` 与直接引用 backend。

### 各平台 `packages/venue-adapter/{platform}/`（根目录 ts，不含 `shared/`、`scripts/`）

| 允许 | 禁止 |
|------|------|
| `@changmen/venue-adapter/contract`、`@changmen/venue-adapter/shared`、同平台 `shared/` | `@changmen/db`、`client/web`、`server/backend` |
| `@changmen/shared` | `@changmen/platform-probes`、`@changmen/match-identity` |

### 服务端（`server/backend`、`server/match`、扩展守护进程）

| 允许 | 禁止 |
|------|------|
| `@changmen/db`、`@changmen/match-identity`、`@changmen/shared`、`@changmen/storage` | `packages/venue-adapter/*/`（平台根目录 ts 与 `shared/`） |
| `@changmen/venue-adapter/loader`、`registry`、`requirePlatform` → **node** | `client/web/src/**` |
| `@changmen/platform-probes`、`@changmen/polymarket-sports`、`@changmen/realtime-hub`、`@changmen/ws-forward`（backend 依赖） | |
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

已收口的登录元数据、在线信息和管理用户业务通过 `@changmen/db/profile_metadata.js`、`@changmen/db/admin_users.js` 及既有公开业务方法访问数据。验证输入、权限、API 错误文本和缓存刷新属于 backend；连接池、SQL 和既有事务实现属于 `server/db`。

`npm run check:boundaries` 用 TypeScript AST 检查 backend core 的连接池导入、数据库内部路径、SQL 执行、别名、动态导入及 re-export。历史例外精确登记在 `scripts/verification/backend-db-access-exceptions.json`，每处必须可追溯到固定已发布提交 `d3fd4a0a` 的原语法节点；允许减少，不允许新位置或新增次数。三个已迁移模块不能登记例外。

当前剩余例外仅涉及维护诊断、value-bet 查询、Predict.fun 体育 relay 身份查询和只读运行版本观察。`admin_maintenance.js` 受订单冻结保护，保留原实现；其余按后续批次迁移。边界规则是工程门禁，不替代运行时鉴权。

### 探针（`devtools/platform-probes`）

| 允许 | 禁止 |
|------|------|
| `@changmen/shared`、`@changmen/db` | `@changmen/venue-adapter`（含各平台 `shared/`） |
| 同平台 `shared/`、`core.js`、CLI 脚本 | `client/web`、`packages/venue-adapter/{platform}/` 根目录 ts |

## 本地校验

```bat
cd changmen
npm run check:boundaries
```

CI 在 `npm test` 前执行。违规时根据报错移除跨边界 `import`，或把共享逻辑下沉到 `packages/shared` 并经双方评审。

## CODEOWNERS

将 `docs/CODEOWNERS.example` 复制为仓库根 `.github/CODEOWNERS`，把占位符换成真实 GitHub 用户或 team slug：

```bat
copy changmen\docs\CODEOWNERS.example .github\CODEOWNERS
```

## 开发习惯

1. **客户端**改采集/下注 → 只动 `venue-adapter` + `client/web`；用 Save* API 验证，不直连 RDS。
2. **服务端**改合并/表结构 → `server/match/matcher` + `server/match/identity` + `db` + `backend/db/migrations`；用 `Client_GetMatchs` 契约测试或 web 冒烟验证。
3. **`packages/shared`** 变更：谁改谁提 PR，另一方扫一眼受影响 API 字段/展示。
4. 生产发版解耦：前端 `app:build` 更新 `dist`、后端 `pm2 restart` 互不影响；单机单 IP 用 Caddy 即可，**不必**双域名。见 [PRODUCTION_DEPLOYMENT.md §2.1](../PRODUCTION_DEPLOYMENT.md#21-两团队独立发版单-ip--caddy)。

## 后续阶段（未实施）

| 阶段 | 内容 |
|------|------|
| 1 | `@changmen/api-contract`（OpenAPI + TS 类型）、`VITE_API_BASE` | ✅ 完成（monorepo workspace） |
| 2 | `packages/client-shared` 从 `shared` 拆出并 semver |
| 3 | `changmen-client` / `changmen-server` 双仓库 |
