# 第4张地图盘口一键关闭方案

[changmen 扩展] 2026-11-02。状态：已实施，`npm run check:change` 通过；生产发布统一由 GitHub Actions 执行。新按钮沿用现有行为：关闭自动下注，保留现有手动入口，地图进入 live 后自动恢复。

在首页“全部盘口”“全场胜负”旁增加“地图4”独立开关，统一控制所有比赛的第4张地图。匹配条件为 `bet.round === 4`，对应接口 `Bets.Map = 4`；不按列表第4行或盘口名称判断。开关覆盖当前及后续加载的比赛，不受搜索结果限制。

## 用户行为

| 场景 | 预期行为 |
| --- | --- |
| 默认状态 | 地图4独立关闭状态为 false，不额外限制盘口 |
| 点击“关 地图4” | 折叠所有非 live 的地图4，停止这些盘口的新一轮自动套利与正 EV 下单 |
| 地图4被总开关折叠 | 单行显示“总关”，不能通过单行开关解除；仍可点击现有“手动下注”展开赔率 |
| 手动下注 | 普通手动与 PM FOK 沿用现有可下单行为；PM 手动 GTC 保留现有 mute 检查，折叠生效时仍被阻止 |
| `match.liveRound === 4` | 自动解除该比赛地图4的折叠，显示原 live 计时；其他交易条件继续独立判断 |
| 已处理的地图4离开 live | 保留现有进入 live 后清除折叠的语义，不因 live 编号变化立即被本开关重新折叠；结束盘口仍由现有行情和赛事状态规则限制 |
| 点击“开 地图4” | 解除地图4独立限制，并清除地图4单行 mute；其他开关仍可能限制该盘口 |
| 刷新当前标签页 | 从 sessionStorage 恢复开关与 live 自动解除记录 |

状态按现有 sessionStorage 范围保存，不进入 USERCONFIG、后端或 RDS，不增加跨标签页同步。开关不撤销已发出的请求，不撤挂单或平仓，不停止既有补单、确认及收尾。现有自动套利在执行入口判断 mute，本期不扩展为取消正在预检的执行任务。

“沿用现有行为”以执行代码为准。[mapBetMute.ts](../client/web/src/extensions/mapBetMute/mapBetMute.ts) 中关于禁止手动新开仓的旧注释已同步修正，保留现有手动 FOK 行为。

## 开关优先级

保持 [isMapMuteActive](../client/web/src/extensions/mapBetMute/mapBetMute.ts) 为 UI、自动套利和正 EV 的统一判定入口，依次处理：

1. 当前 live 地图放行，非可折叠盘口放行。
2. 全场胜负独立开关继续只限制 round 0。
3. 地图4独立开关限制 round 4，已因 live 自动解除的比赛除外。
4. “全部盘口”按现有全局开关和单行展开例外处理。
5. 最后检查原单行 mute。

因此，“全部盘口”中的普通单行展开例外不能绕过生效中的地图4独立限制。地图4关闭时，其他地图及全场只受各自原有规则影响。

“开 全部盘口”继续清空原单行 mute 和原全局例外，但不关闭地图4或全场胜负的独立开关。“开 地图4”不解除“全部盘口”的限制；按钮提示需写明“其他总开关仍有效”。重新点击“关 地图4”时清空本开关上一次 live 自动解除记录，作为新的关闭周期；当前正在 live 的地图4仍然放行。

## 状态与接口

在现有 mapBetMute 模块中增加专用状态，不先建设任意地图配置系统。

| 新增项 | 用途 |
| --- | --- |
| `globalMuteMap4: Ref<boolean>` | 地图4独立开关，默认 false |
| `MapBetMuteMap4Global` | sessionStorage 标志，沿用 `1` 表示开启 |
| `map4LiveOpenKeys: Ref<Set<string>>` | 本次关闭周期中因 live 自动解除的 `matchId:4` |
| `MapBetMuteMap4LiveOpen` | 持久化上述 live 记录，沿用已有 key-set 读写方式 |
| `mapBetMuteMap4Global`、`isMap4MuteGlobal` | UI 订阅与非 UI 读取开关状态 |
| `setMap4MuteGlobal`、`toggleMap4MuteGlobal` | 设置与切换状态，负责相应清理 |

live 解除记录单独保存，避免“全部盘口”清空自身例外时意外改变地图4的恢复状态；它仅由 live 自动清理产生，不作为任意单行展开例外。

扩展 `ensureMapBetMuteLoaded` 和测试重置函数，覆盖两项新 session 键。关闭地图4独立开关时清除本开关的 live 记录，并仅移除原单行 mute 中以 `:4` 结尾的项；保留其他地图 mute 与原全局展开例外。

`clearMapMute(matchId, round)` 在 round 4 且地图4独立开关开启时，额外登记 live 自动解除，原清理行为继续执行。BetRow 挂载、进入地图4 live，以及“已在 live 时开启新开关”都要触发登记；不能只监听 live 布尔值变化，否则第三种情况会漏掉。`isMapMuteActive` 保持只读，不在自动下注判断中写入 session。

地图4独立限制是否实际生效应由模块提供共用判断，供 `toggleMapMute` 和 BetRow 使用，避免 UI 根据开关布尔值误把已自动恢复的行仍显示为“总关”。

## 文件改动

| 文件 | 计划改动 |
| --- | --- |
| [mapBetMute.ts](../client/web/src/extensions/mapBetMute/mapBetMute.ts) | 新增状态、session 恢复、setter、统一判定、live 清理及单行切换保护；修正旧注释 |
| [index.ts](../client/web/src/extensions/mapBetMute/index.ts) | 导出必要状态与接口，更新模块说明 |
| [HomeView.vue](../client/web/src/views/HomeView.vue) | 在全场胜负按钮旁增加地图4按钮，复用样式、aria-pressed 与开关展示方式 |
| [BetRow.vue](../client/web/src/components/match/BetRow.vue) | 订阅新状态与 live 解除记录，增加“总关”原因及单行保护，覆盖已 live 时启用开关的登记 |
| 相关现有测试文件 | 补充状态交互、UI 响应式和交易入口用例 |

首页按钮无独立限制时显示“关 地图4”，有限制时显示“开 地图4”。开启提示说明“折叠地图4并关闭自动下注；进入 live 自动恢复，仍可手动展开”；恢复提示说明“解除地图4独立限制；其他总开关仍有效”。live 行继续展示计时，不显示一个看似能关闭当前 live 地图的按钮。

[executeArbBet.ts](../client/web/src/stores/betting/autoBet/executeArbBet.ts)、[valueBetAutoBet.ts](../client/web/src/extensions/valueBet/valueBetAutoBet.ts) 和 [placeValueBet.ts](../client/web/src/stores/betting/placeValueBet.ts) 已使用统一 mute 判断，功能优先通过状态模块接入，交易执行实现不增加地图4专用分支。正 EV 原有预检后复核继续生效；手动 FOK 与 GTC 差异继续保留。

## 验收用例

| 验证范围 | 必须覆盖 |
| --- | --- |
| 定向关闭 | 至少两场比赛的 round 4 同时关闭，后加载的比赛同样生效；round -1、0、1、2、3、5 不增加限制 |
| 恢复与存储 | 默认关闭、双向切换、session 重载、存储不可用、重置函数；恢复只清地图4单行 mute |
| live 生命周期 | 未 live 时关闭，进入 live 后放行并登记，离开 live 后保持本开关解除；刷新保留记录；已 live 时开启及挂载时已 live 均正确 |
| 重启关闭周期 | 关闭再开启时旧 live 记录被清空；当前 live 地图仍放行并重新登记 |
| 开关叠加 | 全场胜负与地图4互不影响；“全部盘口”的普通展开例外不能绕过地图4；两种恢复操作各自保留另一总开关及其状态 |
| 单行与 UI | 无需赔率 tick 即响应新开关；受独立限制时显示“总关”且不能单行解除；live 恢复后的行不残留“总关” |
| 自动套利 | 地图4受限时不进入 prepare，恢复或 live 时可继续原流程；其他地图照常，不改变 PM FOK 执行选择 |
| 正 EV | 自动候选排除受限地图4；预检期间开启地图4限制后，现有提交前复核能拦截；其他地图照常 |
| 手动入口 | 折叠后能展开赔率；普通手动和 PM FOK 保持可用，PM 手动 GTC 仍遵守原 mute 检查；自动与 target 点选限制不因展开赔率而解除 |

优先扩展现有 `mapBetMute.test.ts`、`BetRow.pmQuote.test.ts`、`executeArbBet.test.ts`、`manualBet.sync.test.ts`、`valueBetAutoBet.test.ts` 和 `placeValueBet.test.ts`。HomeView 按钮验证使用实际组件或现有组件测试方式，检查点击、文案和 aria 状态，避免仅通过源码字符串断言证明交互。

## 实施与验证顺序

1. 完成状态、session 与开关交互，先验证地图4定向关闭和 live 恢复规则。
2. 接入 HomeView 和 BetRow，补齐响应式订阅、“总关”展示与已有 live 行登记。
3. 验证自动套利、正 EV、手动 FOK/GTC 入口及总开关组合。
4. 按实际改动运行 `npm run check:change:plan` 和 `npm run check:change`，执行前端所属模块回归与构建。构建已包含类型检查，不重复串联 typecheck；不因普通业务改动追加验证器自测或完整历史 FOK 专项。

当前工作区已有其他任务改动。实施与验收需记录本功能实际文件范围及检查覆盖，不清理、覆盖或提交其他任务内容；验证器默认读取整个工作区变化时，按真实计划报告覆盖范围，不将无关改动的检查结果归为地图4功能交付。

## 本地验收结果

2026-11-02 已完成状态模块、首页按钮与盘口行接入，并扩展上述测试及 `HomeView.manual.test.ts`。统一检查第二轮通过：路由编译、后端回归、前端回归与生产构建全部通过，`sourceStable = true`；前端 607 个测试文件、6534 项测试通过，另有原有 3 个文件、4 项测试跳过。首轮所有子项通过，但检查期间源码变化使整体结果未通过，第二轮未再发生输入变化。

回退时移除新按钮、状态与判定分支，原 session 键及原总开关协议不迁移。
