import { createApp } from "vue";
import RayLivePage from "./RayLivePage.vue";

// 单独的 HTML 入口，不加载主 App 的采集、订单监控和策略初始化。
createApp(RayLivePage).mount("#app");
