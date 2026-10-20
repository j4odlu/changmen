# packages/

跨 **client** 与 **server** 的 TypeScript / 契约 workspace。应用代码不互引 `client/*` ↔ `server/*`，共用类型与 catalog 落此目录。

## 包索引

| 包 | 职责 | README |
|----|------|--------|
| `@changmen/shared` | sport/game/market catalog、赔率格式、时间工具 | [shared/README.md](./shared/README.md) |
| `@changmen/api-contract` | `Client_*` / `API_*` action 名与 DTO | [api-contract/README.md](./api-contract/README.md) |
| `@changmen/client-core` | web + venue-adapter + 插件共用客户端层 | [client-core/README.md](./client-core/README.md) |
| `@changmen/arb-core` | 套利纯逻辑（选腿、机会检测、状态 diff） | [arb-core/README.md](./arb-core/README.md) |

## 依赖方向

- `client/web`、`packages/venue-adapter` → `arb-core`、`client-core`、`api-contract`、`shared`
- `server/backend`、`server/match/matcher` → `shared`、`api-contract`（不经 `client-core`）
- `packages/*` **不** import `client/*` 或 `server/*`

数据层（RDS）在 [`server/db`](../rds/)（`@changmen/db`），不在 `packages/`。

相关：[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · [docs/TEAM_BOUNDARIES.md](../docs/TEAM_BOUNDARIES.md)
