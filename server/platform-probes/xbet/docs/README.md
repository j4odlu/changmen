# XBet Node 探针

浏览器通过共享 Socket.IO 频道 `XBet` / `XBet:Score` 处理赔率及比分。

本平台没有独立 Node 采集命令；浏览器入口为 `client/packages/venue-browser/adapter/xbet/`。下注能力以当前 manifest 为准。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../../README.md)；[本机开发](../../../../LOCAL_DEV.md)；[平台说明](../../../../client/web/docs/platforms/XBET.md)。
