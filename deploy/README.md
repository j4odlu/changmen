# VPS 部署配置

生产 VPS 的 Caddy、PM2、部署/迁移脚本。应用代码与本目录同在仓库根。

## 目录

| 路径 | 说明 |
|------|------|
| [`Caddyfile`](Caddyfile) | Caddy :80 反代 + 静态 dist |
| [`ecosystem.config.cjs`](ecosystem.config.cjs) | PM2 默认：`changmen-esport`、`changmen-pm-market-hub`、`changmen-pm-sport-market-hub`、`changmen-predictfun-market-hub`、`changmen-pm-sports`、`changmen-polymarket-collector`、`changmen-predictfun-collector`、`changmen-pm-football-collector`（`changmen-sxbet-*` 已暂停，条目保留） |
| [`env/`](env/) | 后端 `.env` 模板（运行时：`server/backend/.env`） |
| [`scripts/apply-repo-archive.sh`](scripts/apply-repo-archive.sh) | tarball 解压 + 扁平化 + 部署 |
| [`scripts/sync-git-to-flat-app.sh`](scripts/sync-git-to-flat-app.sh) | 香港：git 子目录 → 扁平 `DEPLOY_REPO` 再 deploy |
| [`scripts/deploy-server-remote.sh`](scripts/deploy-server-remote.sh) | 增量 npm install / PM2 |
| [`scripts/flatten-hk-vps.sh`](scripts/flatten-hk-vps.sh) | 香港一次性扁平迁移 |
| [`scripts/migrate-server-remote.sh`](scripts/migrate-server-remote.sh) | 新机迁移 |
| [`scripts/`](scripts/) | VPS bash 索引（deploy / sync-remote / caddy） |
| [`scripts/setup-caddy-remote.sh`](scripts/setup-caddy-remote.sh) | 安装 Caddyfile |

脚本索引：[scripts/README.md](scripts/README.md)

## 生产部署

| 角色 | IP | 说明 |
|------|-----|------|
| **生产（HK）** | `47.57.10.202` | **push `master` → GHA**（[前端](../.github/workflows/deploy-frontend.yml) / [后端](../.github/workflows/deploy-backend.yml)）；本机用 `sh/deploy-frontend.sh` / `sh/deploy-backend.sh`，见 [独立部署](../docs/INDEPENDENT_DEPLOYMENT.md) |

| 区域 | 方式 |
|------|------|
| 生产 202 | **push `master` → GHA**（推荐）；`scripts\deploy\deploy202.bat` 紧急备用 |

VPS 运行目录：`/root/changmen`（扁平，无 git）。

**VPS 上 PM2（电竞默认）：**

```bash
cd /root/changmen
pm2 start deploy/ecosystem.config.cjs --only changmen-esport,changmen-pm-market-hub,changmen-pm-sport-market-hub,changmen-predictfun-market-hub,changmen-pm-sports,changmen-polymarket-collector,changmen-predictfun-collector,changmen-pm-football-collector
pm2 save
```

`deploy/scripts/deploy-server-remote.sh` 重启 `changmen-esport` 时会一并启动 Market hub、以及 PM / PF 电竞 HTTP collector；并 **delete** 已暂停的 `changmen-sxbet-collector` / `changmen-sxbet-market-hub`。`.env` 须配置 `PREDICT_FUN_API_KEY`（PF 电竞 collector、market-hub 上游握手）。

**Market WS hubs**：
- `changmen-pm-market-hub`（`:3457`）→ `/esport/ws-forward/PM-MARKET*`
- `changmen-predictfun-market-hub`（`:3458`）→ `/esport/ws-forward/PREDICTFUN-MARKET*`
- `changmen-pm-sport-market-hub`（`:3459`）→ `/esport/ws-forward/PM-SPORT-MARKET*`
- `changmen-sxbet-market-hub`（`:3460`）→ `/esport/ws-forward/SXBET-MARKET*`（**已暂停**，不随默认启动）

Caddy 须把上述路径指到对应端口；esport 的 `WS_FORWARD_PLATFORMS` **不要**再含 `PM-MARKET` / `PM-SPORT-MARKET` / `PREDICTFUN-MARKET`。本地 Vite：纯本机分别代理到 `3457` / `3458` / `3459`（`npm run pm-market-hub` / `npm run predictfun-market-hub` / `npm run pm-sport-market-hub`）。

**Watchdog**（cron 每分钟）：

```bash
bash deploy/scripts/install-esport-watchdog-remote.sh          # :3456 → restart changmen-esport
bash deploy/scripts/install-pm-market-hub-watchdog-remote.sh   # :3457/health → restart changmen-pm-market-hub
bash deploy/scripts/install-predictfun-market-hub-watchdog-remote.sh  # :3458/health → restart changmen-predictfun-market-hub
```

Predict.fun HTTP 电竞采集守护进程 `changmen-predictfun-collector` 默认随电竞主栈启动，负责 PF REST discovery → `platform_*` + `predictfun_market_index.json`。它与已停用的 PF 足球 REST 路径是两条不同链路。

PM 足球采用双通道：PM 官方可达时，浏览器直连 Gamma/CLOB 和官方 Market WS；不可达或直连失败时，比赛/初始盘口读取 `changmen-pm-football-collector` 每 30s 生成的快照，实时盘口连接独立的 `changmen-pm-sport-market-hub`。足球链路不复用电竞 collector 或电竞 WS 实例。

详见 [`PRODUCTION_DEPLOYMENT.md`](../PRODUCTION_DEPLOYMENT.md)。

## 场馆 HK 出海 relay（http-relay / ws-forward）

用户在前端 **扩展 → HK 出海 relay** 开启后，需出海场馆 HTTP/WS 经 changmen VPS 代连：

- **Polymarket HTTP**：`Pm_HttpRequest`（VPS 直连 Gamma/CLOB，不经 `http-relay`）
- **Predict.fun HTTP**：`http-relay`
- **PM / PF WebSocket**：`ws-forward`（`PM-MARKET` → `:3457`；`PREDICTFUN-MARKET` → `:3458`；`PM-SPORT-MARKET` → `:3459`；`PM-USER` 仍在 esport）

部署 HK 机时需：

```bash
# 1. 写入 http-relay 白名单并重启 backend
bash deploy/scripts/sync-hk-relay-env-remote.sh

# 2. 探针（VPS 上，backend 已运行）
cd server/backend && node scripts/ops/diagnostics/probe-hk-relay.mjs
# 或 npm run probe:hk-relay
```

`HTTP_RELAY_ALLOWED_HOSTS` 默认含 `gamma-api.polymarket.com,clob.polymarket.com,api.predict.fun,api-testnet.predict.fun`。探针失败时检查 VPS 能否 `curl -I https://clob.polymarket.com/time` 与 `curl -I https://api.predict.fun/v1/tags -H 'x-api-key: …'`。

**Predict.fun 主网**：VPS `server/backend/.env` 需 `PREDICT_FUN_API_KEY`（ws-forward）+ house 代下 `PREDICT_FUN_PRIVY_PRIVATE_KEY` / `PREDICT_FUN_PREDICT_ACCOUNT`；前端勿再打包主号私钥。独立 GHA 发布不再注入平台 Key/私钥或自动同步 relay env；服务器凭证用 `scripts/sync/` 的独立入口维护。

**Predict.fun 模式 A（运营主号）**：服务器 house 代下凭证留在 VPS `.env`；生产前端构建不接收 `VITE_*PRIVATE_KEY`。用户钱包/账号签名按运行时凭证路径执行，不以构建时共享主号私钥提供。独立发布说明见 [INDEPENDENT_DEPLOYMENT.md](../docs/INDEPENDENT_DEPLOYMENT.md)。

**PROXY 与 relay 分离：** `localStorage.PROXY` / 账号 `proxyId` 仅用于电竞**投注账号**经 http-relay 访问平台 gateway；**Predict.fun HK relay** 走当前页面同源；**Polymarket HTTP** 走 `Pm_HttpRequest`，不受 PROXY 影响。
