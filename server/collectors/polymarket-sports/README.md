# polymarket-sports (`@changmen/polymarket-sports`)

VPS 守护进程：Polymarket **Gamma 补充 + Sports API WebSocket 接管** → RDS 平台场次状态 `platform_matches.pm_sport`，以及已匹配比赛的 `client_matches.pm_sport` 列。

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

[changmen 扩展] 已有 Gamma 索引响应和 Sports WS 中的有效状态同时按 PM event ID 保存到对应 `platform_matches` 行的 `pm_sport` 字段，不依赖 `match_id`，因此未匹配场次也能保存。只更新已收录的 PM 场次，不创建比赛或改动关联；WS 优先于 Gamma，同来源的旧消息不能覆盖新消息。不增加 HTTP 请求、WS 连接或轮询。普通赛事快照刷新不会清除该字段。

字段通过独立 RDS 维护完成，采集器启动和代码部署不添加字段。仓库根执行 `node rds/maintenance/platform-pm-sport-schema.mjs` 只读核验；显式加 `--apply` 才添加可空 `jsonb` 字段。上线前单独完成维护，再发布采集器代码。

matcher 右栏按 PM event ID 读取对应平台场次的状态，复用中栏的展示。没有有效状态时显示“状态待更新”，不按时间猜测；滚动发布期间字段尚未初始化时也按未知处理。已匹配比赛原有的 `pm_sport` 写入与客户端广播保持原路径。

[changmen 扩展] 篮球消费官方直接状态，兼容 NBA/CBB 的 `Scheduled`、`InProgress`、`Final`、`F/OT`、`Suspended`、`Postponed`、`Delayed`、`Canceled`、`Forfeit`、`NotNecessary`；`Final` 与 `F/OT` 直接表示结束，其他异常状态不额外推断结束。官方状态说明见 [Sports Stream](https://docs.polymarket.com/market-data/realtime-data#sports-stream)。2026-10-26 对当前收录的 28 场非 NBA 篮球查询发现 Gamma 缺少 `live`、`ended`、`status` 和比分；同源 NBA 对照场次有直接终态。数据缺失时保持未知，`period=NS`、开赛时间、盘口关闭或结算均不作为比赛状态。短时 WS 未收到篮球消息也不能证明联赛永久不支持。

## 模块

| 文件 | 职责 |
|------|------|
| `index.ts` | WS 连接、重连、主循环 |
| `gamma_map.ts` | Gamma event 索引，游戏范围读取共享 catalog |
| `gamma_poll.ts` | WS 状态写入、Gamma 状态补充、独立历史价轮询 |
| `sport_state.ts` | 来源优先级恢复、按比赛串行写入和去重 |
| `event_states.ts` | 保存 PM 原生场次状态，包括未匹配场次 |
| `resolve_match.ts` | `gameId` / slug → `client_match_id` |
| `parse_sport.ts` | Sports WS 消息解析 |
| `prematch_prices.ts` | 赛前历史价查询与缓存 |
| `broadcast_notify.ts` | 写库后广播通知 |

[changmen 扩展] 9 个实现使用 strict TypeScript；Node 24 原生擦除类型，不生成另一套构建产物。既有实现的 `.js` 保留为兼容入口，PM2 仍启动 `index.js`。`types.ts` 描述外部消息与本地状态；数据库采集接口统一引用 `rds/collector_contracts.d.ts`，存储接口声明由 `server/storage` 维护，两套 PM 采集器共用。

验证：仓库根 `npm run typecheck --workspace=@changmen/polymarket-sports`；`npm test --workspace=@changmen/polymarket-sports` 包含原有行为回归、全部实现的类型擦除比对、独立 strict 使用方及隔离的原生启动/WS/写库/广播测试。经典 FOK 校验仍比较固定历史完整源码；仅在完整运行代码一致后还原迁移前源码，不替换历史基线。

探针：`scripts/probe-sports-ws.mjs`、`scripts/compare-ws-gamma.mjs`。

索引：[collectors/README.md](../README.md) · [lines/esport/line.json](../../../lines/esport/line.json)
