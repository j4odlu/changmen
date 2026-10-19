# @changmen/platform-probes

平台 Node session/core 与调试 CLI 的服务端 workspace。生产采集进程位于 `server/collectors/`；浏览器适配位于 `client/packages/venue-browser/adapter/`。本包的命令按需使用，Node loader 会预加载 manifest 选中的顶层 ESM 模块。

实现唯一位于 `changmen/server/platform-probes/`。旧 `devtools/platform-probes` 的 93 个文件已迁出，不保留旧源码转导出；包名 `@changmen/platform-probes` 和 npm 命令保持不变。

各平台探针专用模块归属本目录，与浏览器实现分离。OB 锁盘观察工具位于客户端包，使用 `npm run ob:lock-observe --workspace=@changmen/venue-browser`。

`requirePlatform("OB", "node", "session.js")` → `server/platform-probes/ob/session.js`。`"backend"` 参数别名和显式根目录覆盖继续兼容。

## 何时用

- 需要直连 OB/RAY 等抓 `game/view`、MQTT 样本
- 运维脚本、catalog 探针、`ob:hybrid` 对照

日常开发不必单独启动探针命令；backend 的 Node loader 通过声明依赖获得本包。

## CLI

```bat
cd changmen/server/platform-probes
npm run ob:view -- --match <id>
```

或从 backend：`npm run ob:view --workspace=@changmen/backend`。

## 瘦包同步

```bat
npm run sync:backend-bundle --workspace=@changmen/platform-probes
# → server/backend/platform_node（部署目录名保持历史兼容）
```

与 `venue-adapter` 的 sync 成对使用（`server/backend/platform_adapter`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `GAMEBET_PLATFORM_PROBES_ROOT` | 覆盖探针包根目录 |
| `GAMEBET_NODE_ROOT` | 同上（历史别名） |
