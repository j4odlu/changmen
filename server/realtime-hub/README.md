# @changmen/realtime-hub

**Socket.IO** 实时 hub：服务端 ↔ 浏览器。由 **`changmen-esport`（backend）进程内嵌挂载**，非独立 PM2。

## 能力

| 能力 | 事件 / 路径 | 用途 |
|------|-------------|------|
| **pub/sub** | `pubsub:subscribe` / `pubsub:publish` / `pubsub:message` | BetTarget、Publish、USER:*、TRADE:*（对齐 A8 GoEasy 频道语义） |
| **服务端推送** | `emitPubSubMessage` | pm_sport、pm_maintenance 等 → 浏览器 |
| **鉴权** | 握手 `auth.token` / `headers.token` | 与 esport JWT 一致 |

## 数据流

```text
浏览器 A ──pubsub:publish(BetTarget)──► backend realtime-hub ──► 浏览器 B
changmen-pm-sports ──HTTP notify──► backend ──emit(Polymarket:PmSport)──► 浏览器
hub 内置 watcher ──轮询 status.polymarket.com──► emit(Polymarket:Maintenance)──► 浏览器
```

## PM 官网维护检测（pm_maintenance.js）

- 每 60s（`PM_MAINTENANCE_POLL_MS`，最小 30s）轮询 `status.polymarket.com` 的 Statuspage 兼容 API（`/api/v2/summary.json` + `/api/v2/components.json`）。
- 状态机：`operational` / `maintenance`（页面或任一分量 UNDERMAINTENANCE）/ `incident`（HASISSUES 或分量降级、部分/重大故障）/ `unknown`（首次检测失败，或已有状态后连续 3 次网络失败；附检测错误）。
- 状态翻转需连续 2 次读数一致防抖；每轮结果都广播（`state` 为防抖后的公开状态）。
- [changmen 扩展] 保留最近检测快照，新订阅/重连立即回传；持续检测失败时仍广播错误，避免长期显示“尚未收到数据”。
- 关闭：`PM_MAINTENANCE_WATCH=0|off|false`。

## 导出

| 符号 | 用途 |
|------|------|
| `attachChangmenRealtimeHub` | backend HTTP server 挂载（内嵌启动维护 watcher） |
| `pushPmSportToBrowsers` | 推送单场 pm_sport |
| `PM_SPORT_CHANNEL` / `PM_MAINTENANCE_CHANNEL` | 频道名常量 |

客户端：`@changmen/venue-adapter/shared` → `subscribeChangmenChannel` / `publishChangmenChannel` / `ensureChangmenHubConnected`。

前端 BetTarget/操盘：`client/web/src/realtime/pubsubClient.ts`（自研 hub 适配层；频道名对齐 A8 bundle，不经 GoEasy SaaS）。

## 测试

```bat
npm test --prefix server/realtime-hub
```

相关：[server/collectors/README.md](../collectors/README.md) · [server/ws_forward/README.md](../ws_forward/README.md)
