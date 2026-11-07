# PM 价格审查问题修复（2026-11-07）

[changmen 扩展] 本报告记录对[发布前审查](./TODAY_CHANGES_PREDEPLOY_REVIEW_20261107.md)中 F1、F2 的本机修复。旧审查报告保留原始失败证据；本报告说明后续状态。没有 commit、push、部署或数据库维护操作。用户暂缓的时钟排序问题继续暂缓。

## 1. 修复内容

### F1 / R1：切回转发遗漏同版本目录初始化

`markets/collect.ts` 将目录版本和来源模式共同用于去重，并监听来源变化，立即按当前来源重新应用已经获得的目录，不额外发送 HTTP 请求。官方直连继续只取映射；手动切回转发及自动回退都恢复转发原有的目录初值。同版本、同来源的后续轮询不重复初始化。

采集器停止时解除来源、行情及空盘监听，并忽略停止后返回的目录请求，避免会话结束后写入缓存。

### F2 / R2：空卖盘保留旧可买价

完整 `book.asks=[]` 现在会产生明确的无卖盘更新；缺失 `asks` 字段仍被视为没有此项更新。行情总线将显式空盘及现有价格范围之外的边界值 0、1，经过原有时序检查后，通过独立的 `onPolymarketMarketAskUnavailable` 接口通知消费者。

采集器只把对应 token 写为 `clobPrice=0`、`odds=0`、`isLock=true`、`pmQuoteSource=ws`。这里的 0 是应用内部的无可买价状态，不是可成交价格；不会写入对侧。普通 `onPolymarketMarketQuote` 接口仍只发送有效价格，价格趋势和信号监听接口的原契约保留。后续有效行情自动解除本侧锁定。

`oddsStore` 阻止目录种子覆盖已经收到的 WS 状态，包括锁定状态及缓存重建保留的快照。因此目录刷新、切源重新初始化均不能复活空盘前的旧价。

本轮修复范围是当前电竞主行情总线及其 fo 缓存。共享解析器补充空盘输出；独立体育总线仍按其原有规则过滤不可买价格，没有在本轮迁移其业务缓存。

### H1：文件末尾空行

清理 `orderListPresentation.ts` 多余的文件末尾空行；该文件已与 HEAD 一致，没有加入运行改动。

## 2. 协议与业务边界

重新查阅 [PM Real-Time Data](https://docs.polymarket.com/market-data/realtime-data)：区分完整 book 的 asks 数组和增量消息中可选的 best ask 字段，并保留交易所时间戳的原有门控。本轮没有将缺失字段当作空卖盘，也没有用成交价、买一或对侧推导买入卖一。

边界值 1 按 CHANGMEN 原有 `0 < price < 1` 的可买价规则处理为不可买；不据此断言官方所有事件都使用 1 作为唯一空盘标记。

没有升级 SDK、替换 transport、改变首次全量及后续差集订阅、修改下单限价/金额、调整 FOK/GTC 执行规则，或变更 VPS 下发。

## 3. 回归与验证

先在实际 collector、transport、生产桥接和 Pinia 上加入正式回归，修复前复现 4 项失败：切源初始化一项、三类空盘消息各一项。修复后针对性回归 17 个文件、120 项全部通过，包括：

- 手动切源、实际自动回退、同版本不重复初始化，以及新 WS 价格不被目录种子覆盖。
- 空 book、price_change 边界卖价、best_bid_ask 边界卖价只使本侧失效。
- 缓存重建、切源、目录刷新之后空盘状态仍有效，新卖一到达后恢复。
- 缺失字段、空字符串、非数字、越界值、较旧空盘不清除较新有效价格。
- 普通有效价格监听器不收到无价事件，空盘监听可独立注销。

完整变更验证 `npm run check:change` 最终通过：router-compile、backend、frontend、build 均成功，验证器记录 `passed=true`、`sourceStable=true`。前端合计 7,959 项通过、4 项跳过（web 7,618、listener live 76、listener compat 265）；构建包含前端类型检查。`git diff --check` 通过。

最终检查结束于 2026-11-06T20:00:33.051Z（UTC）；本机基线 HEAD 为 `c92d5ff7e8377996f512e5ce1a104dd2a6bdcaf8`，输入指纹为 `a84c3e60f94577aab967daeae52d1d3b645775da48ae7b44e2207e4346382c9b`。这是未提交工作区的完整变更验证，`completeRelease=false`；尚未进行正式提交候选的发布验收和生产健康检查。

首次完整检查在 `collect.test.ts` 的旧源码断言处失败：它要求所有 WS 写入均为 `locked:false`，没有表达空卖盘锁定本侧的新行为。已将该契约改为只在本侧价格为 0 时锁定，继续禁止根据另一侧的盘口状态锁定有价侧；实际有价解锁、空盘锁定由上述集成测试覆盖。更新后该文件和集成测试合计 27 项通过，再次执行完整变更检查。首次失败记录保留，不改写为通过。

本机日志保存在 `output/today-predeploy-review/fix-targeted.log`、`fix-plan.log`、`fix-check-change.log`、`fix-validation-first.json`、`fix-check-change-final.log` 和 `fix-validation.json`；原审计失败记录仍保留。

## 4. 冻结门禁及发布状态

F3 是仓库发布保护规则，不是应删除的业务缺陷。本轮涉及已审查的 PM hub/collector/oddsStore 冻结路径，按 AGENTS.md 的既有流程单次设置 `ALLOW_ESPORT_TOUCH=1` 运行本机完整业务检查，完成后恢复环境；没有修改冻结清单、基线或 workflow。

普通 push 仍不会自动放行冻结路径。之后若明确授权发布，须按[独立发布规则](../INDEPENDENT_DEPLOYMENT.md)使用现有手动发布入口并显式选择 `allow_esport_touch`，绑定实际提交候选并完成其余发布验收。本轮未执行该操作，不把本机测试通过表述为生产发布已验收。
