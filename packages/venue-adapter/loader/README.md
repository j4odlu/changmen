# @changmen/venue-node-loader

[changmen 扩展] backend 使用的 Node workspace 入口，直接导出原 `adapter_paths.mjs`。旧 `@changmen/venue-adapter/loader/adapter_paths.js` / `.mjs` 仍解析到同一源码；不复制实现、不改变根选择、动态预加载或缓存。

源码保留原仓库布局以维护 551 固定保护。registry 与 probes 属于必要运行资源，shared / storage 通过原机制解析。本包不是任意布局均可使用的独立发布产物。

声明收口和实际安装限制见 [Node 依赖验证](../../../docs/audits/PM_NODE_ENTRY_DEPENDENCY_AUDIT_20261017.md)。当前统一安装与实际发布规则不变。
