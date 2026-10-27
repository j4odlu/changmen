# @changmen/match-identity

赛事与队伍身份领域包，供 matcher、resolver 和 RDS 使用。实现从 `packages/shared/match-identity` 迁入；客户端及 `@changmen/shared` 不得依赖本包。

| 入口 | 职责 |
| --- | --- |
| 包根入口 | 公共函数与类型 |
| `teams/team_key.js` | 队名归一化、别名、比赛键、主客反向标记及注入的队伍查找插件 |
| `teams/match_utils.js` | 标题、占位队名、稳定比赛/盘口辅助编号 |
| `teams/provider_priority.js` | 平台优先级与标准主客队名选择 |
| `teams/canonical_ob_name.js` | OB 队名与已存标准队名的回落规则 |
| `ids/client_match_ids.js` | 比赛 ID 复用、分配及人工关联键 |
| `time_windows.js` | 开赛时间容差，含缺失时间的宽松与严格比较 |
| `profiles/esport.js` | 电竞公共导出 |
| `types` | 队伍插件、比赛行与宿主数据接口类型 |
| `teams/team_aliases.json` | 队名别名资产 |

源码使用严格 TypeScript，由 Node 24 原生执行；公开 `.js` 子路径通过 package exports 映射到唯一的 `.ts` 实现，无第二套 JS 实现或编译产物。包根、子路径与源码入口使用同一份插件状态。

运行依赖仅为 `@changmen/shared`。本包不导入数据库、HTTP、resolver 或应用实现；ID 分配所需读写通过 `ClientMatchIdentityAdapter` 注入，队伍映射通过 `TeamPlugin` 注入。现有插件对象与函数两种形式均保留。历史 `canonicalMatchKey` 映射桥只向插件传递四个参数，本轮类型迁移保持该行为。

从仓库根运行：

```text
npm run typecheck --workspace=@changmen/match-identity
npm run test --workspace=@changmen/match-identity
npm run check:change
```

测试覆盖原身份规则、严格类型的正确与错误消费者、原生 Node 公共入口、插件单例、后端制品/版本指纹和前端安装隔离。包内测试与类型夹具不进入生产归档；后端回归通过 workspace 依赖自动执行本包检查。
