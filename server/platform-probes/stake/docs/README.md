# Stake Node 探针

Node 探针通过 GraphQL 获取快照；生产采集方式以 manifest 与浏览器 adapter 为准。

环境变量：`STAKE_ACCESS_TOKEN`（兼容 `STAKE_TOKEN`）；可选 `STAKE_API_URL`、`STAKE_SPORTS`。

从仓库根运行：

```powershell
npm run stake:sports --workspace=@changmen/platform-probes
```

旧 `ENABLE_STAKE` Feed 和 `/platforms/stake/` 页面已退役。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/STAKE.md)。
