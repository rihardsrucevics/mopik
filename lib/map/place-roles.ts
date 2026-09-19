import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * Which pin each confirmed place gets while a ride is only being composed.
 *
 * ## The bug this exists to make impossible
 *
 * The map used to be handed a flat list of the places the rider had actually
 * confirmed, and worked the roles out by position: `[0]` is the start, the
 * last one is the finish, everything between is a stop. That is true only when
 * the rider fills the form from the top down.
 *
 * He does not. Reported from production: the start row was empty, four stops
 * had been added from the map ("Caur (1)" … "Caur (4)"), and the finish row
 * was empty. The list handed to the map was those four stops — so it drew a
 * **green start pin on Caur (1)**, numbers 1 and 2 on Caur (2) and (3), and a
 * **red finish pin on Caur (4)**. Every pin was wrong, and the ride the rider
 * was looking at claimed to start and end at places he had only marked as
 * stops.
 *
 * Position cannot answer this, because the answer is about the *rows*: the
 * composer knows row 0 is the start, that on a one-way ride the last row is
 * the finish, and that everything else is a stop — whether or not any of them
 * is filled in yet. So the roles travel with the places instead of being
 * re-derived from what survived the filter.
 *
 * The rule, in one line: **a pin is drawn for a role the rider has filled, and
 * for no other.** No green pin without a confirmed start, no finish pin
 * without a confirmed finish, and the stops are numbered 1..n in row order
 * however many gaps there are around them.
 */
export type PlaceRoles = {
  /** Row 0, or null while it is empty. */
  start: ResolvedPlace | null;
  /** The middle rows that are filled, in row order. Numbered 1..n by the map. */
  vias: ResolvedPlace[];
  /**
   * The last row of a one-way ride, or null.
   *
   * Always null on a round trip: the ride returns to its start and has no
   * finish of its own, so the last row is an ordinary stop. This is the same
   * distinction that once put a 🅿️ on Warszawa, answered at the source rather
   * than by the map counting places.
   */
  finish: ResolvedPlace | null;
};

/**
 * The composer's rows, as roles.
 *
 * `picked[i]` is the place confirmed for row `i`, or undefined/null while that
 * row is empty — the composer's own store, passed through rather than
 * compacted, because the gaps are the information. It is indexed by row and
 * may be sparse, which is why an array and a `Record<number, …>` are both
 * accepted: the composer keeps a record keyed by row index, and compacting it
 * into an array on the way here would throw away exactly what this is for.
 *
 * `rowCount` is how many rows the form is showing. It is passed separately
 * because `picked` can hold fewer entries than the form has rows (a rider who
 * has filled only row 0 of four) and the finish is the *last row*, not the
 * last pick.
 */
export function placeRoles(params: {
  picked: ArrayLike<ResolvedPlace | null | undefined> | Record<number, ResolvedPlace | null | undefined>;
  rowCount: number;
  tripType: "round_trip" | "one_way";
}): PlaceRoles {
  const { picked, rowCount, tripType } = params;
  const at = (i: number): ResolvedPlace | null =>
    (picked as Record<number, ResolvedPlace | null | undefined>)[i] ?? null;

  // A ride needs somewhere to start before any row can be a finish. With one
  // row there is only a start, whatever the trip type says.
  if (rowCount <= 1) return { start: at(0), vias: [], finish: null };

  const oneWay = tripType === "one_way";
  const lastRow = rowCount - 1;
  // On a round trip every row after the first is a stop; on a one-way ride the
  // last row is the finish and the stops are the rows between.
  const viaEnd = oneWay ? lastRow : rowCount;

  const vias: ResolvedPlace[] = [];
  for (let i = 1; i < viaEnd; i++) {
    const place = at(i);
    // Unfilled rows are skipped rather than counted: the numbers a rider reads
    // on the map are 1, 2, 3 over the stops that exist, and a gap in the form
    // must not leave a gap in them.
    if (place) vias.push(place);
  }

  return {
    start: at(0),
    vias,
    finish: oneWay ? at(lastRow) : null,
  };
}
