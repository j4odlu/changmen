# PM 数量和金额单位

[changmen 扩展] 数量单位在输入字段边界确定；不使用数值大小、小数点或订单大小推断。
共享解析入口为 `@changmen/shared/pm_amounts`。

| 来源 | 字段 | 输入单位 | 处理 |
| --- | --- | --- | --- |
| CLOB `GET /data/order/{id}` | `original_size`、`size_matched` | 已归一化份数 | 直接读取十进制数量 |
| CLOB `GET /data/trades` | `size`、`maker_orders[].matched_amount` | 已归一化份数 | 直接读取十进制数量 |
| CLOB `GET /builder/trades` | `size`、`sizeUsdc`、`feeUsdc`、`builderFee` | 已归一化份数或金额 | 直接读取十进制数量 |
| 原始 CLOB `POST /order` 回执 | `makingAmount`、`takingAmount` | 六位整数基本单位 | 固定除以 `1_000_000`，保留六位精度 |
| 签单请求 | `makerAmount`、`takerAmount` | 六位整数基本单位 | 固定转换；拒单本金使用 BUY 的 `makerAmount` |
| 本地订单/RDS、Data API 活动和持仓 | `pmShares`、`pmStakeUsdc` 等 | 既有归一化单位 | 不再次缩放 |

原始 POST 回执中，BUY 的 `makingAmount` 是抵押金额，`takingAmount` 是份数；SELL 相反。
GET 订单的已成交份数不因撤单而清空，也不能直接当作当前持仓余额。
费用和币种展示换算继续由各自模块处理；单位转换不进行四位小数的展示舍入。
GTC 已归一化成交事实直接进入普通 PM 共用的财务计算，不再借用原始 POST 回执字段传递份数。

提交日志的 `evidence.quantityUnit = "shares"` 标识已归一化的恢复证据。
原始 POST 回执在写日志前转换；GET/WS 核验结果直接标记份数，不能再次除以一百万。
买入和卖出恢复都只消费带标记的日志证据。旧日志可能来自 POST 或查询结果，缺标记时重新查询原单；
查询失败保持待确认及既有互斥状态，不删除日志、不猜单位、不自动重发。核验成功后再保存带标记的新证据。

解析失败沿用调用链的零值/缺值处理和原单查询，不新增重发、下单或数据维护动作。
本次仅修复后续解析，不推断或批量改写历史订单；历史原始响应若没有明确来源，不能按数值猜测后回填。

官方依据：

- [Get single order by ID](https://docs.polymarket.com/api-reference/trade/get-single-order-by-id)：`original_size` 已归一化，明确不要除以 1e6；`size_matched` 也是份数。
- [Manage Orders](https://docs.polymarket.com/trading/manage-orders)：账户和 Builder 成交的 SDK/原始 CLOB 示例使用十进制份数及金额。
- [Post a new order](https://docs.polymarket.com/api-reference/trade/post-a-new-order)：`makingAmount` 和 `takingAmount` 明确使用六位 fixed-math 单位。
- [Protocol V2 contract migration](https://docs.polymarket.com/migrate/polymarket-v2/contract-integrations)：链上 `amount` 使用六位整数基本单位，与已归一化查询结果分开。

`Get trades` 参考页存在较大的整数字符串示例，该示例没有提供“按大小换单位”的规则。
若未来接口版本更换单位，应在对应运输/适配入口显式转换，并更新契约与样本测试。
