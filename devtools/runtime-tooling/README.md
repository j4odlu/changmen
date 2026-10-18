# @changmen/runtime-tooling

[changmen 扩展] 仅供 Node 使用的来源身份识别与开发端口解析。Vite 构建和服务端诊断共用单一实现；浏览器运行代码不得导入。

| 导出 | 用途 |
| --- | --- |
| `@changmen/runtime-tooling/runtime_version.js` | `readSourceVersion`、`captureRuntimeVersion`、来源过滤；调用方显式传入仓库或归档根 |
| `@changmen/runtime-tooling/dev_web_port.js` | 既有 Windows / 其他平台默认端口、环境覆盖与合法性校验 |

`client/web` 在 devDependencies 声明本包；`server/storage` 在 dependencies 声明本包。包无外部运行依赖或生命周期脚本。端口算法及类型声明逐字迁移；来源算法仅增加本目录的双端过滤与无 Git 归档扫描，完整历史算法仍由原 hash 校验。

旧 `@changmen/shared/tooling/*` 路径保留转导出，邻接的 `packages/shared/tooling/package.json` 是独立 `@changmen/runtime-tooling-compat` workspace，为这些 Node 入口声明唯一依赖。`shared/package.json` 不引入该 Node 包；独立 Node 宿主使用本包，旧入口宿主也可显式安装兼容 workspace。现有根安装、web 构建及 storage 运行消费者已声明并验证，无需更改既有 npm 启动命令。

前端运行依赖图不包含本包，构建依赖图包含本包。npm 定向安装即使使用 `omit=dev` 也可能保留构建用 workspace 链接；目录中有链接不等于运行依赖，亦不能声称实际安装树已经精简隔离。生产继续使用原全量安装与封包规则。

原始根定位、配置读取及环境优先级仍由 storage 持有；本包不读取凭据、连接数据库或启动服务。完整迁移记录、安装限制及冻结包方案见[第二批记录](../../docs/NODE_TOOLING_AND_FROZEN_MIGRATION_20261018.md)。
