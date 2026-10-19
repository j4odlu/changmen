# 历史数据库维护脚本

从 `server/backend/scripts/` 分两批迁入的 140 个数据脚本（130 + 10）。保留原文件名及既有 SQL、事务、参数和执行默认值；131 个正文不变，其余仅调整已核对的导入/资源路径，其中一个归档脚本修复原本失效的数据层导入。旧路径已经删除。

| 目录 | 数量 | 原位置及用途 |
| --- | --- | --- |
| `archive/` | 41 | 原 archive 中的数据库诊断与临时数据修复 |
| `diagnostics/` | 30 | 原 ops/diagnostics 中的数据库巡检 |
| `incidents/` | 50 | 原 ops/incidents 中的特定历史数据修复 |
| `migrations/` | 17 | 原 ops/migrations 中的数据回填、转换、备份与核验 |
| 当前目录 | 2 | `enable-bet-target.mjs`、`create-user.js` |

四个现有 backend npm 命令名称保持：`db:migrate-players-owner`、`db:migrate-accounts-from-jsonb`、`db:finalize-players-owner`、`db:check-players`，直接执行本目录下的文件。保持原 backend 工作目录调用 npm 命令，其余手动脚本按原环境和参数要求选择新路径；脚本内旧调用示例属于历史注释。

`user:create` 和 `db:backup-accounts` 也已指向本目录，原参数保持。第二批核对了旧环境文件、caller cwd 和默认/显式备份输出地址；这些资源位置仍与原脚本相同，没有读取或复制环境文件来完成迁移。特定历史脚本仍保留指向原 backend 环境/备份目录的资源兼容，不能据此宣称它们支持任意独立安装布局。

迁移没有改变 dry-run、`--apply`、`--execute` 或备份规则。迁移验收核对源码、依赖、完整原文和资源路径；用户创建 CLI 另用模拟数据库驱动做原生对照，不对真实数据库执行这些历史维护。依赖后台业务、外部平台 API 或仍待处理环境/路径的其余脚本保留在 backend，数据层不反向导入它们。
