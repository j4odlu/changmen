# RAY Node 状态对照

本文按当前 `../core.js` 与 `../ws.js` 修正原乱码说明。Node 工具用于按需探针；生产浏览器实现位于 `client/packages/venue-browser/adapter/ray/`，旧 RayFeed 与 Dashboard 已退役。

| 输入 | 当前解释 |
| --- | --- |
| 比赛 `start_time <= now`，且未到 `end_time` | 进行中 |
| 比赛 `status === 2` | 强制视为进行中 |
| 已到 `end_time` 且未被上条覆盖 | 已结束 |
| 地图 `final` / `rN` | 全场 / 地图 N |
| 赔率 `status === 1` | 可投注，`locked: false` |
| 赔率 `status === 4` | 已关闭，`locked: true` |
| 其它赔率状态 | 锁盘 |

选盘规则由 [market catalog](../../../../packages/shared/catalog/market_catalog.json) 定义；自定义 betName 过滤保留。

Node WebSocket 默认连接源站 `cfsocket.365raylinks.com` 的 `/socketcluster/`，订阅 `match`；可通过 `RAY_WS_HOST`、`RAY_WS_PATH`、`RAY_WS_CHANNEL` 覆盖。`source: "odds"` 更新已登记的 odds，`source: "match"` 更新比赛。Node 工具不连接 A8 聚合服务器。

CLI 与生产采集边界见 [探针包说明](../../README.md)；浏览器协议说明见 [RAY 平台文档](../../../../client/web/docs/platforms/RAY.md)。
