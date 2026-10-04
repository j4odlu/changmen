# 本机开发布局

GitHub 仓库 **仅含本目录内容**（`client/`、`server/`、`deploy/` 等）。

以下目录**不进 Git**，可放在 clone 同级或仓库内（已在 `.gitignore`）。**本机现状（2026-09-16）**：`A8/` 在仓库根，不是 `../A8/`。

| 目录 | 用途 |
|------|------|
| `A8/` | A8 只读参考（见下） |
| `pingtai_offical/` | 平台官网抓包参考 |
| `BAT/` | Windows 部署/开发批处理（`deploy-shanghai.bat` 等） |
| `sh/` | Ubuntu/Linux 本机脚本（对应 `BAT\`，见 [sh/README.md](./sh/README.md)） |

### A8 对照文件（gitignore）

Parity 真源是仓库根 `A8/`，**没有**旧文档写的 `A8/A8frontendscipts/2.0.1/`、`index.readable.js`、独立 `index.css`。

| 路径 | 内容 |
|------|------|
| `A8/index0706.js` | 前端 minified bundle（约 2.8MB，内含 Vue 3.5.13）。控制台行为 / API 形状以此为准 |
| `A8/A8插件/` | 官方 Chrome 扩展解压目录（`manifest.json` version **2.0.149**；`version.json` 为 2.0.65） |
| `A8/peter插件.zip` | 另份插件包，不作为对照基线 |

旧路径 `A8/A8frontendscipts/2.0.1/index.js`、`A8/A8chromeplug/2.0.149`、仓库旁 `../A8/` 在本机均不存在。CSS 对照用 changmen 抽出的样式 / 审计 JSON，不在 `A8/` 里。

`BAT\` / `sh/` 会自动检测：仓库根即应用根（`package.json` 在根目录），或旧布局 `../changmen/`。

## 两种拓扑

| 模式 | 命令 | 本机起什么 | API 指哪 |
|------|------|------------|----------|
| **A · remote（日常改 UI）** | `./sh/dev-esport.sh remote` | 只 Vite + 扩展 | VPS（`VITE_API_PROXY`） |
| **B · 全栈（改 backend/合场）** | `./sh/dev-esport.sh` | backend + Vite | 本机 `:3456` |

**A 推荐默认：** Index / 合场 / PM-M 与线上一致；不起本机 backend，避免与 VPS **双 matcher**。  
生产有 **mTLS**：在 `client/web/.env.local` 配 `VITE_API_PROXY_TLS_CERT/KEY`（CN = 登录用户名）。写生产请谨慎。

**B 时：** 本机 backend **不要**连生产 RDS 跑 embedded matcher（用独立库，或明确停 VPS 写）。本机全栈若仍要真 Index，可用 `npm run sync:market-indexes`。

配置模板：`client/web/.env.example`；本机覆盖：`client/web/.env.local`（gitignore）。

### 本机登录恢复与开发端口

[changmen 扩展] `VITE_DEV_PORT` 是 Vite 与本机后端认证来源的共同配置。后端读取 `client/web/.env*` 的 development 配置，环境变量优先；修改端口后重启 Vite 和后端。Vite 启用 `strictPort`，端口占用时直接报错，不自动换端口。

本机 Cookie 登录须配套设置前端 `VITE_WEB_COOKIE_AUTH=1`、后端 `WEB_AUTH_COOKIE_ENABLED=1` 和不少于 32 字符的 `WEB_AUTH_CSRF_SECRET`。Cookie 模式的认证实时连接经 Vite `/esport` 代理，与登录 API 使用同一 host。`WEB_AUTH_ORIGINS` 如有显式配置则始终优先，须自行包含实际开发地址；生产仅使用生产域名白名单。

认证来源或 Cookie 配置不匹配会立即显示配置错误并停止自动恢复重试；网络暂不可用仍保留退避重试与已有会话凭证。

Ubuntu 日常：

```bash
./sh/setup-dev-env.sh          # 首次
./sh/dev-esport.sh remote      # 改 UI / 适配器
# ./sh/dev-esport.sh           # 改 backend 时
```
