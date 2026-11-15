# IMT Node 探针

Node 探针通过 HTTP 获取全量赛事与 delta；生产采集使用浏览器 adapter。

环境变量：`IMT_GATEWAY`、`IMT_TOKEN`（base64 JSON 会话）；可选 `IMT_REFERER`、`IMT_USER_AGENT`、`IMT_X_SC`、`IMT_SPORT_IDS`。

从仓库根运行：

```powershell
npm run imt:events --workspace=@changmen/platform-probes
```

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/IMT.md)。
