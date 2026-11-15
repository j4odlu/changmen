# PB（平博） Node 探针

Node 探针用于读取电竞 odds、单场赛事和余额。生产浏览器采集与插件代发见 PB 平台文档。

环境变量：`PB_GATEWAY`、`PB_TOKEN`；可选 `PB_COOKIE`、`PB_REFERER`、`PB_USER_AGENT`、`PB_GAME_SLUGS`。token 格式以 `@changmen/venue-node/runtime/pb/session.js` 为准。

从仓库根运行：

```powershell
npm run pb:odds --workspace=@changmen/platform-probes
npm run pb:match --workspace=@changmen/platform-probes -- <match_id>
npm run pb:balance --workspace=@changmen/platform-probes
```

已删除的 Dashboard Feed、`ENABLE_PB_NODE` 和 `/console/` patch 不是当前启用方式。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/PB.md)。
