/**
 * When a gesture on the drawn route line is a deliberate "move the line
 * here" and not a tap, a pan or a pinch (rider, 2026-09-25: white shaping
 * points appeared on his ride in Mārupe while he was only zooming and
 * panning — a double-tap zoom's first tap, landing on the line, grabbed it).
 *
 * A tap never grabs the line any more. What does:
 *
 * - **Mouse**: press on the line and drag it at least `LINE_DRAG_MIN_PX`. The
 *   press itself stops the map panning, as it always has on the desktop.
 * - **Touch**: one finger held still on the line for `LINE_HOLD_MS` (the map
 *   stops panning under it and a ring says "holding the line"), then dragged
 *   at least `LINE_DRAG_MIN_PX`. A finger that moves before the hold is a pan;
 *   a second finger at any point is a pinch; a hold let go without the drag
 *   is nothing. The hold is what tells a drag from a pan: both are one finger
 *   moving across the line.
 *
 * Pure, so the rule is tested without a map (scripts/line-drag.test.ts);
 * route-map.tsx feeds it the map's own mouse and touch events.
 */

/** Screen pixels the grab point must be dragged before it becomes a shaping point. */
export const LINE_DRAG_MIN_PX = 12;
/** How long one finger rests on the line before it holds the line. */
export const LINE_HOLD_MS = 350;
/** A finger that drifts further than this during the hold is panning. */
export const LINE_HOLD_SLOP_PX = 8;

export type LineDragPointer = "mouse" | "touch";

export type LineDragState = {
  pointer: LineDragPointer;
  /**
   * - `pressed`: a finger is down on the line, the hold not yet reached.
   * - `armed`: the line is held (touch) or pressed (mouse); not yet dragged far enough.
   * - `dragging`: dragged past the threshold — the grab has been made.
   */
  phase: "pressed" | "armed" | "dragging";
  x: number;
  y: number;
  at: number;
};

export type LineDragEvent =
  | { type: "down"; pointer: LineDragPointer; x: number; y: number; at: number; onLine: boolean; fingers: number }
  | { type: "move"; x: number; y: number; fingers: number }
  | { type: "hold"; at: number }
  | { type: "up" };

/**
 * What the map does for this step:
 * - `arm`: stop the pan and show the hold ring (touch only).
 * - `grab`: make the shaping point at the press point.
 * - `follow`: draw the connector to the finger or pointer.
 * - `drop`: the release is where the point goes.
 * - `abort`: undo whatever `arm` did; nothing is made.
 */
export type LineDragAction = "arm" | "grab" | "follow" | "drop" | "abort" | null;

export function lineDragStep(state: LineDragState | null, ev: LineDragEvent): { state: LineDragState | null; action: LineDragAction } {
  if (ev.type === "down") {
    if (!ev.onLine || ev.fingers !== 1) return { state: null, action: state ? "abort" : null };
    return { state: { pointer: ev.pointer, phase: ev.pointer === "mouse" ? "armed" : "pressed", x: ev.x, y: ev.y, at: ev.at }, action: null };
  }
  if (!state) return { state: null, action: null };
  const far = (px: number) => ev.type === "move" && Math.hypot(ev.x - state.x, ev.y - state.y) >= px;
  switch (ev.type) {
    case "hold":
      if (state.phase === "pressed" && ev.at - state.at >= LINE_HOLD_MS) return { state: { ...state, phase: "armed" }, action: "arm" };
      return { state, action: null };
    case "move":
      if (ev.fingers > 1) return { state: null, action: "abort" };
      if (state.phase === "pressed") return far(LINE_HOLD_SLOP_PX) ? { state: null, action: "abort" } : { state, action: null };
      if (state.phase === "armed") return far(LINE_DRAG_MIN_PX) ? { state: { ...state, phase: "dragging" }, action: "grab" } : { state, action: null };
      return { state, action: "follow" };
    case "up":
      return { state: null, action: state.phase === "dragging" ? "drop" : "abort" };
  }
}

/**
 * A tap on a phone waits this long before the map acts on it, and is dropped
 * when another touch begins in the meantime: that touch makes it the first
 * half of a double-tap zoom (or of a tap-and-drag zoom), which MapLibre zooms
 * on — and which used to also mark the spot, or add a pending stop row while
 * a batch was open. Mouse clicks are not delayed.
 */
export const TAP_SETTLE_MS = 300;
