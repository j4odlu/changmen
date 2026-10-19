# 浏览器专属实现

[changmen 扩展] 本目录现为兼容入口，唯一实现位于 `client/packages/venue-browser/`。`pm-book-diagnostics/` 对应 wsBook 诊断、HTTP 对照、执行模拟、协议与观察插槽；`pm-book-source.ts` 对应原行情的只读 source。同一观察槽、运行类和 source 对象不会重复实例化。

核心簿仍属于 `@changmen/pm-market-data-browser`。本目录没有 Node loader、数据库或后台服务职责；Node 生产入口和动态 loader 均禁止到达这里。旧浏览器计算辅助函数仍在 polymarket 原位置复用，实际预检继续 HTTP，本地簿与对照默认关闭。

依赖归属仍是现有 adapter workspace；客户端新目录尚未成为独立 npm 包。历史记录见 [源码隔离记录](../../../docs/SOURCE_FILE_ISOLATION_20261017.md)，当前迁移见 [浏览器目录隔离](../../../docs/VENUE_BROWSER_ISOLATION_20261019.md)。
