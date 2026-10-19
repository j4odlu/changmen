# @changmen/client-core

`client/web` 与 `packages/venue-adapter`、Chrome 插件共用的 **客户端 TS 层**：领域模型、DTO、HTTP/平台工具。

## 使用方

| 包 | 典型 import |
|----|-------------|
| `client/web` | `@changmen/client-core/shared/platformHttp`、`bridge/clientApi` |
| `packages/venue-adapter` | `shared/http`、`models/platformAccount` |
| `chrome-extension` | `chrome-plugin/bridge` |

## 目录

| 路径 | 内容 |
|------|------|
| `src/types/` | CollectConfig、账号、平台 ID 等 |
| `src/types/order.ts` | 补单记录、`MakeupRuntimePhase` |
| `src/types/esport.ts` | `@changmen/api-contract` DTO re-export |
| `src/models/` | `match`、`betOption`、`betResult`、`loseOrder`、`platformAccount` |
| `src/shared/` | `http`、`platformHttp`、`hkRelayOrigin`、格式化 |
| `src/bridge/` | 与 UI store / 插件桥接 |
| `src/chrome-plugin/` | MV3 content ↔ web 消息 |

HTTP action 名与 DTO 形状见 `@changmen/api-contract`；catalog 见 `@changmen/shared`。

## 包纪律（I3g）

`exports` 由消费方扫描生成，勿手写漂移：

```bat
npm run list:imports --workspace=@changmen/client-core
npm run sync:exports --workspace=@changmen/client-core
npm run check:client-core
```

根目录 `npm test` 已包含 `check:client-core`（exports + 包内无自引用 + 消费方子路径全覆盖）。

- **不放**服务端或 DB 代码；不 `import` `server/*`
- 新跨端（web + adapter）类型优先落此包，避免 `client/web` ↔ `venue-adapter` 互引

相关：[docs/TEAM_BOUNDARIES.md](../../../docs/TEAM_BOUNDARIES.md) · [packages/api-contract/README.md](../../../packages/api-contract/README.md)
