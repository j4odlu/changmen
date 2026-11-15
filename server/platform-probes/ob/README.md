# OB Node 探针

Node 库提供登录、HTTP、MQTT 解析与调试 CLI；生产浏览器入口为 `client/packages/venue-browser/adapter/ob/`。

登录 URL 由 `OB_LOGIN_URL` 覆盖；默认值见 `@changmen/venue-node/runtime/ob/session.js`。`OB_MQTT_URL` 可覆盖 MQTT 地址。

从仓库根运行：

```powershell
npm run ob:login --workspace=@changmen/platform-probes
npm run ob:view --workspace=@changmen/platform-probes -- --match <match_id> --stage 0
npm run ob:mqtt --workspace=@changmen/platform-probes -- --match <match_id> --duration 60
```

登录、HTTP、归一化及 MQTT 增量复用 `@changmen/venue-node/runtime/ob/`；`scripts/` 包含状态探针和混合采集实验工具。锁盘与 SaveBet 规则见浏览器 adapter 的 `shared/save_bets.ts`。

本目录是按需调试入口。采集模式以 `packages/venue-adapter/registry/manifest.json` 为准；浏览器平台的 CollectConfig 只控制上报，VPS 平台由 collector 独占写入。命令需要有效会话，可能访问平台；不会因启动 backend 自动运行。

[探针包说明](../README.md)；[本机开发](../../../LOCAL_DEV.md)；[平台说明](../../../client/web/docs/platforms/OB.md)。
