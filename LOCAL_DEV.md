# 本机开发布局

GitHub 仓库 **仅含本目录内容**（`client/`、`server/`、`deploy/` 等）。

本机参考资料及 Windows 脚本不进 Git；`sh/` 是仓库内受版本控制的 Linux 脚本。**本机现状（2026-09-16）**：`A8/` 在仓库根，不是 `../A8/`。

| 目录 | 用途 |
|------|------|
| `A8/` | A8 只读参考（见下） |
| `pingtai_offical/` | 平台官网抓包参考 |
| `BAT/` | Windows 部署/开发批处理（`deploy-shanghai.bat` 等） |
| `sh/` | 仓库内 Ubuntu/Linux 脚本（对应本机 `BAT\`，见 [sh/README.md](./sh/README.md)） |

### A8 对照文件（gitignore）

Parity 真源是仓库根 `A8/`，**没有**旧文档写的 `A8/A8frontendscipts/2.0.1/`、`index.readable.js`、独立 `index.css`。

| 路径 | 内容 |
|------|------|
| `A8/index0706.js` | 前端 minified bundle（约 2.8MB，内含 Vue 3.5.13）。控制台行为 / API 形状以此为准 |
| `A8/A8插件/` | 官方 Chrome 扩展解压目录（`manifest.json` version **2.0.149**；`version.json` 为 2.0.65） |
| `A8/peter插件.zip` | 另份插件包，不作为对照基线 |

旧路径 `A8/A8frontendscipts/2.0.1/index.js`、`A8/A8chromeplug/2.0.149`、仓库旁 `../A8/` 在本机均不存在。CSS 对照用 changmen 抽出的样式 / 审计 JSON，不在 `A8/` 里。

`BAT\` / `sh/` 会自动检测：仓库根即应用根（`package.json` 在根目录），或旧布局 `../changmen/`。

## Node.js 版本

本机、CI 和生产统一使用 Node.js **26.13.0 LTS**；根 .node-version 记录版本，package.json 限定 26 系列。安装后重新打开终端并运行 node --version。npm 版本沿用根 packageManager，运行时升级不修改第三方依赖的 engines 或历史验收记录。

## npm workspace 与本机依赖

根 `package.json` 的 `workspaces` 把前端、后端、数据库层和共享模块纳入一次安装，当前清单见 [WORKSPACE_LAYOUT.md](./docs/WORKSPACE_LAYOUT.md)。npm workspace 是仓库内部的包；Git worktree 则是同一仓库额外检出的代码目录。

日常在仓库根运行 `npm install`，使用根锁文件及指定 npm 版本。`node_modules/@changmen/*` 指向各包源码，Windows 上通常表现为目录联接（junction），这些链接不会复制一整套源码。npm 还可能为版本冲突在个别 workspace 下安装嵌套依赖，不能一概视为重复垃圾。

`npm run dev` 使用根依赖中的 Turbo。若提示找不到 `turbo`，先确认终端在仓库根、根依赖完整、`node_modules/.bin/turbo.cmd`（Windows）存在；正常缺失安装时在根目录重新运行 `npm install`，不需要全局安装 Turbo。若刚进行过清理或移动，应先排查误移及备份，避免直接重装掩盖问题。

### 空间检查与清理

- 统计目录大小时跳过 junction/符号链接目标，避免重复累计源码或越出目标目录。
- `.turbo/cache` 是构建缓存，可在相关任务结束后清理，后续任务会重新生成。当前 `node_modules` 和 workspace 链接是开发依赖，删除后需重新安装。
- `output/` 可能同时包含报告、历史安装夹具与临时 PostgreSQL 数据。先核对用途、停用状态及链接目标，保留报告和必要输入；大型历史夹具压缩归档、核验文件清单与哈希后再清理。含链接的目录不得直接递归移动或删除；只移除链接本身，后续遍历不跟随链接。
- `.env*`、平台凭证、活跃 storage 和数据库数据不能按缓存清理。恢复历史文件前先与当前版本比较，不整批覆盖工作目录。

## 两种拓扑

| 模式 | 命令 | 本机起什么 | API 指哪 |
|------|------|------------|----------|
| **A · remote（日常改 UI）** | `./sh/dev-esport.sh remote` | 只 Vite + 扩展 | VPS（`VITE_API_PROXY`） |
| **B · 全栈（改 backend/合场）** | Linux：`./sh/dev-esport.sh`；Windows：`BAT\dev-esport.bat` | backend + Vite | Windows 默认 `:3700`，其它系统 `:3456` |

**A 推荐默认：** Index / 合场 / PM-M 与线上一致；不起本机 backend，避免与 VPS **双 matcher**。
生产有 **mTLS**：在 `client/web/.env.local` 配 `VITE_API_PROXY_TLS_CERT/KEY`（CN = 登录用户名）。写生产请谨慎。

**B 时：** 本机 backend **不要**连生产 RDS 跑 embedded matcher（用独立库，或明确停 VPS 写）。本机全栈若仍要真 Index，可用 `npm run sync:market-indexes`。

配置模板：`client/web/.env.example`；本机覆盖：`client/web/.env.local`（gitignore）。

### 本机登录恢复与开发端口

[changmen 扩展] `VITE_DEV_PORT` 是 Vite 与本机后端认证来源的共同配置。后端读取 `client/web/.env*` 的 development 配置，环境变量优先；修改端口后重启 Vite 和后端。Vite 启用 `strictPort`，端口占用时直接报错，不自动换端口。

本机 Cookie 登录须配套设置前端 `VITE_WEB_COOKIE_AUTH=1`、后端 `WEB_AUTH_COOKIE_ENABLED=1` 和不少于 32 字符的 `WEB_AUTH_CSRF_SECRET`。Cookie 模式的认证实时连接经 Vite `/esport` 代理，与登录 API 使用同一 host。`WEB_AUTH_ORIGINS` 如有显式配置则始终优先，须自行包含实际开发地址；生产仅使用生产域名白名单。

认证来源或 Cookie 配置不匹配会立即显示配置错误并停止自动恢复重试；网络暂不可用仍保留退避重试与已有会话凭证。

### 本机归档记录

2026-10-16 工作区同步前的剩余改动归档在 `E:\River\arb\archives\e-workspace-sync-20261016-130202`。取用旧文件前先与当前 `master` 比较，不整批覆盖。

2026-11-08 旧工作目录、分支和 stash 的归档位于 `E:\River\arb\changmen-worktree-archives\20261108-120531` 与 `E:\River\arb\changmen-worktree-archives\remaining-cleanup-20261108`；恢复入口分别见 `RESTORE.txt` 和 `CLEANUP_REPORT.txt`。

同日历史产物清理记录位于 `E:\River\arb\changmen-worktree-archives\size-optimization-20261108-123637\OPTIMIZATION_REPORT.txt`。其中 `historical-output.zip` 与 `manifest.json` 保存归档内容及校验信息；`workspace-recovery.zip` 保存误移动后找回的非依赖原文件。历史 `node_modules` 和链接未归档，重跑旧安装实验需另行准备相应源码和依赖。项目内保留的报告仍可从原路径读取。上述位置均为本机归档，不属于仓库或部署内容。

Ubuntu 日常：

```bash
./sh/setup-dev-env.sh          # 首次
./sh/dev-esport.sh remote      # 改 UI / 适配器
# ./sh/dev-esport.sh           # 改 backend 时
```
