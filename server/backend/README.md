# server/backend — 服务端（Node）

HTTP API（`Client_*` / `API_*`）、各平台 HTTP 代理、静态托管。开发默认 `localhost:3560`（Windows）/ `3456`。

## 快速启动

在 `changmen/` 下：

```bash
npm install
npm run web
```

Windows：`BAT\setup-dev-env.bat`（首次）→ `BAT\dev.bat` 或 `BAT\backend.bat`。

## 文档（细节见专题页）

| 主题 | 链接 |
|------|------|
| 架构与 monorepo | [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) · [server/README.md](../README.md) |
| 数据存储边界 | [docs/DATA_STORAGE.md](../../docs/DATA_STORAGE.md) |
| 生产部署 | [PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md) |
| 项目共识 / 命令 | [readme.md](../../readme.md) · [CLAUDE.md](../../CLAUDE.md) |
| 游戏 / 玩法 catalog | [docs/CATALOG.md](../../docs/CATALOG.md) |
| HTTP / WS 代理 | [proxy/README.md](./proxy/README.md) |
| 平台适配器 | [packages/venue-adapter/README.md](../../packages/venue-adapter/README.md) |
| 新控制台 / v4 | [client/web/docs/CREDIT_PLATE.md](../../client/web/docs/CREDIT_PLATE.md) |
| 运维脚本 | [scripts/README.md](../../scripts/README.md) |
| 本机 JSON（storage/） | [STORAGE.md](./STORAGE.md) |

## 目录概要

```text
server.js、http_routes.js、static_files.js
core/esport-api/     # 路由、store、platform_sync
core/account/        # 场馆账号
proxy/               # 各平台 HTTP 代理
scripts/             # 运维 CLI（见 scripts/README.md）
storage/             # 运行时 JSON（gitignore，见 STORAGE.md）
storage.example/     # 空模板
public/              # 静态资源（URL 仍为 /esport2/*，见 public/README.md）
```

RDS 迁移 SQL、结构基线与维护代码/测试统一位于 `rds/assets/` 和 `rds/maintenance/`；backend 的旧资产副本及 7 个维护分派入口已删除。

平台 canonical 实现位于 `packages/venue-adapter/`，由 `core/shared/adapter_paths.js` 加载。
