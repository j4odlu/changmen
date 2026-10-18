# @changmen/match-identity

赛事匹配模块的**纯函数层**：`client_match` ID 分配、队名键、平台优先级与开赛时间容差。旧 `merge/` 合并管线已下线。

[changmen 扩展] 2026-10-17：本目录现为兼容入口，8 个 JS 实现逐字迁至 `packages/shared/match-identity`；RDS 直接使用该 shared 入口，matcher / resolver 的原 import 保持可用。所有入口共享同一函数与插件状态。本目录的别名 JSON 保留旧公开路径，门禁要求其与 shared canonical 资产逐字一致，详见[源码隔离记录](../../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

唯一依赖是 `@changmen/shared`。这份纯度是刻意维持的——`server/db`、`server/backend` 与诊断脚本都直接引用本包，一旦掺入 express / axios / 平台适配层，这些消费方就会被迫拖上整条运行时依赖链。

## 使用方

| 包 | 关系 |
|----|------|
| `server/match/matcher` | 合场（`compose/`）、align、人工关联与 UI 复用 teams / ids / time windows |
| `server/match/resolver` | 队名 canonical（matcher 动态注入） |
| `server/db` | `rds/team_store.js` 的队名归一 |
| `@changmen/shared` | catalog、时间工具（本包唯一依赖） |

## 目录

| 路径 | 内容 |
|------|------|
| `ids/client_match_ids.js` | id 复用与关联 |
| `teams/` | 队名 key、OB canonical、别名 JSON |
| `time_windows.js` | composer / align 共用开赛时间容差 |
| [`profiles/`](profiles/README.md) | 运动 profile 壳（`esport` / `baseball` 规划；**运行时尚未接线**） |

## 测试

```bat
npm test --prefix server/match/identity
```

相关：[server/match/matcher/README.md](../matcher/README.md) · [docs/CATALOG.md](../../../docs/CATALOG.md)（`matcherProfile`）
