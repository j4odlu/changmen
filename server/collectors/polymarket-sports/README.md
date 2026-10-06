# polymarket-sports (`@changmen/polymarket-sports`)

VPS 守护进程：Polymarket **Sports API WebSocket** → RDS `client_matches.pm_sport` 列。

**不替代**浏览器 CLOB 赔率采集（`packages/venue-adapter/polymarket/`）与 `saveMatch` / `saveBets` 上报。

## 运行

| 环境 | 命令 |
|------|------|
| 开发 | 仓库根 `npm run pm-sports` |
| 生产 PM2 | `changmen-pm-sports`（`deploy/ecosystem.config.cjs`，cwd 本目录） |

依赖：`DATABASE_URL`（`@changmen/db`）、`@changmen/storage/load_env`。

## 数据流

```
wss://sports-api.polymarket.com/ws
  → resolve_match（platform_matches 已有 Polymarket 行）
  → updateClientMatchPmSport
  → broadcast_notify → realtime-hub（浏览器 pm_sport 推送）
```

[changmen 扩展] 比分、阶段和比赛状态只接受 Sports WS，不再使用 Gamma 轮询补充或覆盖。没有 WS 推送的比赛不会由 Gamma 补比分；WS 断线期间保留最后收到的状态。

Gamma 仍用于赛事身份索引和赛前历史价格查询，不参与 `pm_sport` 状态写入。切换不会清空已有数据库快照，已有状态由后续 WS 消息更新。

## 模块

| 文件 | 职责 |
|------|------|
| `index.js` | WS 连接、重连、主循环 |
| `gamma_map.js` | Gamma event 索引 |
| `gamma_poll.js` | WS 状态写入、独立历史价轮询（不轮询比分） |
| `resolve_match.js` | `gameId` / slug → `client_match_id` |
| `parse_sport.js` | Sports WS 消息解析 |

探针：`scripts/probe-sports-ws.mjs`、`scripts/compare-ws-gamma.mjs`。

索引：[collectors/README.md](../README.md) · [lines/esport/line.json](../../../lines/esport/line.json)
