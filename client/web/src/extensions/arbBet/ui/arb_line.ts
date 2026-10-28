import type { BetSide } from "@/models/match";
import type { PlatformId } from "@/types/esport";

export interface ArbLineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ArbLineBadge {
  x: number;
  y: number;
}

export interface ArbLineOverlayGeometry {
  line: ArbLineSegment;
  badge: ArbLineBadge;
}

const BADGE_Y_OFFSET = 14;

/** Vue :ref 可能收到组件实例，统一解析为 HTMLElement */
export function resolveVueElement(el: unknown): HTMLElement | null {
  if (el instanceof HTMLElement)
    return el;
  if (el && typeof el === "object" && "$el" in el) {
    const root = (el as { $el: unknown }).$el;
    if (root instanceof HTMLElement)
      return root;
  }
  return null;
}

export function oddsAnchorKey(type: PlatformId, side: BetSide, itemId: string): string {
  return `${type}:${side}:${itemId}`;
}

export function centerInContainer(el: HTMLElement, container: DOMRect): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - container.left,
    y: rect.top + rect.height / 2 - container.top,
  };
}

/**
 * 在 container 坐标系内，根据两腿 anchor 元素计算套利连线与利润标签位置。
 */
export function computeArbLineOverlay(
  container: HTMLElement,
  homeEl: HTMLElement | undefined | null,
  awayEl: HTMLElement | undefined | null,
): ArbLineOverlayGeometry | null {
  if (!homeEl || !awayEl)
    return null;
  const box = container.getBoundingClientRect();
  const p1 = centerInContainer(homeEl, box);
  const p2 = centerInContainer(awayEl, box);
  return {
    line: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
    badge: {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2 - BADGE_Y_OFFSET,
    },
  };
}
