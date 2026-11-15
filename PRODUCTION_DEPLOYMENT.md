# 生产部署与运维说明

changmen 是 **客户端 + 服务端** 系统。`localhost` 与 `.bat` 仅用于开发联调；生产环境客户端连**远程 API**，服务端与 RDS 跑在服务器/云上。

> [changmen 扩展] 2026-10-15 用户明确要求：所有生产部署统一通过 GitHub Actions **Validate and release**（`.github/workflows/release.yml`）执行。本机只进行开发、验证、commit/push 和只读状态核验，不执行生产部署。推送 `master` 后由 Actions 验收并发布；前后端独立变更分别发布；共享依赖或接口联动变更才先发布后端，再发布前端。RDS 维护不随应用发布执行。

> [changmen 扩展] 独立的数据库检查命令只核验结构，不执行历史编号 SQL，不补写迁移账本，不运行 `profiles.accounts → players`、storage JSON 导入、owner 回填/孤儿软删除。从仓库根显式运行 `npm run check:rds-schema --workspace=@changmen/backend` 时，使用只读事务核对字段类型、空值限制、默认值、约束、索引、序列、函数和触发器；缺失或不兼容时检查命令失败，列出差异，不自动修复。后端发布在任何进程激活前调用同一只读核验，失败保留旧进程、链接与发布标记。正确的存量库无论有没有迁移账本都可核验。
>
> 历史迁移工具只供单独的数据维护使用，运行前需检查具体数据范围、备份和 dry-run。下文新机初始化/历史迁移步骤不应当作存量生产的日常发布动作。代码版本回退不撤销已提交的数据库修改。

最后更新：2026-11-13

[changmen 扩展] 2026-11-02 运行时基线：Node.js **26.13.0 LTS**。新机使用 Node 26 安装源；存量 VPS 运行时切换通过 Actions **Upgrade Node runtime** 执行，并要求同一提交的 **Validate and release** 已成功。具体校验与回滚见 [独立发布配置](./docs/INDEPENDENT_DEPLOYMENT.md#配置与版本目录)。下文历史发布记录中的旧版本号保留当时事实。

---

## 1. 架构（冻结）

```text
┌─────────────────────────────────────────────────────────┐
│ 客户端（每台操作员机器）                                   │
│  Vue / + Chrome 插件                                 │
│  多数场馆：venue-adapter 采集 → API_SaveMatch / API_SaveBet │
│  Polymarket/PredictFun：仅 WS → fo（HTTP discovery 在 VPS） │
│  oddsStore（内存 fo）· 下注 Provider · CollectConfig 门控  │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS（/esport/*）
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 服务端（一台或多实例）                                     │
│  server/backend    — esport-api、HTTP 代理、静态 /          │
│  server/match/matcher    — 内嵌 30s 循环，经 composer 写 client_matches │
│  polymarket-esports — Gamma+/prices → platform_* + index   │
│  polymarket-sports — Sports WS → client_matches.pm_sport   │
│  predictfun-collector — 电竞 REST discovery（默认随主栈启动） │
│  （SXBet collector / market-hub 已暂停，不随默认主栈启动）   │
│  RDS (PostgreSQL)  — platform_* / client_matches / orders / users  │
└─────────────────────────────────────────────────────────┘
```

**已删除、不再部署**：Node FeedHub、`ESPORT_BRIDGE`、本机 WS 网关（OB MQTT / RAY SC / TF / IA relay）。各平台 WebSocket 由**浏览器直连**源站、A8 聚合机或 changmen `ws_forward` hub。

**电竞列表基线**：多数场馆仍为浏览器 `saveMatch` / `saveBet`；**Polymarket / PredictFun** 为 VPS collector 直写 `platform_*` + matcher → `Client_GetMatchs`。PredictFun 实时赔率仍靠浏览器 Market WS → `fo`；下注与足球 PF REST 停用互不影响。**SXBet** 场馆已暂停（manifest `implementation: paused`）。

---

## 2. 推荐拓扑：同源部署

前端 API 使用相对路径（`/esport/...`），**推荐** API 与 `/` 同一 origin。各平台 WebSocket 由浏览器直连源站或 A8 聚合机，不经本机 WS 网关。

| 路径 | 服务 |
|------|------|
| `https://your-domain.com/` | 静态前端（`app:build` 产物）· **电竞控制台** |
| `https://your-domain.com/esport/*` | server/backend（`changmen-esport`） |
| `https://your-domain.com/v4.0/*` | 已停用（返回 `V4Disabled`，不再转发 A8） |

Nginx / Caddy 反代示例要点：
- 静态 `/` 指向 `client/web/dist/`（推荐由 Caddy `file_server` 托管），或由 `server/backend` 读 `dist` 托管

**分离域名**（可选，非默认）：如 `app.example.com` + `api.example.com` 时设置 `VITE_API_BASE` 并配 CORS，见 `client/web/.env.example`。单机单 IP、浏览器只访问 `http://IP/` 时**不需要**。

---

## 2.1 两团队独立发版（单 IP + Caddy）

目标：**前端团队与后端团队各改各的，发版时不必一起重启进程**。这与「双域名 / 跨域」无关；浏览器仍只访问同一 origin（如 `http://你的IP/`）。

### 生产上有几个「进程」

| 组件 | 生产形态 | 发版 / 重启 |
|------|----------|-------------|
| 前端（`client/web`） | **静态文件** `client/web/dist/`（不是常驻 Node 进程） | `npm run app:build` 后覆盖 `dist`；**一般不必** `pm2 restart` |
| API + 合并（`server/backend` 内嵌 matcher） | PM2：`changmen-esport`（`:3456`）**单实例** | `pm2 restart changmen-esport --update-env` |
| Polymarket Market WS hub | PM2：`changmen-pm-market-hub`（`:3457`，电竞） | `pm2 restart changmen-pm-market-hub --update-env` |
| Polymarket Sport Market WS hub | PM2：`changmen-pm-sport-market-hub`（`:3459`，体育） | `pm2 restart changmen-pm-sport-market-hub --update-env` |
| Predict.fun Market WS hub | PM2：`changmen-predictfun-market-hub`（`:3458`） | `pm2 restart changmen-predictfun-market-hub --update-env` |
| Polymarket 电竞 HTTP 采集 | PM2：`changmen-polymarket-collector`（Gamma+/prices → `platform_*` + index） | `pm2 restart changmen-polymarket-collector --update-env` |
| Polymarket 赛程状态 | PM2：`changmen-pm-sports`（Sports WS，写 `pm_sport`） | `pm2 restart changmen-pm-sports --update-env` |
| Polymarket 足球列表 | PM2：`changmen-pm-football-collector`（Gamma/CLOB → `sport/soccer6` 快照） | `pm2 restart changmen-pm-football-collector --update-env` |
| Predict.fun 电竞 HTTP 采集 | PM2：`changmen-predictfun-collector`（REST → `platform_*` + market index）；默认随 deploy 启动 | 需 `PREDICT_FUN_API_KEY`；不参与足球列表 |
| SX.bet（已暂停） | ecosystem 仍有 `changmen-sxbet-collector` / `changmen-sxbet-market-hub`；**不**随 deploy 启动 | 恢复时再 `pm2 start … --only …` |

**冻结：`changmen-esport` 不可水平扩（多实例）**。账号/profile/`client_matches` 与采集热路径为进程内 memory-first；`platforms.json` 为本机文件（见 [docs/DATA_STORAGE.md](./docs/DATA_STORAGE.md)）。双开会分裂内存状态与凭证，导致列表/账号不一致。扩容前须先外置共享状态（或拆出无状态面）；当前拓扑保持 **一台 VPS 上该进程实例数 = 1**（`ecosystem.config.cjs` 勿设 `instances > 1` / cluster）。Collector / Market hub 可按机器资源另开，与 esport 单实例约束无关。

开发联调才是两个进程：Vite（Win `5274` / 其它 `5174`）+ backend（Win `3560` / 其它 `3456`）（`BAT\dev.bat` 等），那是本地用，不是生产模型。

### 推荐拓扑（`deploy/Caddyfile`）

```text
浏览器 → http://IP:80 (Caddy)
           ├─ /、/assets/     → client/web/dist（前端团队 build）
           └─ /esport/* 等    → 127.0.0.1:3456 (PM2 changmen-esport)
```

- **前端发版**：`./sh/deploy-frontend.sh` 或 GHA 仅 `client/web` 变更 → 更新 `dist/`（**不必** `pm2 restart`）
- **后端发版**：`./sh/deploy-backend.sh` 或 GHA 仅 `server/**` → `pm2 restart`（**不必**重新 `app:build`）

部署前把 Caddyfile 里 `root` 改成 VPS 上真实的 `.../changmen/client/web/dist` 路径。

### 简化拓扑（全反代到 3456）

若 Caddy 仅 `reverse_proxy 127.0.0.1:3456`，由 `server.js` 托管 `dist`，**独立发版仍然成立**：

- 前端只更新 `dist` → 通常可不 restart PM2（静态按请求读盘）
- 后端只 `pm2 restart changmen-esport` → 不必动 `dist`

Caddy 分流只是把「谁托管静态」从 Node 挪到 Caddy，职责更清晰；不是换一套产品架构。

### 团队分工（单仓）

| 团队 | 改什么 | 生产动作 |
|------|--------|----------|
| 客户端 | `client/web`、`client/packages`、`chrome-extension` | Actions 验收并切换前端制品；扩展单独打包分发 |
| 服务端 | `server/backend`、`server/match`、`server/venues` 等 | Actions 验收候选后激活受影响进程；RDS 维护独立执行 |

集成只走 HTTP `/esport/*`（`@changmen/api-contract`），禁止跨团队 `import` 源码。见 [docs/TEAM_BOUNDARIES.md](./docs/TEAM_BOUNDARIES.md)。

---

## 3. 服务端部署步骤

生产发布统一通过 GitHub Actions **Validate and release**；本机不执行迁服或原地覆盖部署。新机器接管需单独核对运行环境、共享配置、数据库兼容性及回滚基线，不能复用旧脚本自动重放迁移或账号回填。

### 3.1 依赖与环境

本机开发依赖从仓库根运行 `npm install`。生产候选由 Actions 安装、构建和封包，VPS 按已验收制品定向安装运行依赖；不手工安装整套前端 workspace。

| 变量 | 生产 | 说明 |
|------|------|------|
| `DATABASE_URL` 或 `DATABASE_URL_PUBLIC` / `_INTERNAL` | **必填** | RDS 连接（`DATABASE_RDS_TARGET=auto` 内网优先） |
| `AUTH_MODE` | `cookie` | Cookie 单轨；旧 JWT 鉴权及 Client_Login/RefreshToken/Logout 入口明确拒绝。`dual`/`legacy` 仅用于显式回滚；切换前先部署 Cookie 网页和插件 1.3.74+ |
| `WEB_AUTH_COOKIE_ENABLED` | `1` | 启用原生 `/auth/login`；与前端 `VITE_WEB_COOKIE_AUTH=1` 配套 |
| `WEB_AUTH_CSRF_SECRET` | **必填** | 独立随机密钥，至少 32 字符；不复用或同时轮换 JWT_SECRET |
| `WEB_AUTH_ORIGINS` | `https://changmen.fun,https://www.changmen.fun,https://api.changmen.fun` | 精确 Origin 白名单；matcher 位于 API 子域，其写请求也需要允许该 Origin；API 子域 Caddy 必须反代 `/auth/*` |
| `JWT_SECRET` | **必填** | HS256 密钥（至少 32 个随机字节；已有密钥勿在升级时同步轮换） |
| `JWT_ACCESS_TTL` | `15m` | 服务端 JWT/显式兼容模式配置；当前网页不保存或发送 access token |
| `JWT_BROWSER_ACCESS_TTL` | `15m` | 浏览器会话桥接凭据的服务端有效期；浏览器仍只使用 HttpOnly Cookie |
| `JWT_REFRESH_TTL` | `30d` | 旧客户端可轮换 refresh token 有效期；浏览器使用 HttpOnly 会话 |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `changmen-auth` / `changmen-api` | 服务端 JWT 签发及受众校验；不代表默认网页允许旧 JWT 登录 |
| `CHANGMEN_DB_SCRIPT` | `rds` | 数据层固定 RDS（兼容旧名 `GAMEBET_DB_SCRIPT`） |
| `PORT` | `3456` 或反代端口 | HTTP 监听 |
| `A8_AUTH` | **`1`（默认）** | 开启用户鉴权；网页使用 Cookie 会话，生产禁用开发免登 |
| `NODE_ENV` | `production` | 常规 Node 约定 |

**不要设置**（已停用）：`A8_V4_URL`（v4 信用盘不再转发 `api.a8.to`）。

HTTP 代理（按需，见 [server/backend/proxy/README.md](./server/backend/proxy/README.md)）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ENABLE_PB_NODE` | 关 | `1` 时 PB 走 `/esport/pb/proxy` |

**不要设置**（已移除）：`ESPORT_BRIDGE`、`ENABLE_FEED_HUB`、`ENABLE_OB`（Feed 采集）、`ENABLE_OB_MQTT_RELAY`、`ENABLE_RAY`、`ENABLE_TF`、`ENABLE_IA_RELAY`（WS relay 已退役）。

### 3.2 数据库

RDS 结构和数据维护独立于应用发布。后端激活前执行只读结构核验，失败保留旧进程、链接与成功记录；不重放 SQL 或回填账号。

从仓库根手动核验配置的数据库：

```bash
npm run check:rds-schema --workspace=@changmen/backend
```

`npm run db:apply --workspace=@changmen/backend` 默认也仅核验结构，不执行历史 SQL。命令读取实际配置并连接数据库，不是离线诊断；核验基线与维护实现位于 `rds/assets/`、`rds/maintenance/`。具体兼容规则见 [数据库升级与兼容](docs/DATABASE_UPGRADE_COMPATIBILITY.md)。

仅全新空库初始化使用 `npm run db:initialize --workspace=@changmen/backend`（`rds/maintenance/apply-rds-schema.mjs --initialize`）；已有业务表时拒绝执行。存量库缺字段或索引时，应单独准备、审核并执行所需变更，不把全部历史 SQL 当作补齐方法。

POD 足球自动跟单上线前必须确认 `042_pod_bet_executions.sql` 已执行；前端自动下注依赖该表做跨标签页、跨设备幂等。完整发布顺序见 [docs/POD_AUTO_FOLLOW.md](./docs/POD_AUTO_FOLLOW.md)。

过期 `client_matches` 由 `server/match/matcher` 每小时 archive（`rds/archive_stale.js`，1 小时 `built_at` 阈值）。平台数据由 SaveMatch 快照生命周期负责，不再定时扫表。手动兜底：从根目录运行 `npm run db:archive-stale --workspace=@changmen/backend`（backend `scripts/ops/migrations/archive-stale-client-matches.mjs`）。

### 3.3 前端构建与托管

本机验证构建：

```bash
npm run app:build
```

生产静态资源由 Actions 发布已验收归档，不手工上传本机 dist。

产物在 `client/web/dist/`。推荐由 Caddy 托管静态（见 §2.1）；若未分流，后端启动时也会托管 `/`（见 `server/backend/server.js`）。

### 3.4 进程

**生产默认（电竞主栈 + 足球 PM discovery）**：`changmen-esport`（内嵌 matcher）+ `changmen-pm-market-hub` + `changmen-pm-sport-market-hub` + `changmen-predictfun-market-hub` + `changmen-pm-sports` + `changmen-polymarket-collector` + `changmen-predictfun-collector` + `changmen-pm-football-collector`。（`changmen-sxbet-*` 已暂停，不进默认 `--only`。）

进程入口、cwd 和环境参数由 `deploy/ecosystem.config.cjs` 管理，Actions 在已验收的后端版本目录中激活它们。不要在原工作目录直接执行 `pm2 start` 或 `git pull` 代替受管发布。

`ecosystem.config.cjs` 注册上述进程；matchMerge 随 `changmen-esport` 内嵌启动（`MATCHER_INTERVAL_MS`，默认 30s）。唯一合场写路径：`matchMergeOnce` → `@changmen/matcher`。**勿**另起独立 match-composer WRITE 进程（防双写 `client_matches`）；回滚走 git revert / 版本回退。

`changmen-polymarket-collector` 直连 Gamma + CLOB `/prices`，写 `platform_*` + MarketIndex。浏览器电竞侧**不再** Gamma/`Save*`，只同步 Index → Market WS → `fo`。设 `POLYMARKET_COLLECTOR_WRITE_PLATFORM=0` 可改 shadow（仅 index）。详见 [server/collectors/polymarket-esports/README.md](./server/collectors/polymarket-esports/README.md)。

`changmen-pm-sports` 连 `wss://sports-api.polymarket.com/ws`，按 `platform_matches` 已有 Polymarket 行关联 `client_matches`，写入 `pm_sport`。[changmen 扩展] 首次收到有效 WS 状态前由 Gamma 每 60 秒补充；WS 接管后不再允许 Gamma 覆盖，断线和重启均保留 WS 优先级（来源存入快照）。**不替代**浏览器 CLOB WS 赔率采集。

`changmen-pm-football-collector` 每 30s 拉取 PM 足球 Gamma/CLOB，原子发布 `storage/sport/soccer6/match_list.json`，作为不能直连 PM 用户的 fallback。PM 官方可达时浏览器直接拉 Gamma/CLOB 并连接官方 Market WS；不可达或直连失败时才读取 VPS 快照并连接独立 `PM-SPORT-MARKET` hub。`changmen-esport` 通过 `PM_FOOTBALL_COLLECTOR_OWNED=1` 只读快照，不在用户请求内直连 Gamma；电竞 `PM-MARKET` / collector 不受影响。

`changmen-predictfun-collector` 直连 `api.predict.fun`（`PREDICT_FUN_API_KEY`），写电竞 `platform_matches` / `platform_bets` 与 `predictfun_market_index.json`，默认随电竞主栈启动。浏览器 Predict.fun 采集器**仅**经 `ws-forward` hub 订阅 orderbook → `fo`。足球 `Client_GetFootballMatchs` 不调用 PF REST。

**SXBet 已暂停**：`changmen-sxbet-collector` / `changmen-sxbet-market-hub` 仍在 ecosystem 中，但 deploy 会 `pm2 delete`，默认不启动。恢复时须同时核对 manifest 采集开关、部署脚本暂停列表与进程配置，独立评审后通过 Actions 验收恢复，不能只手动拉起进程。

当前生产使用受管 PM2 进程及 systemd 运行时服务；运行时切换按 Actions **Upgrade Node runtime** 流程执行。

### 3.5 Node 平台设施与可选瘦包

Node 探针在 **`@changmen/platform-probes`**（`server/platform-probes/`，瘦包同步为 `server/backend/platform_node`），与 `platform_adapter` 并列。**日常开发可不使用。**

**标准部署**：GitHub Actions **Validate and release** 统一验收并运输制品，按组件切换独立版本目录。后端在候选目录安装/编译后激活现有进程；原地 `git pull` 不再用于受管生产发布。详见 [独立部署](./docs/INDEPENDENT_DEPLOYMENT.md)。

**瘦包部署**（仅发布 `server/backend`、无 `packages/` 目录时）：

```bash
cd changmen
npm run sync:platform-adapter --workspace=@changmen/backend
# 或在 backend 目录：
# npm run sync:platform-adapter
```

将 `registry/`、`loader/` 等基础设施同步到 `server/backend/platform_adapter/`（跳过浏览器采集 ts）。`reqS` 经 `loader/adapter_paths.mjs` 解析 `@changmen/shared`。可选在进程环境设置 `GAMEBET_ADAPTER_ROOT` 指向该目录（否则解析顺序见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)）。

冒烟：`npm run test:adapter --workspace=@changmen/backend`（模拟瘦包布局）。

### 3.6 健康检查

| 检查 | 期望 |
|------|------|
| `GET /api/games` | 200 + JSON |
| `GET /api/proxy/status` | `{ enabled: false, wsRelay: false }`（WS 不经本机） |
| `POST /esport/Client_GetMatchs`（Cookie 会话，按接口要求携带 CSRF） | HTTP 200，且业务结果成功 |

---

## 4. 客户端部署步骤

### 4.1 访问方式

- **浏览器**：打开 `https://your-domain.com/`，经 `/auth/login` 登录，使用 HttpOnly Cookie 会话
- **Chrome 插件**：操作员在 Chrome/Edge 安装 `chrome-extension`（见 4.2）。PB / Stake 采集与 v4 代发**依赖插件**。

### 4.2 Chrome 插件

```bash
cd changmen/chrome-extension
npm run build
```

操作员安装已解压扩展或企业策略分发。PB / Stake 采集与 v4 代发**依赖插件**。

可选：`VITE_GAMEBET_EXTENSION_ID` 与 manifest 一致。

### 4.3 开发专用变量（生产构建通常不设）

| 变量 | 用途 |
|------|------|
| `VITE_API_PROXY` | **仅 dev**：Vite 把 `/esport` 代理到本机或 VPS（remote：`https://changmen.fun`） |
| `VITE_API_PROXY_TLS_*` | **仅 dev remote**：代理 HTTPS 时的客户端证书（mTLS，CN=登录名） |
| `VITE_V4_PROXY=1` | dev 时 v4 走本地 `/v4.0/` |
| `VITE_V4_DIRECT=1` | 仅在已放行 CORS 的域名使用 |

生产同源部署：**无需** `VITE_API_PROXY`；浏览器直接请求同 host 的 `/esport/*`。

### 4.4 平台账号

- 用户中心配置各平台 gateway/token（或插件凭证）
- `platform_sync` 在服务端启动时写 `platforms.json`（登录态种子）
- CollectConfig：显式开启才 `SaveMatch`/`SaveBet`（对齐 A8）

---

## 5. 安全（生产必读）

鉴权配置见上文 §3.1；API 与数据访问边界见 [团队边界](docs/TEAM_BOUNDARIES.md)。

| 优先级 | 项 |
|--------|-----|
| P0 | `x-proxy-url` relay：域名白名单 + 路径前缀 + 鉴权 + 审计 |
| P0 | 生产 `A8_AUTH=1`，禁用本地 `users.json` 免登 |
| P0 | `JWT_SECRET` 仅服务端；浏览器长期会话只存在 `HttpOnly; Secure; SameSite=Strict` Cookie 中 |
| P1 | 日志脱敏 token / cookie |
| P1 | HTTPS 全站（含 WSS） |

---

## 前后端分开部署（分步，可随时停）

| 步骤 | 内容 | 状态 |
|------|------|------|
| **1** | DNS + Caddy 双挂 `api.changmen.fun`（页面站不变） | ✅ 已启用 |
| **2** | API CORS（允许 `changmen.fun` / `www` Origin） | ✅ backend `core/http/cors.js`；`CORS_ALLOWED_ORIGINS` 可覆盖 |
| **3** | `VITE_API_BASE` 试包验收 | ✅ 已验收（正式切流前） |
| **4** | 正式前端打 API 域 | ✅ `client/web/.env.production` + 生产 `dist` 已切；Caddy 仍双挂；回滚目录 `dist.prev.step4` |
| **5** | 拆发布流水线（FE 只换 `dist` / BE 只 `pm2`） | 统一验收、两个组件发布入口；[版本目录、验收与回滚](docs/INDEPENDENT_DEPLOYMENT.md) |
| 6 | 收掉页面站 API 反代（真正拆开） | 未做 |

### 步骤 5 操作（独立发版）

Actions → **Validate and release** → Run workflow → 选择 `frontend` / `backend` / `full`（仅 master）。推送 master 则对比各端已发布版本自动选择组件；失败留下的未发布变化会继续纳入计划。

[changmen 扩展] 2026-10-27：控制、后端和前端检查按同一候选与计划分组，在独立 runner 并行执行，再由 `validate` 核对全部结果和制品后封包。空计划跳过检查矩阵，分组失败或证据不一致阻断发布。前后端按范围检查；数据库兼容演练只随数据相关改动执行。后端 Linux 制品验收、版本校验、健康检查和自动回滚保留。当前规则见 [独立部署](./docs/INDEPENDENT_DEPLOYMENT.md)。

| 变更范围 | 发布动作 | 是否重启后端 |
|---|---|---|
| 仅前端 | 验收后切换静态制品 | 否 |
| 仅后端运行代码 | 安装、编译、连接检查、激活及健康验收 | 是 |
| 双方独立改动 | 两个组件独立发布 | 是 |
| 共享依赖/API 联动，或手动 full | 后端成功后再发布前端 | 是 |
| 仅 RDS 维护文件 | 不触发应用发布；另行评审维护 | 否 |

前端独立发布不要求后端在线。后端发布激活前执行只读结构核验，不执行历史迁移、账号回填或数据清理。两端分别保留必要的版本/健康检查和应用回滚；数据库不随应用回滚。FOK 保护与 A8 前端语义不变。

本机不直接执行生产部署。版本目录、检查及回滚边界见 [INDEPENDENT_DEPLOYMENT.md](docs/INDEPENDENT_DEPLOYMENT.md)。

## 6. 开发联调 vs 生产（对照）

| 项 | 开发（remote） | 开发（全栈） | 生产 |
|----|----------------|--------------|------|
| API 地址 | Vite → `VITE_API_PROXY`（VPS） | Vite → 本机 backend | 同源 `/esport` |
| 启动 | `./sh/dev-esport.sh remote` | `./sh/dev-esport.sh` / `npm run dev` | `npm run web`（内嵌 matchMerge） |
| 认证 | Cookie 会话 + mTLS 客户端证（代理带证） | 默认 Cookie 会话；开发免登仅用于隔离环境 | Cookie 会话 + mTLS |
| 采集 | 本机浏览器 + 插件 → VPS | 本机浏览器 + 插件 → 本机 | 各操作员客户端上报同一 RDS |
| Node Feed | **不存在** | **不存在** | **不存在** |

---

## 7. 历史阶段记录

早期 M1/M2 清单属于项目启动阶段，不代表当前待办或发布验收。当前组件范围、检查、激活和回滚统一见 [独立部署](docs/INDEPENDENT_DEPLOYMENT.md)；平台实机走查另见 [A8 走查清单](client/web/docs/A8_WALKTHROUGH_CHECKLIST.md)。

## 8. 相关文档

| 文档 | 内容 |
|------|------|
| [readme.md](./readme.md) | 项目共识、目录 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | monorepo 布局、迁移阶段、adapter 解析 |
| [docs/TEAM_BOUNDARIES.md](./docs/TEAM_BOUNDARIES.md) | 两团队目录归属、独立发版 |
| [LOCAL_DEV.md](./LOCAL_DEV.md) | 本机开发与环境配置；执行规则另见本机 `AGENTS.md` |
| [server/backend/README.md](./server/backend/README.md) | API、HTTP 代理环境变量 |
| [scripts/README.md](./scripts/README.md) | `.bat` 脚本说明 |
