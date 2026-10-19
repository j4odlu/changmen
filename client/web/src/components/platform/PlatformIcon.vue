<script setup lang="ts">
import type { PlatformId } from "@changmen/api-contract";
import { getPlatformIconUrl } from "@changmen/venue-browser/adapter/registry";
import { computed } from "vue";

const props = defineProps<{
  /** 平台 ID，对应 manifest.json id 与 .provider-icon.{id} */
  platform: PlatformId | string;
  /** OB 限红账号角标描边 */
  limit?: boolean;
}>();

/** 内联兜底：CSS class 未命中时（Type 空串等）仍显示场馆角标图 */
const iconStyle = computed(() => {
  const url = getPlatformIconUrl(props.platform);
  return url ? { backgroundImage: `url(${url})` } : undefined;
});
</script>

<template>
  <span
    class="provider-icon"
    :class="[platform, { limit }]"
    :style="iconStyle"
    aria-hidden="true"
  />
</template>
