# changmen — 多平台电竞赔率聚合

> A8 参考在仓库根 `A8/`（gitignore，不进 GitHub）。前端 bundle：`A8/index0706.js`；插件：`A8/A8插件/`（manifest 2.0.149）。见 [LOCAL_DEV.md](./LOCAL_DEV.md)。

**客户端 + 服务端**系统：浏览器采集/下注 → `API_SaveMatch` / `API_SaveBet` → RDS → matcher → `Client_GetMatchs`。不是单机本地工具。

源码按 `client/`、`server/`、`rds/` 分层，另有共享 `packages/` 和开发 `devtools/`。当前共 25 个 npm workspace，入口和职责见 [目录与 workspace 总览](docs/WORKSPACE_LAYOUT.md)；依赖安装、链接和本机清理见 [LOCAL_DEV.md](./LOCAL_DEV.md)。

## 快速开始

```bat
npm install
BAT\setup-dev-env.bat    REM 首次
BAT\dev-esport.bat              REM backend + Vite（见 LOCAL_DEV.md）
```

本仓库即应用根。Windows 批处理在 `BAT\`（gitignore，见 [LOCAL_DEV.md](./LOCAL_DEV.md)）。

| 命令 | 作用 |
|------|------|
| `npm run web` | 后端（Win `:3700` / 其它 `:3456`） |
| `npm run app:dev` | 前端 Vite |
| `npm run app:build` | 生产构建 → `client/web/dist/` |
| `npm test` | 边界检查 + 全仓测试 |

## 共识（摘要）

1. **API 形状**由 A8 bundle 反推；parity 以 bundle / 抓包为准。
2. **采集按平台分流**：browser / plugin 在客户端采集上报；`vps_http_ws` 由 VPS collector 独占写入。
3. 浏览器平台的 **CollectConfig** 只控制是否上报，不停止连接与 `fo` 缓存；VPS 平台按独占写规则处理。
4. **合并真相源**：RDS `client_matches`（matcher 写入，UI 只读）。
5. **产品线**：对称锚点 `lines/{code}/`；电竞实现仍在根目录，见 [lines/README.md](./lines/README.md)。
6. **目录即拓扑**：`client/` 是浏览器侧，`server/` 是服务端，`rds/` 是数据层。浏览器平台实现位于 `client/packages/venue-browser`，Node loader 位于 `server/venues`；共享领域规则位于 `packages/`。

## 文档索引

| 文档 | 内容 |
|------|------|
| [LOCAL_DEV.md](./LOCAL_DEV.md) | 本机开发：依赖、端口、空间清理与归档恢复 |
| [docs/README.md](./docs/README.md) | 专题文档目录 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Monorepo 结构、数据流、端口 |
| [docs/CATALOG.md](./docs/CATALOG.md) | 游戏 / 运动 / 玩法 catalog（**配置单一入口**） |
| [docs/SPORTS_PRODUCT_LINES.md](./docs/SPORTS_PRODUCT_LINES.md) | 多运动产品线、目录整合 |
| [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) | 生产部署、PM2、环境变量 |
| [server/README.md](./server/README.md) | 服务端包与进程 |
| [scripts/README.md](./scripts/README.md) | 运维脚本索引 |

### 客户端 / Parity

| 文档 | 内容 |
|------|------|
| [client/web/README.md](./client/web/README.md) | 控制台 |
| [client/packages/venue-browser/README.md](./client/packages/venue-browser/README.md) | 浏览器平台采集/下注 |
| [client/web/docs/README.md](./client/web/docs/README.md) | A8 parity 文档集 |

## 仓库结构（摘要）

```
client/web · client/packages（client-core / arb-core / venue-browser） · chrome-extension
server/backend · server/match（matcher / resolver） · server/venues · server/collectors
rds · packages（shared / api-contract / match-identity）
deploy/ · docs/ · lines/
```

完整目录见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。
