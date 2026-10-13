# 最小 PM 订单：生产工具执行顺序

[changmen 扩展] 工具已在本机实现；本轮只在独立、有标记的本机测试库演练。这里的命令供后续单独授权的操作使用，不代表已经执行或获准执行生产操作。

代码先部署且两个兼容开关均为 0，再独立安装结构；确认所有连接同一数据库的消费者兼容，才启用最小模式并迁入历史订单。`pm_gtc_executions` 全程为唯一执行来源，不执行旧完整并表脚本、不撤表，不改原字段、原财务值或通知规则。

## 连接与人工确认

`node scripts/migrations/pm-orders-minimal/production.mjs` 默认仅输出说明，不读取数据库 URL、不连接数据库。所有实际操作都需要显式 `--execute --config <文件> --out <全新目录>`，不能复用输出目录。工具不加载 dotenv，不读取 DATABASE_URL，禁止 URL 查询参数覆盖 SSL/选项，TLS 必须校验证书。

连接配置由操作人员事先只读核对后填写，勿把凭证写入或提交仓库：

```json
{
  "version": 1,
  "urlEnv": "PM_MIGRATION_URL",
  "tlsCaFile": "/absolute/path/to/verified-rds-ca.pem",
  "expectedTarget": {
    "database": "填写已核对库名",
    "role": "填写已核对角色",
    "address": "填写数据库返回的实际服务器地址",
    "port": 5432
  }
}
```

URL 由指定环境变量提供，客户端连接后再校验数据库/角色/服务器地址/端口与预期一致。错误输出不包含 URL 或密码。RDS 地址变化时停止并重新核对，不自动放宽身份检查。

`consumers.json` 是人工检查声明：确认 VPS 服务、维护/定时脚本及连接同库的本地进程，而非工具自动发现全部消费者。`target` 必须逐项等于连接配置 `expectedTarget`。

```json
{
  "target": {"database":"填写已核对库名","role":"填写已核对角色","address":"填写实际服务器地址","port":5432},
  "allConsumersCompatible": true,
  "oldExecutionSource": "pm_gtc_executions",
  "legacyFlag": "0",
  "minimalFlag": "1",
  "projectionWritesPaused": true,
  "financialFilteringRetained": true
}
```

结构安装声明要求 `minimalFlag="0"`；历史回填或回退要求 `minimalFlag="1"`，且确认所有新投影 writer 已暂停、财务过滤仍在。暂停使用 `PM_ORDERS_MINIMAL_PROJECTION_WRITE=0`，它只暂停展示投影，保留原 facts、财务晋升和执行恢复。日常最小模式的投影写入默认允许；`PM_ORDERS_MINIMAL=0` 时新行为整体关闭。

## 增量安装

先生成只读结构计划，检查原七列、新对象是否已存在及 `sqlDigest`：

```text
node scripts/migrations/pm-orders-minimal/production.mjs --execute --command schema-plan --config connection.json --out schema-check-01
node scripts/migrations/pm-orders-minimal/production.mjs --execute --command schema-install --config connection.json --input schema-check-01/result.json --consumers consumers-flags-off.json --confirm <计划digest> --out schema-install-01
```

只添加模式/快照两列及财务视图、两个资格约束、validator；不添加索引或触发器。原七列须已存在且兼容，不自动修正它们。安装先取 NOWAIT 独占锁，原列定义/索引/约束/触发器须保持；已完整安装时只验证，不重复 DDL，部分安装或定义差异停止。约束扫描及短暂表锁仍需真实生产规模与时段核对，不能承诺零锁影响。schema 不提供自动 DROP 回退。

## 历史批次

每批显式给定一个 owner 和最多 25 个执行 UUID，`ids.json` 为数组。先 dry-run，报告可附加现有订单、缺行、跳过与冲突；任何冲突使整批不能执行，不猜测合并：

```text
node scripts/migrations/pm-orders-minimal/production.mjs --execute --command batch-plan --config connection.json --owner <owner UUID> --ids ids.json --out batch-check-01
node scripts/migrations/pm-orders-minimal/production.mjs --execute --command batch-apply --config connection.json --input batch-check-01/result.json --consumers consumers-paused.json --confirm <计划digest> --out batch-apply-01
```

计划使用 READ ONLY REPEATABLE READ。旧源仅受理、首单关闭且身份一致的记录可迁入；unknown/prepared/rejected 和首单开放状态跳过。现有行只补执行关联、模式和小型显示快照，不动原 id/拼写/raw/金额/时间及原七列完整副本；缺行才建非财务 GTC，不触发首次入库通知。回执不复制原 plan、fills、授权或完整 record，仅保存来源摘要、小投影、原元数据和目标摘要。

实际写入取原 UUID advisory/源行锁和短时 NOWAIT orders 写锁，防止缺行及大小写竞争，遇忙锁立即停止、不自动重试。每批一个事务，超时受限；提交前必须将不可覆盖的 prepared 回执持久写入文件，文件失败则回滚。按回执核验原财务统计、旧源和订单数量后才进行下一批。回填不是持续同步，也不重置旧执行时间或 counted。

## 回退与提交结果不确定

```text
node scripts/migrations/pm-orders-minimal/production.mjs --execute --command reconcile --config connection.json --input batch-apply-01/<批次UUID>.prepared.json --out reconcile-01
node scripts/migrations/pm-orders-minimal/production.mjs --execute --command batch-rollback --config connection.json --input batch-apply-01/<批次UUID>.prepared.json --consumers consumers-paused.json --confirm <回执digest> --out rollback-01
```

COMMIT、结果文件或网络失败后保留 prepared 回执，先只读 reconcile，不自动重放写入。它区分全部已提交、全部回滚及已变化状态；回退自身也有 prepared 回执，可用同一 reconcile 入口确认结果。

回退保持最小兼容读和财务过滤，只恢复该批原元数据或删除该批创建且仍未晋升、未变化的非财务行。来源变化、目标改动、真实财务晋升、重复身份、忙锁立即停止整批，不能删已晋升订单或覆盖新账本。完成回退后也不直接关最小开关：须先确认全库不再有旧消费者会误读的 FALSE 行和相应兼容依赖，再单独安排停用。旧执行记录和原 37 条副本不被清理。

## 最终本机验收

```text
node scripts/migrations/pm-orders-minimal/local.mjs --execute-local
node scripts/migrations/pm-gtc-orders/integration/local.mjs --execute-local
node scripts/verification/verify-pm-orders-minimal-release.mjs
node scripts/verification/verify-pm-orders-minimal-acceptance.mjs --postgres <新增真实验收acceptance.json> --legacy <原64项acceptance.json> --out <全新最终验收文件.json>
```

新增真实 PostgreSQL 87 项、原 64 项顺序使用独立标记实例。完整发布保护仍执行原 18 项；只对识别出的公开网络 TLS/连接错误允许一次原命令重跑，失败日志保留且来源不得变化。断言、范围、下注或财务保护失败不重跑放行。最后的聚合入口只离线读取实际结果、对应源码摘要及测试库身份，拒绝缺项、旧结果、跳过、缺来源或不通过的证据，不连接数据库或 VPS。
