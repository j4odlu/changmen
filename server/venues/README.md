# 服务端平台设施

`@changmen/venue-node` 统一提供 Node loader、registry、默认平台资源和瘦包工具。浏览器平台实现位于 `client/packages/venue-browser`。

| 目录或文件 | 用途 |
| --- | --- |
| `loader/adapter_paths.mjs` | 包主入口：平台加载、registry 初始化及 Node 能力 |
| `registry/paths.js`、`feeds.js` | 平台路径与采集规则 |
| `registry/manifest.json` | 从共享清单生成的副本 |
| `registry/runtime/` | 默认 Node 资源根 |
| `sync-backend-bundle.mjs` | 生成已有后端瘦包结构 |

使用 `npm run sync:backend-bundle --workspace=@changmen/venue-node` 打包；平台探针仍由 `@changmen/platform-probes` 自行交付。当前 workspace 总览见 [目录与包说明](../../docs/WORKSPACE_LAYOUT.md)。
