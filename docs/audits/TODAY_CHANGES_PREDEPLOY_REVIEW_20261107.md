# 2026-11-07 待提交改动与发布就绪检查

后续状态：用户已要求修复，F1、F2 的运行修复及验证见[修复报告](./PM_PRICE_REVIEW_FIXES_20261107.md)。本文保留修复前的审查结论和失败证据，不代表后续代码仍未修复。

[changmen 扩展] 本轮按用户要求检查当前待提交改动，判断是否可以 commit、push 并部署。没有修改业务运行代码，没有执行数据库维护，没有 commit、push 或部署。时钟/迟到 HTTP 的修复仍按用户要求暂缓。

## 1. 发布结论

**不建议将当前工作区直接整体 push 并部署。** 代码检查通过并不代表已知缺陷消失，也不代表默认发布门禁可通过。当前有本次新增的切源兼容遗漏、原有空卖盘旧价缺陷，以及默认冻结面检查失败。

本轮检查输入是 master、HEAD `c92d5ff7e` 之后当前工作区的 67 个路径，包含本对话的价格链路，以及手续费旁显、Chrome 扩展构建、RDS 管理/维护工具和多份文档。Git 本身不能证明每个未提交文件都在今天首次修改，因此本报告以实际待提交集合为范围；不能把全部文件都归为本对话改动。

## 2. 缺陷与发布阻碍

### F1 [P2，本次遗漏] 官方切回转发，同版本目录不补初值

位置：[collect.ts](../../client/packages/venue-browser/polymarket/markets/collect.ts#L236)。

官方初始化按新设计只读映射；切回转发后若目录 updatedAt 未变，来源判断之前的版本短路会提前返回。即使完成一轮 30 秒轮询，转发仍没有它原先可使用的目录初值，直到新 WS 报价或目录更新才恢复。不是每次切换必然复现，转发及时返回 book 时会掩盖该遗漏。

本轮重新运行实际 collector、transport、生产桥接和 Pinia 的审计用例：目录提供 0.28、来源已切 changmen、转发已发送完整订阅，但缓存仍为 undefined、显示为 0，对“恢复转发初值”的断言失败。建议提交运行改动前修复并补正式回归；无需改 VPS。

### F2 [P1，原有缺陷] 明确空卖盘仍显示旧价

位置：[wsQuotes.ts](../../client/packages/venue-browser/polymarket/wsQuotes.ts#L79)、[marketQuoteHub.ts](../../client/packages/venue-browser/polymarket/marketQuoteHub.ts#L104)。

本轮再次复现两条序列：有效卖一 0.35 后收到 asks=[]；有效卖一 0.35 后收到 best_ask=1。两条序列都仍读取出旧 0.35 和赔率 2.857，而不是使旧可买价失效。

空 asks 被解析器过滤，边界值 1 被 hub 过滤，都没有向缓存传播失效。它会影响报价展示与机会扫描，可能造成后续预检拦截；没有证据断定最初截图的订单就是由此导致。相关过滤逻辑不是本次新增，须与新增回归分开报告，但也不能把本次改动称为已完成所有实时价格正确性修复。

### F3 [发布门禁] 普通 push 不放行本次冻结路径

实际运行默认冻结检查失败，命中：

- client/packages/client-core/src/bridge/oddsAccess.ts
- client/packages/venue-browser/polymarket/markets/collect.ts
- client/web/src/stores/oddsStore.ts

依据：[冻结检查实现](../../devtools/venue-adapter/verification/check-esport-freeze.mjs)、[release workflow](../../.github/workflows/release.yml#L98)、[独立发布规则](../INDEPENDENT_DEPLOYMENT.md)。当前 workflow 仅在手动发布且显式选择 allow_esport_touch 时设 ALLOW_ESPORT_TOUCH=1；普通 push 设置为 0。

本机完整业务检查是在核对本次冻结路径后单次设置 ALLOW_ESPORT_TOUCH=1 执行，结束后恢复环境。它不是普通 push 已获发布放行；没有修改冻结基线、清单或 workflow。后续须按仓库既有冻结面发布流程处理，不能为了发布绕过门禁。

### K1 [用户暂缓] 报价时钟与迟到请求

本机时间和交易所时间混用仍存在；本轮未改此逻辑，也不把它列为本次新增回归。用户已要求暂缓，不因发布检查自行恢复实施。

### H1 [非运行问题] 文件末尾空行

`git diff --check` 在 client/web/src/components/order/orderListPresentation.ts 第 38 行报告 new blank line at EOF。该文件仅有空行差异；未改动它，避免混入与当前检查无关的编辑。提交整理时可清理或排除，不将其当作运行缺陷。

## 3. 其他范围的检查结论

- 订阅报文仍符合此前核对的 PM 官方格式；当前主行情还是 CHANGMEN 自建 transport，SDK 接管未实施，项目依赖没有从 0.12 升到 0.17。
- 手续费旁显默认关闭，使用独立缓存、同盘口合并请求和并发上限，异步结果检查组件是否仍对应原盘口。当前改动未向交易侧写回旁显数值；核对官方 fee=C×rate×p×(1-p) 与现有单位含费成本折算，未新增确认另一个业务缺陷。公式来源：[PM Fees](https://docs.polymarket.com/trading/fees)。
- 扩展构建改为 storage workspace 公共入口，package/lock 一致；其配置单测及扩展 smoke 检查通过。
- RDS 新增历史读取在 READ ONLY 快照中运行；两份维修脚本为显式 CLI 入口、默认只读，写入模式要求备份并核对未改字段。未发现其被启动/部署自动调用；本轮只执行离线测试，没有运行 apply 或生产 SQL。
- PM 页面读取范围修复保留，比分字段不决定报价缓存；现有冻结 cap/金额、FOK/GTC 提交行为没有本次审查新增编辑。
- 多份审计/方案文档中的未实施状态保留；文档 JSON 凭证样式字段扫描未发现疑似凭据。该扫描是有限模式检查，不称为完整安全审计。

## 4. 本轮验证

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run check:change` | 通过 | full 计划；router-compile、backend、frontend、build 全部成功；本次显式设置 `ALLOW_ESPORT_TOUCH=1`，完成后恢复环境 |
| 前端既有回归 | 7,951 项通过，4 项跳过 | web 与 listener 两套回归合计 |
| 前端构建及类型检查 | 通过 | `app:build` 包含类型检查 |
| 后端及数据层回归 | 通过 | 包含本轮 RDS 读取/维护工具离线测试；没有执行实际维护 |
| 扩展独立验证 | 通过 | 31 项 Node 测试及配置、凭证等 smoke 检查 |
| 已知缺陷专项复现 | 1 项通过、3 项失败 | F1 一项、F2 两项仍失败，见下文 |
| 默认冻结检查 | 失败 | `ALLOW_ESPORT_TOUCH=0`，命中三条冻结路径 |
| `git diff --check` | 失败 | H1：文件末尾新增空行；无运行影响 |

本次完整检查结束于 2026-11-07 03:38:29（Asia/Taipei），验证器记录 `passed=true`、`sourceStable=true`。验证基线 HEAD 为 `c92d5ff7e8377996f512e5ce1a104dd2a6bdcaf8`，候选树为 `482aa9fec95f9004f35e493df6c5459bfb44416a`。这是工作区变更检查，`completeRelease=false`，尚未完成绑定正式提交的发布验收、生产健康检查。本报告及索引为检查完成后追加的纯文档，不改变上述已验证运行代码。

既有回归与缺陷复现分别报告：审计用例选中 4 项，1 项通过、3 项失败（F1 一项、F2 两项）；复制的 14 项既有测试因筛选未执行。它们有真实失败证据，不能因主门禁通过而删除或忽略。

本机日志位于 `output/today-predeploy-review/`：plan.json、check-change.log、known-defects.json/log、default-freeze.log、extension-tests.log、validation.json 和 summary.json。该目录被忽略，不构成已发布制品。

## 5. 提交与部署边界

本地 commit、远端 push 和部署是不同动作。当前可以保留供审阅的工作区/本地候选，但不应把“已能提交”表述为“可以直接发布”。当前尚未形成暂存候选；master push 会触发自动发布，本轮没有执行。

建议先修新增切源遗漏；空盘问题单独确定修复范围并验证，保持时钟项暂缓。随后按实际提交集合重新绑定候选与计划，通过既有发布门禁，再进行已明确授权的发布。RDS 维护脚本不随应用发布自动执行。本轮检查结果不构成执行数据库维护的授权。
