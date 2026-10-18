/**
 * 平台 adapter 加载 — Node 包入口指向原 loader 源码，旧入口继续兼容。
 */
export {
  adapterRequire,
  BACKEND_ROOT,
  backendRequire,
  getAdapterRoot,
  getRegistryPaths,
  initAdapterRegistry,
  initEsmPlatformBackends,
  reqS,
  requirePlatform,
  resetAdapterRootForTests,
  resolvePlatformFile,
} from "@changmen/venue-node-loader";
