# SABA Node 探针

Node 探针解析赛事页面；浏览器 adapter 负责生产页面解析及 WebSocket 数据。

环境变量：`SABA_GATEWAY`、`SABA_TOKEN`；可选 `SABA_GAME_IDS`、`SABA_SPORT_PATH`、`SABA_USER_AGENT`。

从仓库根运行：

```powershell
npm run saba:parse --workspace=@changmen/platform-probes
```

旧 `ENABLE_SABA` Feed 和 `/platforms/saba/` 页面已退役。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/SABA.md)。
