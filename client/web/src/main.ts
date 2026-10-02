import "@/polyfills/nodeBuiltins";
import "element-plus/theme-chalk/dark/css-vars.css";
// 显式 `import { ElMessage } from "element-plus"` 不会走 unplugin 样式注入
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import "element-plus/es/components/notification/style/css";
import "element-plus/es/components/loading/style/css";
import { createPinia } from "pinia";
import { createApp } from "vue";
import { initGamebetExtension } from "@changmen/client-core/chrome-plugin/bridge";
import { installClientCoreBridges } from "@/runtime/installClientCore";
import { installVenueWebBridge } from "@/runtime/installVenueWebBridge";
import { clearChunkReloadFlag, installChunkReloadOnDeploy } from "@/shared/chunkReload";
import { installOrderSoundAudioUnlock } from "@/shared/orderSound";
import { installSessionRecovery } from "@/runtime/sessionRecovery";
import "@/styles/index.css";
import App from "./App.vue";
import router from "./router";

function bootstrap() {
  installChunkReloadOnDeploy();
  clearChunkReloadFlag();
  installOrderSoundAudioUnlock();
  const pinia = createPinia();
  const app = createApp(App).use(pinia).use(router);
  installVenueWebBridge();
  installClientCoreBridges();
  app.mount("#app");
  void initGamebetExtension();
  const stopRecovery = installSessionRecovery(pinia);
  import.meta.hot?.dispose(stopRecovery);
}

bootstrap();
