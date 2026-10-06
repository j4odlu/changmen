# PM C 行历史价

[changmen 扩展] C 行采用 PM market.gameStartTime 前 1 秒的历史观测，不表示实际开赛清单时刻。

`polymarket-sports` VPS 进程每分钟独立轮询已关联 PM 比赛，先查询 Gamma 确认各盘口的登记开赛时间，再查询 Data API `/v2/prices-history?token_id=...&as_of=...`。全场及各地图胜负盘口按各自 token 获取，最多 4 个历史请求并发；轮询不会重叠，也不阻塞 Sports 实时状态循环。

结果持久化到 RDS `pm_prematch_prices`，以 `(token_id, cutoff)` 为主键。登记时间改变后保存新截止点，旧截止点的版本保留。成功结果 10 分钟后复查，待开赛、缺值和错误每分钟重试；待开赛结果到达登记开赛时间后重新取价。请求失败或历史接口暂时返回空数据时保留同截止点已经确认的价格，记录 `lastErrorAt` 并在一分钟后重试。价格 0、1 有效，空值、越界价和晚于截止点的观测无效。

后端 `Client_GetMatchs` 批量读取已存 token 快照，通过 `PmPrematch` 字段下发。浏览器 C 行仅按 token 对齐主客并展示，不再访问 Gamma/Data API、维护查询计时器或可视区轮询。客户端比赛列表原有 30 秒更新周期负责刷新 C 行。

部署顺序：更新 DB 模块和 collector，重启 `polymarket-sports`（启动时幂等建表），确认 `[pm-prematch] saved` 日志；更新后端并重启 `changmen-esport`；构建并发布前端。未启动新 collector 时前端显示“等待 VPS 历史价”，不会回退浏览器查询。RDS 只新增独立表，不更改已有比赛、订单或账号表。
