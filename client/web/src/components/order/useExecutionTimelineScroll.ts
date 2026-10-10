import type { Ref } from "vue";
import { nextTick, onMounted, ref, watch } from "vue";

/** [changmen 扩展] 跟随新增记录；手动回看时保留滚动位置，折叠不改变跟随状态。 */
export function useExecutionTimelineScroll(displayed: Readonly<Ref<readonly unknown[]>>, visible: () => boolean | undefined) {
  const feedEl = ref<HTMLElement | null>(null);
  const following = ref(true);
  function scrollToLatest() {
    if (visible() !== false && following.value && feedEl.value)
      feedEl.value.scrollTop = feedEl.value.scrollHeight;
  }
  function onScroll() {
    const el = feedEl.value;
    if (el && visible() !== false)
      following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }
  onMounted(() => { void nextTick(scrollToLatest); });
  watch(displayed, () => { void nextTick(scrollToLatest); }, { deep: true });
  watch(visible, (shown) => { if (shown) void nextTick(scrollToLatest); });
  return { feedEl, onScroll };
}
