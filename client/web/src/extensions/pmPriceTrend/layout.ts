interface TrendLayout { height: number; wrapped: boolean }

/** 只读取邻接盘口的 DOM 尺寸；同排使用 size containment，图表不参与撑高盘口。 */
export function observeTrendLayout(element: HTMLElement, update: (layout: TrendLayout) => void) {
  const group = element.parentElement;
  if (!group || typeof ResizeObserver === "undefined") return { refresh() {}, stop() {} };
  let lastCard: Element | undefined;
  let previous = "";
  const observer = new ResizeObserver(refresh);
  function refresh() {
    const card = [...group!.children].filter(child => child !== element && child.classList.contains("bet")).at(-1);
    if (!card) return;
    if (card !== lastCard) {
      if (lastCard) observer.unobserve(lastCard);
      lastCard = card;
      observer.observe(card);
    }
    const own = element.getBoundingClientRect();
    const other = card.getBoundingClientRect();
    const wrapped = Math.abs(own.top - other.top) > 2;
    const height = wrapped ? other.height : own.height;
    if (!(height > 0)) return;
    const key = `${height}:${wrapped}`;
    if (key !== previous) { previous = key; update({ height, wrapped }); }
  }
  observer.observe(group); observer.observe(element); refresh();
  return { refresh, stop: () => observer.disconnect() };
}
