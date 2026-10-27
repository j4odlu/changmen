# @changmen/team-resolver

电竞 **队名解析**：平台队名 → canonical team id（PandaScore / Liquipedia / 本地缓存）。

## 使用方

| 包 | 关系 |
|----|------|
| `server/match/matcher` | `matchMerge` 前队名归一（`requirePlatform` 加载 `team_db.js`） |
| `packages/match-identity` | `resolveCanonicalTeamName` 等工具 |

## 目录

| 路径 | 内容 |
|------|------|
| `index.js` | `resolve(teamName, gameCode)` 主入口 |
| `team_db.js` | matcher 用的 DB 插件面 |
| `providers/` | PandaScore、Liquipedia |
| `scrapers/` | RAY / OB / PB 队名爬取（`npm run scrape:*`） |
| `cache/` | 本地 TTL 缓存 |

## 命令

```bat
cd server/match/resolver
npm run scrape:ray:dry
npm test
```

`npm test` 使用模拟 provider 与独立缓存做离线断言，并执行体育队名冒烟。
原 `test.js` 是会访问 PandaScore / Liquipedia、读取和写入本地缓存的诊断程序，
改由 `npm run probe:live` 显式执行；它的打印结果不作为自动验收成功依据。
离线套件中有一个 `it.fails` 登记旧版 `scoreMatchPair` 未正确识别反向队伍的缺口，
匹配算法保持原状；修复算法时须同步处理该预期失败用例。

环境：`PANDASCORE_TOKEN`（可选）。`.env` 经 `@changmen/storage/load_env` 加载。

相关：[packages/match-identity/README.md](../../../packages/match-identity/README.md)
