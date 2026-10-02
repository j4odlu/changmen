# 生产部署 Checklist（M1 — 架构冻结）

changmen 是 **客户端 + 服务端** 系统。`localhost` 与 `.bat` 仅用于开发联调；生产环境客户端连**远程 API**，服务端与 RDS 跑在服务器/云上。

最后更新：2026-06-14

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
| 客户端 | `client/web`、`venue-adapter`、`chrome-extension` | `app:build` → 更新 `dist` |
| 服务端 | `server/backend`、`matcher`、`server/db` 等 | `pm2 restart` 对应进程 |

集成只走 HTTP `/esport/*`（`@changmen/api-contract`），禁止跨团队 `import` 源码。见 [docs/TEAM_BOUNDARIES.md](./docs/TEAM_BOUNDARIES.md)。

---

## 3. 服务端部署步骤

**一键迁移到新 VPS**（从 Windows 开发机）：复制 `BAT\migrate-server.local.bat.example` → `BAT\migrate-server.local.bat`，填 `MIGRATE_NEW_HOST`，执行 `BAT\migrate-server.bat`。脚本会自动：旧机 `.env` + `storage/` → 新机、`git clone`/`pull`、`npm install`、RDS schema、PM2、Caddy、本机 `app:build` 上传 `dist`，并更新 `deploy-server.local.bat`。

### 3.1 依赖与环境

```bash
cd changmen
npm install          # workspaces: server/backend、server/match/matcher、packages/*
npm install  # 首次：安装全部 workspaces（含 client/web）
```

| 变量 | 生产 | 说明 |
|------|------|------|
| `DATABASE_URL` 或 `DATABASE_URL_PUBLIC` / `_INTERNAL` | **必填** | RDS 连接（`DATABASE_RDS_TARGET=auto` 内网优先） |
| `AUTH_MODE` | `dual` | HttpOnly 浏览器会话 + 旧客户端 refresh token 双轨兼容；历史值 `jwt` 等同 `dual`，紧急回退设 `legacy` |
| `WEB_AUTH_COOKIE_ENABLED` | `1` | 启用原生 `/auth/login`；与前端 `VITE_WEB_COOKIE_AUTH=1` 配套 |
| `WEB_AUTH_CSRF_SECRET` | **必填** | 独立随机密钥，至少 32 字符；不复用或同时轮换 JWT_SECRET |
| `WEB_AUTH_ORIGINS` | `https://changmen.fun,https://www.changmen.fun,https://api.changmen.fun` | 精确 Origin 白名单；matcher 位于 API 子域，其写请求也需要允许该 Origin；API 子域 Caddy 必须反代 `/auth/*` |
| `JWT_SECRET` | **必填** | HS256 密钥（至少 32 个随机字节；已有密钥勿在升级时同步轮换） |
| `JWT_ACCESS_TTL` | `15m` | 短期 access token；前端会自动续期并重放一次过期请求 |
| `JWT_BROWSER_ACCESS_TTL` | `15m` | 浏览器 access token；独立于旧生产环境里可能保留的 `JWT_ACCESS_TTL=7d` |
| `JWT_REFRESH_TTL` | `30d` | 旧客户端可轮换 refresh token 有效期；浏览器使用 HttpOnly 会话 |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `changmen-auth` / `changmen-api` | 新 JWT 的签发方与受众校验；旧 JWT 在过渡期仍兼容 |
| `CHANGMEN_DB_SCRIPT` | `rds` | 数据层固定 RDS（兼容旧名 `GAMEBET_DB_SCRIPT`） |
| `PORT` | `3456` 或反代端口 | HTTP 监听 |
| `A8_AUTH` | **`1`（默认）** | JWT 登录；勿用 `users.json` |
| `NODE_ENV` | `production` | 常规 Node 约定 |

**不要设置**（已停用）：`A8_V4_URL`（v4 信用盘不再转发 `api.a8.to`）。

HTTP 代理（按需，见 [server/backend/proxy/README.md](./server/backend/proxy/README.md)）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ENABLE_PB_NODE` | 关 | `1` 时 PB 走 `/esport/pb/proxy` |

**不要设置**（已移除）：`ESPORT_BRIDGE`、`ENABLE_FEED_HUB`、`ENABLE_OB`（Feed 采集）、`ENABLE_OB_MQTT_RELAY`、`ENABLE_RAY`、`ENABLE_TF`、`ENABLE_IA_RELAY`（WS relay 已退役）。

### 3.2 数据库

```bash
cd changmen/server/backend
node scripts/apply-rds-schema.mjs
```

POD 足球自动跟单上线前必须确认 `042_pod_bet_executions.sql` 已执行；前端自动下注依赖该表做跨标签页、跨设备幂等。完整发布顺序见 [docs/POD_AUTO_FOLLOW.md](./docs/POD_AUTO_FOLLOW.md)。

过期 `client_matches` 由 `server/match/matcher` 每小时 archive（`server/db/archive_stale.js`，1 小时 `built_at` 阈值）。平台数据由 SaveMatch 快照生命周期负责，不再定时扫表。手动兜底：`npm run db:archive-stale`（`scripts/ops/migrations/archive-stale-client-matches.mjs`）。

### 3.3 构建并托管前端

```bash
cd changmen
npm run app:build
```

产物在 `client/web/dist/`。推荐由 Caddy 托管静态（见 §2.1）；若未分流，后端启动时也会托管 `/`（见 `server/backend/server.js`）。

### 3.4 进程

**生产默认（电竞主栈 + 足球 PM discovery）**：`changmen-esport`（内嵌 matcher）+ `changmen-pm-market-hub` + `changmen-pm-sport-market-hub` + `changmen-predictfun-market-hub` + `changmen-pm-sports` + `changmen-polymarket-collector` + `changmen-predictfun-collector` + `changmen-pm-football-collector`。（`changmen-sxbet-*` 已暂停，不进默认 `--only`。）

```bash
cd changmen
# 推荐主栈（含 PM/PF 电竞 discovery、PM 足球 discovery 与独立 WS hubs）
pm2 start deploy/ecosystem.config.cjs --only changmen-esport,changmen-pm-market-hub,changmen-pm-sport-market-hub,changmen-predictfun-market-hub,changmen-pm-sports,changmen-polymarket-collector,changmen-predictfun-collector,changmen-pm-football-collector
```

`ecosystem.config.cjs` 注册上述进程；matchMerge 随 `changmen-esport` 内嵌启动（`MATCHER_INTERVAL_MS`，默认 30s）。唯一合场写路径：`matchMergeOnce` → `@changmen/matcher`。**勿**另起独立 match-composer WRITE 进程（防双写 `client_matches`）；回滚走 git revert / 版本回退。

`changmen-polymarket-collector` 直连 Gamma + CLOB `/prices`，写 `platform_*` + MarketIndex。浏览器电竞侧**不再** Gamma/`Save*`，只同步 Index → Market WS → `fo`。设 `POLYMARKET_COLLECTOR_WRITE_PLATFORM=0` 可改 shadow（仅 index）。详见 [server/collectors/polymarket-esports/README.md](./server/collectors/polymarket-esports/README.md)。

`changmen-pm-sports` 连 `wss://sports-api.polymarket.com/ws`，按 `platform_matches` 已有 Polymarket 行关联 `client_matches`，写入 `pm_sport`。**不替代**浏览器 CLOB WS 赔率采集。

`changmen-pm-football-collector` 每 30s 拉取 PM 足球 Gamma/CLOB，原子发布 `storage/sport/soccer6/match_list.json`，作为不能直连 PM 用户的 fallback。PM 官方可达时浏览器直接拉 Gamma/CLOB 并连接官方 Market WS；不可达或直连失败时才读取 VPS 快照并连接独立 `PM-SPORT-MARKET` hub。`changmen-esport` 通过 `PM_FOOTBALL_COLLECTOR_OWNED=1` 只读快照，不在用户请求内直连 Gamma；电竞 `PM-MARKET` / collector 不受影响。

`changmen-predictfun-collector` 直连 `api.predict.fun`（`PREDICT_FUN_API_KEY`），写电竞 `platform_matches` / `platform_bets` 与 `predictfun_market_index.json`，默认随电竞主栈启动。浏览器 Predict.fun 采集器**仅**经 `ws-forward` hub 订阅 orderbook → `fo`。足球 `Client_GetFootballMatchs` 不调用 PF REST。

**SXBet 已暂停**：`changmen-sxbet-collector` / `changmen-sxbet-market-hub` 仍在 ecosystem 中，但 deploy 会 `pm2 delete`，默认不启动。恢复时改回 manifest `collect: true` 并手动 `pm2 start … --only changmen-sxbet-collector,changmen-sxbet-market-hub`。

生产建议用 systemd / pm2 / Docker Compose 托管，并配置重启策略。

### 3.4 venue-adapter（Node 库 / CLI）

Node 探针在 **`@changmen/platform-probes`**（`devtools/platform-probes/`，瘦包同步为 `server/backend/platform_node`），与 `platform_adapter` 并列。**日常开发可不使用。**

**标准部署**（整仓 `git pull` + `npm install`）：[`deploy/scripts/deploy-server-remote.sh`](./deploy/scripts/deploy-server-remote.sh) 负责增量步骤；香港扁平同步见 [`deploy/scripts/sync-git-to-flat-app.sh`](./deploy/scripts/sync-git-to-flat-app.sh)。脚本索引：[deploy/scripts/README.md](./deploy/scripts/README.md)；生产部署说明：[deploy/README.md](./deploy/README.md)。

**瘦包部署**（仅发布 `server/backend`、无 `packages/` 目录时）：

```bash
cd changmen
npm run sync:platform-adapter --workspace=@changmen/backend
# 或在 backend 目录：
# npm run sync:platform-adapter
```

将 `registry/`、`loader/` 等基础设施同步到 `server/backend/platform_adapter/`（跳过浏览器采集 ts）。`reqS` 经 `loader/adapter_paths.mjs` 解析 `@changmen/shared`。可选在进程环境设置 `GAMEBET_ADAPTER_ROOT` 指向该目录（否则解析顺序见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)）。

冒烟：`npm run test:adapter --workspace=@changmen/backend`（模拟瘦包布局）。

### 3.5 健康检查

| 检查 | 期望 |
|------|------|
| `GET /api/games` | 200 + JSON |
| `GET /api/proxy/status` | `{ enabled: false, wsRelay: false }`（WS 不经本机） |
| `POST /esport/Client_GetMatchs`（带 JWT） | 200 或业务码 |

---

## 4. 客户端部署步骤

### 4.1 访问方式

- **浏览器**：打开 `https://your-domain.com/`，登录 JWT 用户（`users` 表）
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

详见仓库根目录 [SECURITY_NOTES.md](../SECURITY_NOTES.md)。

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
| **5** | 拆发布流水线（FE 只换 `dist` / BE 只 `pm2`） | ✅ GHA 按路径分流；`./sh/deploy-frontend.sh` / `./sh/deploy-backend.sh` |
| 6 | 收掉页面站 API 反代（真正拆开） | 未做 |

### 步骤 5 操作（独立发版）

| 变更范围 | GHA / 本机 | 是否 `pm2 restart` |
|----------|------------|-------------------|
| 仅 `client/web/**` | 只 build + 上传 `dist` | **否** |
| 仅 `server/**` / `deploy/**` 等 | 只 apply 仓库 + 重启进程 | 是 |
| `venue-adapter` / `packages/*` / 两侧都有 | 全量（先 BE 再 FE） | 是 |

本机紧急：

```bash
./sh/deploy-frontend.sh   # 只换静态，不动 PM2
./sh/deploy-backend.sh    # 只后端，保留现网 dist
```

分类逻辑：`scripts/deploy/classify-deploy-scope.mjs`。手动强制全量：GHA `workflow_dispatch` → `full_deploy` 或 `scope=full`。


### 步骤 1 操作

1. DNS 添加 **A 记录**：`api.changmen.fun` → `47.57.10.202`（与 `changmen.fun` 相同）。  
2. 本机执行：

```bash
./sh/step1-enable-api-subdomain.sh
```

脚本会：`certbot --expand` 把 `api` 写入现有 LE 证书 → 安装 `certificate/Caddyfile.dual.example` → `caddy reload`。  
3. 验收：`curl --cert …/RIVER.crt --key …/RIVER.key https://api.changmen.fun/health` → `ok`。  
4. **可停**：用户继续只用 `https://changmen.fun`，无感。

回滚：恢复 VPS 上 `/etc/caddy/Caddyfile.bak.step1.*` 并 `caddy reload`。

---

## 6. 开发联调 vs 生产（对照）

| 项 | 开发（remote） | 开发（全栈） | 生产 |
|----|----------------|--------------|------|
| API 地址 | Vite → `VITE_API_PROXY`（VPS） | Vite → 本机 backend | 同源 `/esport` |
| 启动 | `./sh/dev-esport.sh remote` | `./sh/dev-esport.sh` / `npm run dev` | `npm run web`（内嵌 matchMerge） |
| 认证 | 生产账号 + mTLS 客户端证（代理带证） | 可 `A8_AUTH=0` + TJ01 | JWT + mTLS |
| 采集 | 本机浏览器 + 插件 → VPS | 本机浏览器 + 插件 → 本机 | 各操作员客户端上报同一 RDS |
| Node Feed | **不存在** | **不存在** | **不存在** |

---

## 7. M1 完成标准

- [x] 服务端已删除 FeedHub / `ESPORT_BRIDGE` 代码路径
- [x] 文档统一「客户端采集 + 服务端聚合」表述
- [x] 本文档定义生产拓扑与环境变量
- [ ] 选定生产域名并完成首次 RDS schema + 双进程部署
- [ ] 至少一台客户端连远程 API 登录成功

M1 签字后进入 **M2**（OB/RAY/IM 采集 E2E），见 [client/web/docs/A8_WALKTHROUGH_CHECKLIST.md](./client/web/docs/A8_WALKTHROUGH_CHECKLIST.md)。

---

## 8. 相关文档

| 文档 | 内容 |
|------|------|
| [readme.md](./readme.md) | 项目共识、目录 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | monorepo 布局、迁移阶段、adapter 解析 |
| [docs/TEAM_BOUNDARIES.md](./docs/TEAM_BOUNDARIES.md) | 两团队目录归属、独立发版 |
| [CLAUDE.md](./CLAUDE.md) | 开发命令、RDS 表 |
| [server/backend/README.md](./server/backend/README.md) | API、HTTP 代理环境变量 |
| [scripts/README.md](./scripts/README.md) | `.bat` 脚本说明 |
