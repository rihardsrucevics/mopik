/**
 * The drag of a selected stretch's end handle (backlog 36, 51).
 *
 * Backlog 51 (rider, 2026-09-30): after one or two drags a handle "did not
 * move on", and the map stopped panning. The handles were MapLibre's own
 * draggable markers, whose drag ends only on the MAP's `mouseup` — a mouse
 * let go over anything drawn above the canvas (the switch row, the bottom
 * bar, the sheet) never ended it: the marker kept `pointer-events: none`
 * for good, so the next press went through it to the map, and the drag
 * state stayed "held". Now the handle owns its gesture with Pointer Events
 * and pointer capture: every move and the release reach the handle
 * wherever the pointer is, a `pointercancel` or a lost capture (iOS takes
 * the touch for a system gesture) ends it too, and a second finger ends it
 * so the pinch is the map's again. The map never sees the handle's press.
 *
 * Pure, so the rule is tested without a map (scripts/stretch-drag.test.ts).
 */

export type StretchEnd = "from" | "to";

export type StretchDragState = { pointerId: number; end: StretchEnd; x: number; y: number; moved: boolean };

export type StretchDragEvent =
  | { type: "down"; pointerId: number; end: StretchEnd; x: number; y: number; primary: boolean }
  | { type: "move"; pointerId: number; x: number; y: number }
  | { type: "up"; pointerId: number }
  | { type: "cancel"; pointerId: number };

/**
 * - `start`: the handle is held (capture the pointer, stop the map's own handling).
 * - `follow`: the handle follows the pointer along the line (not done).
 * - `done`: the drag is over (release the capture; tell the composer `done`).
 * - `null`: nothing to do.
 */
export type StretchDragAction = "start" | "follow" | "done" | null;

/** Screen pixels a press must travel before it is a drag (a tap on a handle moves nothing). */
export const STRETCH_DRAG_MIN_PX = 3;

export function stretchDragStep(state: StretchDragState | null, ev: StretchDragEvent): { state: StretchDragState | null; action: StretchDragAction } {
  switch (ev.type) {
    case "down":
      // A second finger while a handle is held: the drag ends where it is,
      // and the two fingers are the map's pinch.
      if (state) return { state: null, action: "done" };
      if (!ev.primary) return { state: null, action: null };
      return { state: { pointerId: ev.pointerId, end: ev.end, x: ev.x, y: ev.y, moved: false }, action: "start" };
    case "move": {
      if (!state || ev.pointerId !== state.pointerId) return { state, action: null };
      const moved = state.moved || Math.hypot(ev.x - state.x, ev.y - state.y) >= STRETCH_DRAG_MIN_PX;
      return { state: { ...state, moved }, action: moved ? "follow" : null };
    }
    case "up":
    case "cancel":
      if (!state || ev.pointerId !== state.pointerId) return { state, action: null };
      return { state: null, action: "done" };
  }
}
