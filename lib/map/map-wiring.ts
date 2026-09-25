/**
 * Which of the planning map's controls are live in the view on screen.
 *
 * ## The bug this exists to make impossible
 *
 * Reported by a rider from production, with a screenshot of a finished ride:
 * "When a route has been generated, you can click on the map and a violet PIN
 * appears. What is it for?" It was for nothing. The violet marker is the
 * planning map's "this is where the active row goes" pin, and it had leaked
 * onto the result map.
 *
 * The page wired the pick flow on `picking` alone — the composer's report that
 * a row is waiting for the map. The composer sets it when its map opens and is
 * then unmounted by the very press that generates the ride, so nothing ever
 * said "no row is waiting any more". The flag stayed true under the result,
 * every tap on the finished ride dropped a draggable violet marker, and there
 * was no row, no hint and no Confirm for it to answer to: a control that does
 * nothing, which the rider has asked never to be shipped.
 *
 * So the view decides, not the flag. **The pick flow — tap to mark, the violet
 * marker, flying to a row's place, the geolocate control — and the map's
 * header exist only while the rider is planning**: the form is the view and no
 * ride has been generated. On any other map a tap keeps the meanings it has
 * always had: a segment's card, a sight's card, or putting the highlight away.
 *
 * "Planning" deliberately excludes the form reopened over a result ("back to
 * the form"). That map draws the generated ride — its start, stops and finish
 * — not the form's rows, so a place confirmed there from the map would not be
 * drawn as the pin it became, and it never carried the header that says what a
 * tap does. The composer offers no pin buttons in that state for the same
 * reason; making it a real planning map is a separate job.
 *
 * The one other view that earns them is **edit mode** ("Labot" on a result):
 * the same rows, the same active-row rules and the same header, over the
 * generated ride. A tap there moves or adds a place in the ride, and the
 * panel beside it says so — it is a view the rider entered on purpose, with a
 * way out ("Pabeigt labošanu") and a row the tap answers. The result map
 * outside it keeps a tap for the road cards.
 *
 * The shared-ride page (which is also where a saved ride opens) never passes
 * any of these props to its map, so it has nothing to switch off.
 */
export type MapView = {
  /** Which surface the left column shows: the ride form or the chat/result. */
  entryMode: "form" | "chat";
  /** Whether a generated ride is on screen. */
  hasResult: boolean;
  /** Whether the composer reports a row the map is answering. */
  rowActive: boolean;
  /** "Labot" was pressed on the result and not yet finished. */
  editing?: boolean;
};

export type MapWiring = {
  /** The rider is composing a ride, not reading one. */
  planning: boolean;
  /** The rider is correcting a generated ride on its own map. */
  editing: boolean;
  /** A tap marks a place for the active row: `onPickPoint`, the violet
   *  marker, `pickCenter` and the geolocate control that hangs from them. */
  pick: boolean;
  /** The header bar: the hint, "+ Pietura" and the place field. */
  header: boolean;
};

export function mapWiring({ entryMode, hasResult, rowActive, editing = false }: MapView): MapWiring {
  const planning = entryMode === "form" && !hasResult;
  // Edit mode needs a ride to edit; without one the flag is left over and
  // means nothing.
  const edit = editing && hasResult;
  return { planning, editing: edit, pick: (planning || edit) && rowActive, header: planning || edit };
}
