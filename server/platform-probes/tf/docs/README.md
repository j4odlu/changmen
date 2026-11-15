# TF Node 探针

Node 探针读取 `/api/v8/events/`；生产采集与下注入口为 `client/packages/venue-browser/adapter/tf/`。

环境变量：`TF_GATEWAY`、`TF_TOKEN`；可选 `TF_BET_NAME`、`TF_GAME_IDS`。WebSocket 覆盖参数见 `ws.js`（`TF_WS_URL`）。

从仓库根运行：

```powershell
npm run tf:events --workspace=@changmen/platform-probes
```

HTTP 与请求鉴权复用 `@changmen/venue-node/runtime/tf/`；本目录 `core.js` 负责调试数据归一化，`ws.js` 提供调试 WebSocket 客户端。旧 `ENABLE_TF` Feed 及 `/platforms/tf/` 页面已退役。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/A8_TF_LOGIC_PARITY.md)。
