# 订单列表的展示与控制边界

PM/PF 结算规则、保存和报表之间的依赖及独立测试入口见 [结算与盈亏依赖审计](./PREDICTION_SETTLEMENT_BOUNDARIES.md)。独立套件不代替日常与发布检查。

现有未提交文件的归属、混合声明、订单列表相关改动及实际验证范围见 [订单列表交付复核](./ORDER_LIST_DELIVERY_REVIEW.md)。

[changmen 扩展] 2026-11-05。此文描述当前已落地的订单列表分层；交易服务及结算规则继续复用既有实现。

| 层 | 入口（相对 `client/web/src/`） | 职责 |
|---|---|---|
| 页面组装 | `components/order/OrderList.vue` | 保持原 props、插槽及 emit；组装分组、行、按钮和展示组件 |
| 被动展示 | `components/order/presentation/` | 六个明确登记的组件：金额盈亏、价格份额、赛事盘口、状态角标、标签、实时价格；只收字符串和显示标记 |
| 行情控制 | `components/order/controllers/useOrderListLiveQuotes.ts` | setup 同步订阅 fo/体育行情，只跟踪当前列表相关 token；原价格来源优先级、可见条件及浮盈计算调用保持一致；卸载释放订阅 |
| 操作控制 | `components/order/controllers/useOrderListActions.ts` | 卖出按钮资格、卖出中状态、调用既有 PM/PF 卖出服务、取消补单确认后通知宿主 |
| 改绑控制 | `components/order/controllers/useOrderLinkRebind.ts` | 指针、连线、目标资格、新 Link → 老 Link、确认对话框、原 API 调用及成功事件；取消/卸载清理资源 |
| 标签加载 | `components/order/controllers/useOrderListLabels.ts` | 原 PF MarketIndex 异步加载、加载成功刷新标签、跨组 positionEvents 观察 |
| 显示数据准备 | `components/order/orderListPresentation.ts` | 原选项标签、待结算显示条件、金额标签；不执行下单或结算 |
| PM/PF 行显示模型 | `components/order/orderListPredictionPresentation.ts` | 将原金额、份额、提交/成交报价、盈亏及行情读数组装成买/卖显示模型；父级按模型展示，继续调用既有计算函数 |
| 交易服务 | `stores/account/pmManualSell.ts`、`pfManualSell.ts` | 原授权、持仓、确认及订单执行流程；页面控制只调用这些服务 |
| 金额/结算规则 | 既有 `shared/pmOrderDisplay.ts`、`pfOrderDisplay.ts` 及共享包规则 | 继续作为原有金额显示、兑付和盈亏规则的入口；展示组件不复制算法 |

## 保持的行为

- `OrderListEntry` 仍从 `OrderList.vue` 导出，现有调用者不需要改入口。类型定义存于 `orderListTypes.ts`。
- 页面 props、`cancelMakeup` / `linkRebindDone` 事件、金额/行/组插槽保持原契约。
- 原有 PM 非真实订单卖出限制、PF 卖出资格、处理中角标及错误传播继续生效；拆分不重写交易服务。
- PM 50/50 标签与订单实际盈亏角标保持分离，显示组件不根据标签重新推断盈亏。
- PF 的普通文字仍转义；原赛事/盘口富文本由父级通过插槽提供。纯展示组件中不放 `v-html`。
- 实时行情保持 fo 优先、体育报价回退，既有盘口锁定和生命周期显示条件不变；展示只读行情缓存。
- 改绑仍先确认再调用 API，API 成功后才发出完成事件；失败、取消、无效目标不发出成功事件。
- PM/PF 共用展示结构，但按钮仍分别调用原 PM/PF 操作控制。`buy-amount` 插槽只覆盖原 PM 买单金额，PF 金额继续使用原币种换算。
- 显示模型不写 `Money`、`Status` 或持仓字段，不根据浮盈或 50/50 标签重算已结算盈亏。GTC 缺失成交信息时的赔率可见条件保持原规则。

## 验证范围

日常仍使用根目录 `npm run check:change`，`check:change:plan` 预览。六个组件和两个直接展示测试由 `scripts/verification/presentation-policy.mjs` 显式登记；新增文件不会自动加入。任何控制模块、显示模型/数据准备、父级组装、交易或共享规则改动继续运行完整前端回归及含类型检查的生产构建。

纯展示改动固定运行组件测试和父级集成测试，仍保留边界/契约检查与生产构建。组件解析门禁拒绝业务依赖、函数调用、事件、主动指令及外部样式输入。七个固定测试文件的存在性统一由日常公共边界入口检查；即使删除父级测试后计划改走完整前端回归，也会明确失败。

控制模块测试使用真实 Vue 挂载/卸载生命周期，交易与改绑的外部服务使用 mock，不向真实账号提交操作。覆盖权限、DisplayOnly、成交生命周期、行情优先级、相关 token 更新、订阅释放、异步标签、确认前不写入、错误/取消不报成功、指针与 Escape 清理。

2026-11-06 的复核新增 `OrderList.runtime.test.ts`：编译实际客户端模板，用 Vue renderer 验证同一组件内 Pending → 成交 → 50/50 结算、现价与浮盈变化、PM/PF 按钮权限和处理中状态、原卖出服务调用及确认后的补单取消事件。它加入固定展示集成测试；改动该集成测试自身仍选择完整前端回归。PM/PF 显示模型另测金额换算、实际盈亏、GTC 缺失成交、卖单不读取实时价以及只读字段。

这次结构调整本身必须完整验证。后续只有满足同一边界的被动展示调整才使用轻量测试；控制或算法改动不借目录移动减少检查。
