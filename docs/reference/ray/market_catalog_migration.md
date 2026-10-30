# RAY 场馆盘口目录

运行规则的后续迁移目标是 `packages/shared/catalog/venues/ray.ts`，公共入口为
`@changmen/shared/catalog/venues/ray`。该模块无浏览器、网络或存储依赖，可双端复用。
当前状态为 `staged`：现有采集、合场和下单继续使用旧 catalog，本次只新增可执行规则及测试。

## 文件职责

- `protocol`：官网的 61 个阶段标签、tag 形态、显示状态及分组身份。阶段原码完整保留。
- `definitions`：已确认的组身份及业务含义，包括旧独赢白名单和本次观察到的全部 22 个篮球组。
- `legacySelection`：原有 RAY 独赢采集范围及名称回退规则，不随识别能力扩展而自动放开采集。
- `settlement`：明确当前没有验证完整结算规则，消费者不能据此自动认定跨场馆可对冲。

`tag=win` 不自动归为 `match_winner`，`tag=ou` 不自动归为比赛总分。
语义定义按项目 ID、组 ID、原始阶段及 tag 联合匹配。未知组的原始字段和选项仍完整保留，
统一业务码返回 null，后续根据证据增加定义。
未将采样得到的 1,079 个组代码全部写死：它们属于观察样本，官网由 API 动态提供这些元数据。
足球等未补业务定义的项目目前只有通用结构解析，不能认为已完成对冲盘口映射。

## 使用

```ts
import { describeRayOdd, groupRayOdds, matchesRayLegacyWinner } from "@changmen/shared/catalog/venues/ray";

const context = { eventId: "38461945", gameId: "1072082", gameCode: "basketball" };
const description = describeRayOdd(rawOption, context);
const { groups, ungrouped } = groupRayOdds(rawOptions, context);
const selectedByOldPolicy = matchesRayLegacyWinner(rawOption, context.gameCode);
```

`description` 保留原始行，额外提供阶段、形态、明确业务定义及带方向的分数线。
`groupRayOdds` 按官网分组身份保留组内所有选项，不将多个让分线压成一对主客队。
`ahdp` 的比分前缀参与组身份；缺少比赛、项目、组或阶段身份的行放入 `ungrouped`。
该函数不执行分数线配对、状态过滤或订单处理。分数线解析失败时保留原文，数值为 null。

## 后续替换顺序

1. RAY 原始数据识别消费者改读新模块，先对照 `matchesRayLegacyWinner` 验证旧独赢范围一致。
2. 扩展存储和传输模型，保存原始阶段、目标对象、具体分数线及完整选项，避免旧 SaveBet 覆盖多线。
3. 为需要对冲的盘口补充结算证据、方向配对及 PM 对应关系，再显式启用。
4. 逐个迁移旧 RAY catalog 调用点，全部迁移后删除旧 JSON 中的 RAY 段。
5. 其他场馆分别建立自己的规则模块；所有消费者迁移完成后再删除整个旧 JSON。

旧 catalog 的独赢选择和新模块的严格语义识别刻意独立：旧兼容入口保留按组白名单及名称回退的行为；
新识别必须符合项目、阶段与 tag。不能用严格识别的结果默默改变旧采集策略。

官网来源、哈希、展示规则见 `frontend_market_rules.json`；API 组样本见
`docs/audits/2026-10-27-ray-cross-sport/group-codes.csv`。两者分别是官网代码证据和 API 观察证据。
