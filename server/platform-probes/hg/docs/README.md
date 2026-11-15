# HG（皇冠） Node 探针

`session.js` 是本目录手动余额探针的本地模块，不属于后端生产运行资源。Node 探针读取账户余额；浏览器账号与跟单入口为 `client/packages/venue-browser/adapter/hg/`。

环境变量：`HG_GATEWAY`、`HG_TOKEN`（包含 `uid`、`ver` 的 JSON）。

从仓库根运行：

```powershell
npm run hg:balance --workspace=@changmen/platform-probes
```

旧 `ENABLE_HG` Feed 和 `/platforms/hg/` 页面已退役。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/HG.md)。
