# polymarket-sports (`@changmen/polymarket-sports`)

VPS 守护进程：Polymarket **Gamma 补充 + Sports API WebSocket 接管** → RDS `client_matches.pm_sport` 列。

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

[changmen 扩展] 首次收到有效 Sports WS 状态前，每 60 秒由 Gamma 补充比分、阶段和比赛状态；Gamma 字段缺失时不推断未开赛。收到 WS 状态后由 WS 永久接管该比赛，断线时保留最后的 WS 状态，Gamma 不再覆盖。

状态快照持久化 `source: gamma | ws`，重启后恢复来源优先级；数据库写入也原子拒绝 Gamma 覆盖 WS。来源缺失的旧有效快照保守视为 WS，继续保护，直到新的 WS 更新。Gamma 仍用于赛事身份索引和独立的赛前历史价格查询。

[changmen 扩展] 同场 WS 消息从赛事关联开始按接收顺序处理；浏览器广播按比赛串行读取数据库最新状态，避免超时后迟到的 Gamma 通知使页面状态倒退。

## 模块

| 文件 | 职责 |
|------|------|
| `index.js` | WS 连接、重连、主循环 |
| `gamma_map.js` | Gamma event 索引 |
| `gamma_poll.js` | WS 状态写入、Gamma 状态补充、独立历史价轮询 |
| `sport_state.js` | 来源优先级恢复、按比赛串行写入和去重 |
| `resolve_match.js` | `gameId` / slug → `client_match_id` |
| `parse_sport.js` | Sports WS 消息解析 |

探针：`scripts/probe-sports-ws.mjs`、`scripts/compare-ws-gamma.mjs`。

索引：[collectors/README.md](../README.md) · [lines/esport/line.json](../../../lines/esport/line.json)
