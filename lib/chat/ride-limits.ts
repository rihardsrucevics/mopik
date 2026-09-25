/**
 * How many places one ride may carry — the one number the plan's schema, the
 * chat's plan, the form's rows, the map's „+” and the suggestions card all
 * obey.
 *
 * It lived in five places as a literal 6, counted two different ways (the
 * schema capped *stops* at six, the form capped *rows* at six, so a one-way
 * ride stopped at four stops), and the rider hit the form's wall after his
 * fourth stop with a truncated pill he could not read (2026-09-25). One
 * constant, counted as stops, so every control hits the same wall and says
 * the same number.
 *
 * Ten, measured on our own BRouter (2026-09-25, `/api/generate-route`, one
 * way, flexible budget, warm server, two runs each): Rīga → Valmiera through
 * 8 stops 28.1 / 29.5 s, through 10 stops 4.9 / 5.7 s; Rīga → Kuldīga through
 * 8 stops 25.5 / 24.5 s, through 10 stops 7.8 / 7.9 s. Every run found two
 * rides. Ten is not slower than eight — the more of the ride the rider has
 * fixed, the less there is to search — and both are well inside the 50 s
 * budget. Older share codes carry at most six and still decode.
 */
export const MAX_STOPS = 10;

/**
 * Rows the form holds at the cap: the start, the stops, and — one way — the
 * finish. A round trip's finish is its start, so it has one row fewer.
 */
export function maxRows(oneWay: boolean): number {
  return MAX_STOPS + (oneWay ? 2 : 1);
}

/**
 * Shaping points („maršruta punkti”, 2026-09-25): the dots a grab of the
 * drawn line leaves, which bend the line without being places. Their own cap,
 * separate from the stops: they cost no row, no name and no waypoint, only a
 * via for the router, and twenty is far more than a ride needs to be bent
 * into shape while keeping a correction's request a size the server takes.
 */
export const MAX_SHAPE_POINTS = 20;
