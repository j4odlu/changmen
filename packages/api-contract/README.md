# @changmen/api-contract

客户端与服务端的 **HTTP 契约包**：action 名称、DTO 类型、URL 拼装。

## 使用方

| 包 | 用途 |
|----|------|
| `client/web` | `post()`、`VITE_API_BASE`、类型 |
| `server/backend` | `EsportAction` 与 router 对齐 |
| 脚本 | `urls.mjs` 拼联调 URL |

## 导出

| 路径 | 内容 |
|------|------|
| `@changmen/api-contract` | 类型 + action 常量 |
| `@changmen/api-contract/urls` | `buildEsportUrl`、`buildHttpRelayUrl` |
| `@changmen/api-contract/openapi.yaml` | OpenAPI 3 索引 |

运行入口直接使用 TS 源码；根入口与 `/actions` 共用 `src/actions.ts` 中的常量，`/schemas` 使用 `src/schemas.ts`，不维护并行的 JS 副本。

## 版本

`0.1.0` — monorepo workspace `*`；拆仓后按 semver 发版，破坏性 DTO 变更升 major。

## 校验

```bat
npm run test:api-contract
```

包含原生 Node 入口一致性、URL 拼装、出站 schema 和后端契约回归；原生 Node 检查避免构建工具的模块解析掩盖入口差异。
