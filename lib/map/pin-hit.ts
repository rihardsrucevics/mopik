/**
 * Which of several overlapping map pins a tap meant.
 *
 * The rider could not move his stop 5 on the phone (2026-09-25): it sat
 * 17 px from stop 4, both 22 px discs, so they overlapped, and whichever the
 * browser drew on top took every tap on the shared part. The pin a tap means
 * is the one whose centre is nearest to it, among the pins under the finger —
 * with a few pixels of slack, because a thumb lands a little off a 22 px disc
 * as often as on it.
 *
 * Pure (boxes in, item out) so it can be tested without a DOM.
 */
export type Box = { left: number; top: number; width: number; height: number };

export const PIN_HIT_SLACK_PX = 6;

export function nearestUnder<T>(
  items: readonly T[],
  boxOf: (item: T) => Box | null,
  x: number,
  y: number,
  slack = PIN_HIT_SLACK_PX,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const item of items) {
    const b = boxOf(item);
    if (!b || b.width <= 0 || b.height <= 0) continue;
    if (x < b.left - slack || x > b.left + b.width + slack || y < b.top - slack || y > b.top + b.height + slack) continue;
    const d = Math.hypot(x - (b.left + b.width / 2), y - (b.top + b.height / 2));
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}
