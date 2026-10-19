# @changmen/venue-browser

[changmen 扩展] 平台浏览器实现的客户端 workspace，承载采集、行情、报价、账号与下单适配，以及对应测试。Web 直接依赖本包，旧 packages/venue-adapter 不再提供浏览器源码、测试或兼容导出。

## 源码与入口

| 目录 | 职责 |
|---|---|
| adapter/{platform}/ | 各平台浏览器适配及测试 |
| adapter/registry/ | 浏览器平台注册、manifest 消费与元数据 |
| adapter/shared/ 等 | 适配器共享辅助模块及已迁模块的内部转导出 |
| polymarket/ | 前序迁移的 PM 行情、账号、执行与纯规则实现 |
| pm-book-diagnostics/ | PM 订单簿诊断及 Worker |
| shared/ | 浏览器宿主桥接与共享状态 |

应用通过 package.json 显式列出的 @changmen/venue-browser/... 子路径消费，不提供根聚合 barrel。典型入口为 @changmen/venue-browser/adapter/registry/adapters 和各平台 barrel；PM 已迁模块可直接使用 @changmen/venue-browser/polymarket/...。

内部转导出用于保持客户端模块结构和同一函数、状态、构造函数身份。旧包中的 595 个浏览器文件已退役；不要在 packages/venue-adapter 重建入口或实现。新增子路径须同步维护本包显式 exports。

平台元数据唯一维护源为 packages/shared/catalog/venue_manifest.json，执行 npm run sync:venue-manifest 同步生成副本。图标文件位于 client/web/public/assets/venue/，应用脚本生成对应 CSS 映射。

## 依赖边界

本包依赖客户端公共模型、HTTP 契约、共享纯规则及浏览器行情包，不依赖旧 adapter、服务端或 RDS。Node 生产入口不得加载本包；Node loader / registry 位于 server/packages/。

运行依赖由本包声明，版本沿用迁移前的锁定结果。Vue 使用与 Web 一致的 optional peer，使用响应式能力的浏览器宿主必须提供兼容的 Vue runtime。迁移没有改变行情、订单、签名、缓存、连接和 Worker 的业务行为。

## 验证

执行 npm run check:boundaries、npm run check:client-core、npm run typecheck:frontend、npm run test:frontend。独立安装验证入口为 node scripts/testing/frontend-install-isolation.mjs。

独立前端安装与构建闭包包含 8 个 workspace，不包含 server/ 或旧 packages/venue-adapter。后端与 RDS 的声明安装闭包不包含本包；这不代表生产发布范围优化已启用。

迁移证明见 scripts/verification/adapter-browser-relocation.json，旧入口删除与消费者变更证明见 scripts/verification/browser-entry-retirement.json。边界检查分别验证真实文件归属与历史源码一致性，原冻结清单和 FOK 保护基线不变。新增平台按[平台清单](../../../docs/ADD_PLATFORM_CHECKLIST.md)操作。
