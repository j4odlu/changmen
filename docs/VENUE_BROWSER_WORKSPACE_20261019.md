# 浏览器隔离：独立 workspace 与公共入口

[changmen 扩展] 推进前复查了宿主、共享状态、纯函数与契约拆分，7 个测试文件、27 项检查通过，未发现上一轮业务回归。本轮继续建立独立私有包，不提交、推送、部署或执行数据库迁移。

## 范围

client/packages/venue-browser 注册为 @changmen/venue-browser，声明 browser runtime、18 个显式子路径 exports 和两个直接依赖：@changmen/pm-market-data-browser、@changmen/shared。不使用通配 exports、聚合入口或前端路径别名绕过包解析。

@changmen/venue-adapter 显式声明新包依赖。18 个运行时消费者改用 @changmen/venue-browser/...，包括旧兼容入口、类型转出、错误类转出及只读行情宿主。只更换 import/export 的模块路径，不修改声明、计算、状态、观察函数或调用顺序；旧公开入口保留。新增测试核对公共包入口与原入口的函数、错误类、工厂和观察槽身份。

根 workspace 清单增加一项。npm 离线安装只新增一个本地链接，锁文件仅增加新包、链接和消费者声明，没有改变任何第三方依赖版本。浏览器源码依赖归属改为自己的 package.json，安装闭包移除旧的额外源码目录补入逻辑。前端构建现在包含 9 个 workspace、9 个源码目录；backend、RDS 闭包均不包含新包。

同时为 Node 自定义 loader 检查补上新包名及子路径的拒绝规则，原物理路径边界保留。发布选择与版本指纹继续使用已有保守规则，本轮不缩小发布范围。

## 完整性检查

venue-browser-workspace.json 精确登记 18 个消费者、4 个元数据文件和新 manifest。新校验器还原每个变更前的完整源码，再交给既有校验链；前几批固定记录、hash 和历史源码基线不变。新增包 exports 缺失、源码篡改、依赖声明变化均会拒绝。

首次定向测试发现旧的契约防篡改测试仍替换 client/packages/ 字符串，改用包入口后该替换不再产生修改。已改成篡改新包名，并重新验证能拒绝。没有放宽检查或豁免目录。

完整校验首轮另有两项旧测试预期需要同步：前端运行时 workspace 从 7 增至 8（构建另加 runtime-tooling，共 9 个）；故意删除 adapter 依赖时，新增完整性检查先于原依赖检查拒绝。已同步数量，并在故障注入测试中先确认原 pm-direct-dependency 诊断仍有效，再确认完整命令拒绝篡改。两个相关测试文件重跑 70 项通过，失败日志保留供追溯。

## 验证

日志位于 output/venue-browser-workspace-20261019/。

| 检查 | 结果 |
| --- | --- |
| 推进前复查 | 7 文件、27 项通过 |
| 新入口与源码定向验证 | 4 文件、16 项通过 |
| 失败用例修复复验 | 2 文件、70 项通过 |
| Actions 同命令 verification-control 最终复验 | 109 文件、2,731 项通过 |
| test:checks | 边界、导出、契约、冻结检查及 24 步 catalog smoke 通过 |
| Turbo 构建计划 | web 构建图成功生成，无 workspace 循环 |
| npm pack --dry-run | 20 个文件，18 个公开入口全部包含 |
| 完整前端回归 | 527 文件、4,819 项通过；保留原有 3 文件、4 项跳过 |
| 独立安装、前端类型检查、生产构建 | 9 个 workspace、9 个源码目录，无 server；全部通过 |
| git diff --check | 通过 |

各组有交叉，不累计测试总数。打包为本机预览，没有发布 npm 包；本机验证不替代 Linux Actions 和线上验收。

独立安装使用 npm ci --offline --ignore-scripts，构建执行原 vue-tsc 与 Vite 命令；锁文件不变，临时目录已清理。原有大 chunk 与静态/动态导入重叠提示仍存在。最终复验无失败，未发现本轮业务回归。工作保留在 master 本地，尚未 commit、push 或部署。

后续实际消费者与 Worker 接入收口见 [VENUE_BROWSER_CONSUMERS_20261019.md](./VENUE_BROWSER_CONSUMERS_20261019.md)。
