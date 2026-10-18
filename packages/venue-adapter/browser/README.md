# 浏览器专属实现

[changmen 扩展] `pm-book-diagnostics/` 承接原 wsBook 诊断、HTTP 对照、执行模拟、协议与观察插槽；`pm-book-source.ts` 提供原行情的只读 source。原入口只转导出，同一观察槽、运行类和 source 对象不会重复实例化。

核心簿仍属于 `@changmen/pm-market-data-browser`。本目录没有 Node loader、数据库或后台服务职责；Node 生产入口和动态 loader 均禁止到达这里。旧浏览器计算辅助函数仍在 polymarket 原位置复用，实际预检继续 HTTP，本地簿与对照默认关闭。

迁移验证及冻结保留项见 [源码隔离记录](../../../docs/SOURCE_FILE_ISOLATION_20261017.md)。
