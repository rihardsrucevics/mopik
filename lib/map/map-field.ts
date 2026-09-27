/**
 * What the map's field does in each state (backlog 40, rider 2026-09-27: on
 * the phone's full-screen map the field looked like a search box, and with no
 * row active a tap on it did nothing — only „+” added a stop).
 *
 * - `row`: a row is active; the field searches for it, as before.
 * - `new-stop`: no row is active and „+” can act; focusing the field runs
 *   „+”'s own path and the field, still focused, searches for the new stop.
 * - `off`: the field cannot act — a batch is open (its count is the field's
 *   words), a move or a grab is waiting for the map, or no row is active and
 *   „+” cannot act (the cap, an edit being routed). It is then disabled and
 *   drawn inactive, never a white box that ignores the tap.
 */
export type MapFieldMode = "row" | "new-stop" | "off";

export function mapFieldMode(s: {
  activeRow: number | null;
  batchActive: boolean;
  /** A point move, a shaping-point move or a line grab is waiting for the map. */
  mapBusy: boolean;
  canAddStop: boolean;
}): MapFieldMode {
  if (s.batchActive) return "off";
  if (s.activeRow !== null) return "row";
  if (s.mapBusy) return "off";
  return s.canAddStop ? "new-stop" : "off";
}
