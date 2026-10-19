# IA 平台（Node 探针）

浏览器主实现与文档见：

- `packages/venue-adapter/ia/`
- `client/web/docs/platforms/IA.md`

## 数据流

```text
HTTP  GET  {gateway}/api/game/game/gameListPageSplit/     (header: token，采集可为空)
HTTP  POST {gateway}/api/game/game/getPointsListSplit
WS    须自备 IA_WS_URL（官方或本站 relay）；默认不再连接 A8 聚合机
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `IA_GATEWAY` | 默认 `https://ilustre-analytics.org` |
| `IA_TOKEN` | HTTP header `token`（采集可为空字符串） |
| `IA_BET_NAME` | 选盘正则 |
| `IA_GAME_IDS` | 可选，默认 catalog 的 IA game_type_id |
| `IA_WS=0` | 关闭 Socket.IO 增量（仅 CLI 实验） |
| `IA_WS_URL` | WS 基址；**必填**才启用探针 WS（无 A8 默认值） |

## 启动（CLI）

```powershell
$env:IA_GATEWAY = "https://ilustre-analytics.org"
$env:IA_TOKEN = ""
cd changmen/server/platform-probes
npm run ia:events
```
