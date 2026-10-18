# @changmen/shared

**sport / game / market catalog** 与跨端小工具（赔率格式、比赛时间、`im_parse` 等）。配置 JSON 为单一事实来源，TS 模块做校验与浏览器/Node 双入口。

## 导出（节选）

| 路径 | 内容 |
|------|------|
| `@changmen/shared/catalog/sport_catalog` | 运动 taxonomy + `linePath` |
| `@changmen/shared/catalog/game_catalog` | 电竞等 game 元数据 |
| `@changmen/shared/catalog/market_catalog` | 盘口类型 |
| `@changmen/shared/odds_format` | 赔率展示/换算 |
| `@changmen/shared/time/match_time` | 开赛时间解析 |
| `@changmen/shared/match-identity` | 共享身份、队名、client_match ID 与时间窗实现；原 identity 包保留兼容入口 |
| `@changmen/shared/tooling/runtime_version.js` | 旧 Node 兼容导出；真实实现归 `@changmen/runtime-tooling` |
| `@changmen/shared/tooling/dev_web_port.js` | 旧 Node 兼容导出；Vite 与后端使用新包的同一函数 |

完整 `exports` 见 [package.json](./package.json)。

[changmen 扩展] `tooling/` 是仅限 Node 的兼容 workspace，四个文件只转导出到 [runtime-tooling](../../devtools/runtime-tooling/README.md)，没有真实算法。shared 本体不声明 Node 工具依赖；Vite 与 storage 分别显式拥有构建和运行依赖，旧入口由兼容 workspace 声明 canonical 依赖。组件边界拒绝浏览器/扩展运行代码导入旧、新路径。来源识别继续精确还原完整历史算法，端口实现逐字迁移；后端环境文件读取仍由 storage 负责，shared 不加载凭据或连接数据库。

[changmen 扩展] `match-identity/` 的实现从原纯库逐字迁入，不导入数据层、网络或应用实现，team plugin 仍显式注入。旧、新入口共享函数及插件状态；旧别名 JSON 公开路径保留严格一致的兼容资产。源码归属与剩余兼容路径见 [隔离记录](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。

## 使用方

| 包 | 典型用途 |
|----|----------|
| `client/web` | UI 标签、过滤、catalog 下拉 |
| `server/match/matcher` | 合并规则、队名归一 |
| `server/backend` | 平台同步、校验 |

## 扩展规则

新增 sport / game / market：**先改 JSON**，再补 TS 类型与文档。字段说明见 [docs/CATALOG.md](../../docs/CATALOG.md)；产品线锚点见 [lines/](../../lines/README.md)。

相关：[packages/README.md](../README.md)
