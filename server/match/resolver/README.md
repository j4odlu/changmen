# @changmen/team-resolver

提供 RDS 队伍映射插件，以及 MLB / 足球等体育队名和配对规则。
根入口 `@changmen/team-resolver` 与两个无后缀子入口共享同一实现，均为严格 TS 源码。

```js
import { loadAndCreatePlugin, createSportTeamPlugin } from "@changmen/team-resolver";
```

导入模块不会连接数据库；显式调用 `loadAndCreatePlugin()` 后才经 `@changmen/db` 读取映射。

## 使用方

| 包 | 关系 |
|----|------|
| `server/match/matcher` | 动态加载 `@changmen/team-resolver/team_db` 构建 RDS 队伍映射插件 |
| `server/backend` | 使用 `@changmen/team-resolver/sport_team_plugin` 规范化体育队名 |

resolver 依赖 `packages/match-identity` 提供的 `resolveCanonicalTeamName` 等工具。

## 目录

| 路径 | 内容 |
|------|------|
| `index.ts` | 两个现用插件及体育队名函数的公共根入口 |
| `team_db.ts` | matcher 用的 DB 插件面 |
| `sport_team_plugin.ts` | MLB / 足球队名与配对键 |

## 命令

```bat
cd server/match/resolver
npm test
```

`npm test` 执行严格 TS 检查、模拟 DB 的离线断言、原生 Node 根/子入口验证及体育队名冒烟。
`database-port.d.ts` 只描述本包调用的 JS 数据层公共操作；不新增 SQL 或连接池。
根入口和子入口的 ESM/CJS 导出保持函数身份一致，导入时禁止加载 DB 或发起网络请求。
插件公共入口统一无后缀，旧 `.js` 子路径已退役。

环境：RDS 配置由 `@changmen/storage/load_env` 加载；体育队名规则不读取数据库。

旧 RAY / OB / PB 队伍爬虫、PandaScore/Liquipedia 在线查询、本地队伍缓存、seed 与在线诊断命令均已退役。
旧 `resolve`、`resolveMatch`、`scoreMatchPair` 不再导出，包不再依赖 axios 或平台 Node loader。
RDS 的 `pandascore_id`、通用 provider ID 索引、映射数据及历史 SQL 保留；旧本地缓存文件不再读取，不执行数据清除。

相关：[packages/match-identity/README.md](../../../packages/match-identity/README.md)
