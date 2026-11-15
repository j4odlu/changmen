# 服务端平台设施

`@changmen/venue-node` 提供后端必需的平台运行模块、Node loader、registry 和瘦包工具。浏览器实现位于 `client/packages/venue-browser`，手动探针位于 `server/platform-probes`。

| 目录或入口 | 用途 |
| --- | --- |
| `loader/adapter_paths.mjs` | 包主入口，保留 `requirePlatform` 等现有调用方式 |
| `registry/paths.js`、`feeds.js` | 平台路径与采集规则 |
| `registry/manifest.json` | 从共享清单生成的副本 |
| `registry/runtime/` | 自有运行模块：OB/RAY/PB 会话、TF 会话与鉴权，以及 RAY/TF/IA 采集配置 |
| `@changmen/venue-node/runtime/*` | 探针等调用方复用运行模块的公开子入口，保留文件扩展名 |
| `sync-backend-bundle.mjs` | 生成 `server/backend/platform_adapter` 瘦包 |

例如：`requirePlatform("OB", "node", "session.js")` 加载 `registry/runtime/ob/session.js`；探针可直接导入 `@changmen/venue-node/runtime/ob/session.js`。`"backend"` 参数别名保留。

loader 只预加载 `PLATFORM_ESM_MODULES` 明确列出的 8 个 ESM 入口，不扫描探针目录，也不加载调试 WebSocket。HG 会话仅供手动探针使用，留在 `server/platform-probes/hg/`，不随本包交付。默认使用本包资源；独立瘦包可用 `CHANGMEN_NODE_ROOT` / `GAMEBET_NODE_ROOT` 覆盖 Node 资源根。旧 `*_PLATFORM_PROBES_ROOT` 不再控制后端资源解析。

运行 `npm run sync:backend-bundle --workspace=@changmen/venue-node` 即可交付后端平台资源。生产依赖不包含 `@changmen/platform-probes`；探针单向复用本包。当前 workspace 总览见 [目录与包说明](../../docs/WORKSPACE_LAYOUT.md)。
