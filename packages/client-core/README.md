# client-core 兼容入口

[changmen 扩展] 实现已迁至 `client/packages/client-core`，workspace 包名 `@changmen/client-core` 保持不变。本目录不再注册为 workspace；`src/` 仅转导出唯一实现，旧 package.json、tsconfig 和命令入口暂留兼容。不要在本目录增加业务实现。

迁移与验证见 `docs/CLIENT_PACKAGE_ISOLATION_20261019.md`。
