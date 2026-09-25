/**
 * Shaping points („maršruta punkti”, rider, 2026-09-25) in a list of places.
 *
 * A stop is a place: a numbered pin, a row in the form, a name, a GPX
 * waypoint. A shaping point is none of those — it is where the rider grabbed
 * the drawn line and moved it, a small white dot that bends the ride and is
 * otherwise invisible. To the router the two are the same thing, a via; to
 * everything that describes the ride only the stops exist.
 *
 * The plan keeps them apart (`viaPlaces` are names, `shapePoints` are
 * coordinates), so something has to put them back in riding order whenever
 * the router needs the whole list. That is this: each shaping point says
 * which place it follows — `afterPlace`, the index in `[start, ...stops]` —
 * and is slotted in right after it, in the order the plan lists them.
 *
 * No routing, no dataset, no React: the generation (server) and the editor
 * (client) both call it, and it is tested on its own.
 */
export type ShapePoint = { lat: number; lon: number; afterPlace: number };

/**
 * The stops with the shaping points slotted in, in riding order.
 *
 * An `afterPlace` past the last stop (a plan whose stops were edited since)
 * goes after the last stop, before the finish — the leg it can still be on.
 */
export function interleaveShapes<T>(stops: readonly T[], shapes: readonly ShapePoint[] | undefined, make: (shape: ShapePoint) => T): T[] {
  if (!shapes?.length) return [...stops];
  const out: T[] = [];
  const at = (k: number) => shapes.filter((s) => Math.min(Math.max(0, s.afterPlace), stops.length) === k).map(make);
  out.push(...at(0));
  stops.forEach((stop, i) => {
    out.push(stop);
    out.push(...at(i + 1));
  });
  return out;
}

/**
 * The reverse: which place each shaping point in a mixed list follows. The
 * index counts the start as 0 and each stop before the point as one more.
 */
export function shapesAfterPlaces<T>(vias: readonly T[], isShape: (v: T) => boolean, point: (v: T) => { lat: number; lon: number }): ShapePoint[] {
  const out: ShapePoint[] = [];
  let stops = 0;
  for (const v of vias) {
    if (!isShape(v)) { stops++; continue; }
    const { lat, lon } = point(v);
    out.push({ lat, lon, afterPlace: stops });
  }
  return out;
}
