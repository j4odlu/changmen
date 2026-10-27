# @changmen/team-resolver

电竞 **队名解析**：平台队名 → canonical team id（PandaScore / 本地缓存）。
matcher 使用 `@changmen/team-resolver/team_db` 从 RDS 加载队伍映射，不经过在线 provider 查询。

## 使用方

| 包 | 关系 |
|----|------|
| `server/match/matcher` | 动态加载 `@changmen/team-resolver/team_db` 构建 RDS 队伍映射插件 |
| `server/backend` | 使用 `@changmen/team-resolver/sport_team_plugin` 规范化体育队名 |

resolver 依赖 `packages/match-identity` 提供的 `resolveCanonicalTeamName` 等工具。

## 目录

| 路径 | 内容 |
|------|------|
| `index.js` | `resolve(teamName, gameCode)` 主入口 |
| `team_db.ts` | matcher 用的 DB 插件面 |
| `sport_team_plugin.ts` | MLB / 足球队名与配对键 |
| `providers/` | PandaScore |
| `cache/` | 本地 TTL 缓存 |

## 命令

```bat
cd server/match/resolver
npm test
```

`npm test` 执行现用插件的严格 TS 检查、模拟 DB/provider 的离线断言、原生 Node 公共入口验证及体育队名冒烟。
`database-port.d.ts` 只描述本包调用的 JS 数据层公共操作；不新增 SQL 或连接池。
两处插件公共入口统一无后缀，旧 `.js` 子路径已退役。
原 `test.js` 是会访问 PandaScore、读取和写入本地缓存的诊断程序，
改由 `npm run probe:live` 显式执行；它的打印结果不作为自动验收成功依据。
未配置 `PANDASCORE_TOKEN` 或指定 `--no-pandascore` 时仅查询已有缓存。
在线解析只接受 PandaScore 来源的缓存；未命中或查询失败返回 `null`。
`index.js`、PandaScore/cache 与 `seed.js`、`test.js` 保留为在线解析及手动工具，未接入当前生产调度，不属于本轮 TS 迁移范围。
离线套件覆盖正向、反向队伍配对及仅单边队伍一致时拒绝合场的场景。

环境：`PANDASCORE_TOKEN`（可选）。`.env` 经 `@changmen/storage/load_env` 加载。

旧 RAY / OB / PB 队伍爬虫及其 npm 命令已退役；resolver 不再依赖平台 Node loader。

相关：[packages/match-identity/README.md](../../../packages/match-identity/README.md)
