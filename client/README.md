# 客户端目录

浏览器应用、浏览器专属包和前端维护工具集中在本目录。

| 目录 | 职责 |
| --- | --- |
| `web/` | Vue 应用、浏览器宿主装配、前端类型检查及构建 |
| `packages/pm-market-data-browser/` | 浏览器公共簿、只读租约、FIFO 与 Worker 循环 |
| `devtools/venue-adapter/` | 前端 adapter 的 exports、内部引用、web 引用检查命令 |

后端业务位于 `server/`，数据库实现及维护主资产位于 `server/db/`，跨端协议与纯逻辑位于 `packages/api-contract`、`packages/shared`。

当前仍有历史路径保留：Chrome 扩展在根 `chrome-extension/`；adapter、client-core 与 arb-core 的受保护源码在根 `packages/`。这些路径不是已经完成迁移的客户端副本。Node 工具实现已迁至 `devtools/runtime-tooling`，`packages/shared/tooling` 仅保留兼容入口，两者均不得用于浏览器运行代码。剩余清单及迁移限制见[文件夹隔离记录](../docs/FOLDER_ISOLATION.md)。

不要在本目录重新实现 Node loader、数据库连接池或 SQL 维护，也不要复制冻结实现来形成第二份运行代码。
