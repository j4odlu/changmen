# PM 行情观察流职责迁移

日期：2026-10-19；基于 master 的现有未提交拆包改动继续推进。

[changmen 扩展] 本轮将行情观察流的唯一实现迁至 client/packages/venue-browser/polymarket/marketStream.ts。职责是维护连接状态、帧序号与观察者通知；不创建网络连接、订阅、定时器或行情缓存。

## 实际源码调整

- 原 packages/venue-adapter/polymarket/realtime/marketStream.ts 只转出新包实现。
- realtime/ws.ts、realtime/orderBook/service.ts 和 browser/pm-book-source-host.ts 三个运行时消费者直接使用 @changmen/venue-browser/polymarket/marketStream。
- 协议类型直接从 @changmen/pm-market-data-browser/marketStreamProtocol 导入，旧协议类型转出入口保留。
- venue-browser 增加一个明确子路径导出，现有 20 个；依赖、锁文件和 files 范围没有因本轮改变，也没有引入旧 adapter 反向依赖。

迁出的完整实现仅更换类型 import，所有函数体、初始状态和变量均与 Git 基线 3126c8de0462aaca96b96be432618fd852285755 一致。三个消费者仅更换 import，语句及导入顺序不变。

状态仍是一个模块实例：旧入口和包入口共享同一个 state、sequence 和 observers 集合。四个观察者上限、注册时立即通知、异常移除、过期连接过滤、PONG 过滤、重连序号重置、取消订阅，以及无观察者时不读取时钟的行为均保持原样。

网络连接、订阅管理、报价写入、订单簿授权和下单业务逻辑没有修改。本轮未调整 CI、部署流程或生产数据库。

## 验证

| 项目 | 结果 |
| --- | --- |
| 观察流、行情宿主、订单簿服务针对性回归 | 5 文件、44 项通过 |
| 累计完整源码及边界回归最终复验 | 111 文件、2,746 项通过 |
| test:checks | 边界、导出、契约、冻结检查和 24 步 catalog smoke 通过 |
| 完整前端回归 | 529 文件、4,825 项通过；原有 3 文件、4 项跳过 |
| 独立前端安装、类型检查与生产构建 | 9 个 workspace、9 个源码目录、不含 server，全部通过 |
| npm pack --dry-run | 22 个文件、20 个导出全部包含 |
| git diff --check | 通过 |

上述测试组有重叠，不累计总数。运行时回归包含新旧入口状态共享、帧顺序、故障观察者清理，以及真实连接逻辑的模拟回放：观察开启/关闭时连接数、订阅、报价、心跳与重连轨迹一致。

已有源码保护继续沿用固定基线；增加本轮精确迁移记录后，先还原本轮位置/导入调整，再执行既有验证。首次检查遇到两处历史负例适配问题：旧 import 片段不再匹配，以及篡改在更早位置被拦截导致报错断言变化。已修正样例和精确断言，保留篡改拒绝要求，最终完整复验通过。

日志：output/venue-browser-stream-20261019/。独立构建仍有原有大 chunk 和静态/动态导入重叠提示。未执行真实账号、下单或线上操作；未 commit、push 或部署。

本轮完成的是行情观察职责的真实目录与依赖隔离。剩余网络传输、订阅管理和报价写入仍在 adapter，应在后续按依赖关系分组处理，保持每轮可独立验证。
