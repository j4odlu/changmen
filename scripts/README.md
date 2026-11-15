# 启动与运维脚本

命令默认从仓库根运行，依赖由根目录 `npm install` 统一安装。Windows 本机入口位于 `BAT/`（gitignore），Linux 入口位于 `sh/`。完整配置见 [LOCAL_DEV.md](../LOCAL_DEV.md)。

| 入口 | 作用 |
| --- | --- |
| `BAT\dev-esport.bat` / `sh/dev-esport.sh` | backend + Vite |
| `BAT\backend.bat` / `sh/backend.sh` | 仅 backend |
| `BAT\setup-dev-env.bat` / `sh/setup-dev-env.sh` | 首次本机配置 |
| `npm run web` | backend，Windows 默认 3700，其它系统 3456 |
| `npm run app:dev` | Vite，Windows 默认 5274，其它系统 5174 |
| `npm run matcher:ui` | 可选人工关联 UI，默认 4567 |
| `npm run chromeplug:pack` | 打包 Chrome 扩展 |
| `npm run check:change:plan` / `npm run check:change` | 预览并执行本次改动所需验证 |

matcher 调度随 backend 内嵌运行，无需另启合场循环。浏览器、插件和 VPS collector 的采集职责以 manifest 为准。

| 目录 | 职责 |
| --- | --- |
| [verification/](verification/) | 变更验证、边界检查与显式历史审计 |
| [deploy/](deploy/README.md) | GitHub Actions 发布计划、验收、制品与回滚控制 |
| [sync/](sync/README.md) | 按需同步生产环境配置，与应用发布分开 |
| [archive/](archive/) | 历史仓级工具 |
| [fixtures/](fixtures/) | 平台响应夹具 |
| [../deploy/](../deploy/) | VPS Caddy、PM2 和远程发布控制器 |
| [backend 脚本](../server/backend/scripts/README.md) | 后台及平台运维编排 |
| [RDS 维护](../rds/maintenance/) | 数据库维护实现、SQL 检查及历史数据库脚本 |

发布入口为 GitHub Actions **Validate and release**，详见 [生产部署](../PRODUCTION_DEPLOYMENT.md) 和 [独立部署](../docs/INDEPENDENT_DEPLOYMENT.md)。`master` push 会触发发布，必须有用户针对本次任务的明确 push、部署指令。历史 `deploy202.bat`、`deploy-hk-remaining.mjs` 等不用于受管生产发布。

登录鉴权采用 Cookie 会话；JWT、CSRF 与数据库变量见 `server/backend/.env.example`，密钥长度及启用条件以当前实现为准。运行数据路径通过 `@changmen/storage` 提供，采集凭证默认位于 `server/backend/storage/platforms.json`。不要把旧 `scripts/data/esport/` 或本地用户 JSON 当作当前数据源。

文档索引：[docs/README.md](../docs/README.md)。
