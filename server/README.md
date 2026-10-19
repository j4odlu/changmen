# server/ — 服务端 monorepo 包

changmen 服务端由多个 **npm workspace** 组成：主进程 `backend` 提供 HTTP API 与静态托管；`matcher` 写 `client_matches`；其余包为数据层、算法库或可选守护进程。

**团队边界**：[docs/TEAM_BOUNDARIES.md](../docs/TEAM_BOUNDARIES.md) · **总架构**：[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · **部署**：[PRODUCTION_DEPLOYMENT.md](../PRODUCTION_DEPLOYMENT.md)

## 进程与数据流（主链路）

```text
浏览器 venue-adapter
    │  API_SaveMatch / API_SaveBet / API_SaveLiveTimer
    ▼
server/backend  ──写入──►  RDS platform_* / live_timers
    │  Client_GetMatchs（只读 client_matches）
    │
    │  matchMerge 内嵌调度循环（随 web 启动）
    ▼
server/match/matcher ──compose/──► 唯一合场写路径
    │                      server/match/identity（teams / ids / time windows）
    │                      server/match/resolver（可选队名）
    └──读写──► @changmen/db ──► RDS client_matches

本机 JSON（凭证/初赔等）── @changmen/storage ──► server/backend/storage/
```

**扩展实时（可选，生产 PM2 常开 PM Sports）**：

```text
polymarket-sports ──WS──► 写 client_matches.pm_sport
       │
       └── HTTP 通知 ──► backend 内嵌 realtime-hub ──Socket.IO──► 浏览器
```

`ws_forward` 由 **backend 进程挂载**（`/esport/ws-forward/*`），非独立 PM2 应用。

## 包一览

| 目录 | npm 包名 | 类型 | 职责 |
|------|----------|------|------|
| [backend/](backend/README.md) | `@changmen/backend` | **主进程** | `Client_*` / `API_*`、HTTP 代理、`/esport/ws-forward`、静态 `/`、内嵌 matcher |
| [match/matcher/](match/matcher/README.md) | `@changmen/matcher` | 进程 / 库 | 30s matchMerge 循环 + `compose/` 合场算法；人工 UI `:4567` |
| [match/identity/](match/identity/README.md) | `@changmen/match-identity` | 库 | 队名、时间窗与 client_match ID 共享工具 |
| [db/](db/README.md) | `@changmen/db` | 库 | PostgreSQL / RDS 唯一应用入口 |
| [storage/](storage/README.md) | `@changmen/storage` | 库 | 本机 `storage/` 路径与 JSON 读写（非 PG） |
| [match/resolver/](match/resolver/README.md) | `@changmen/team-resolver` | 库 | 队名 canonical；matcher 动态加载 |
| [ws_forward/](ws_forward/README.md) | `@changmen/ws-forward` | 库 | IA/OB/RAY WebSocket 转发（backend 挂载） |
| [realtime-hub/](realtime-hub/README.md) | `@changmen/realtime-hub` | 库 | Changmen Socket.IO（`pm_sport` 等推浏览器） |
| [collectors/](collectors/README.md) | — | **守护进程归集** | `polymarket-sports`、`predictfun-collector`；新运动 collector 落此 |
| [collectors/polymarket-sports/](collectors/polymarket-sports/README.md) | `@changmen/polymarket-sports` | **守护进程** | PM Sports WS → `pm_sport` 列 **[changmen 扩展]** |
| [collectors/predictfun-collector/](collectors/predictfun-collector/README.md) | `@changmen/predictfun-collector` | **守护进程** | Predict.fun REST → `platform_*` |
| [value-bet/](value-bet/README.md) | `@changmen/value-bet` | **守护进程** | 以 PB 为基准的正 EV 扫描 **[changmen 扩展]** |

### `backend/core/` 子域（细节见 [backend/README.md](backend/README.md)）

| 子目录 | 职责 |
|--------|------|
| `esport-api/` | 路由、`store`、platform_sync、Save* / GetMatchs |
| `account/` | 场馆账号、订单、报表（[README](backend/core/account/README.md)） |
| `auth/` | JWT、action 权限 |
| `integrations/polymarket/` | PM 下单/结算/relayer（API 侧） |
| `integrations/a8/` | A8 v4 / esport 客户端 |
| `admin_tools/` | Telegram、订单通知、运维辅助 |
| `shared/` | adapter_paths、storage 再导出、catalog 测试 |

**SQL 迁移**在 `db/assets/migrations/`，维护实现与测试在 `db/maintenance/`；应用层通过 `@changmen/db` 使用数据层。backend 的 `npm run db:apply` 直接执行数据层正式入口，旧目录副本已退役。

## 常用命令（在 `changmen/`）

| 命令 | 作用 |
|------|------|
| `npm run web` | 启动 backend（Win `:3560` / 其它 `:3456`，内嵌 matchMerge） |
| `npm run matcher:ui` | 人工关联赛事 UI `http://localhost:4567` |
| `npm run pm-sports` | Polymarket Sports 守护进程 |
| `npm run value-bet` | 价值投注扫描循环 |
| `npm run value-bet:scan` | 价值投注单次扫描 |
| `npm run db:apply` | 应用 RDS 迁移（backend workspace） |
| `npm run check:boundaries` | 客户端 / 服务端 import 边界检查 |

Windows 一键：`BAT\dev.bat`（backend + Vite，内嵌 matchMerge）。生产 PM2：`ecosystem.config.cjs`（`changmen-esport`、`changmen-pm-sports`）。

## 脚本在哪

| 位置 | 用途 |
|------|------|
| [changmen/scripts/](../scripts/README.md) | 部署、Caddy、远程迁移、`check-team-boundaries` |
| [backend/scripts/](backend/scripts/) | 账号 CLI、RDS 迁移/诊断、`check:collect`、PM 运维 |

## 改什么去哪个包

| 需求 | 先改 |
|------|------|
| API 形状 / 鉴权 / 代理 | `server/backend` |
| 合并规则 / 新平台入 client_matches | `server/match/identity` + `server/match/matcher` |
| 表结构 / 查询 | `server/db`（SQL 位于 `assets/migrations/`） |
| 本地 platforms.json / 路径 | `@changmen/storage` |
| 浏览器采集 | **`packages/venue-adapter`**（不在 server 内实现采集） |
| PM 体育实时比分 | `polymarket-sports` + `realtime-hub` + 前端 `pmSportRealtime` |
