# @changmen/venue-node

[changmen 扩展] 此目录的运行入口已退役。源码位于 `server/venues/loader/adapter_paths.mjs`，backend 使用 `@changmen/venue-node`。旧 `@changmen/venue-adapter/loader/adapter_paths.js` / `.mjs` 已停止导出，旧物理文件已删除。

registry 与 probes 位于 `server/`，shared / storage 通过公共包解析。根目录选择、动态预加载和缓存实现保持原样；551 固定保护在新实现位置继续核验。

声明收口和实际安装限制见 [Node 依赖验证](../../../docs/audits/PM_NODE_ENTRY_DEPENDENCY_AUDIT_20261017.md)。当前统一安装与实际发布规则不变。
