import { RouteIntent } from "@/lib/types";

/**
 * BRouter routing profile for adventure motorcycles.
 *
 * BRouter profiles are cost scripts (.brf) evaluated per way, which is why
 * this project uses it: unlike hosted Valhalla, the cost of every road class
 * and surface is ours to set, and the response carries the raw OSM tags
 * rather than a normalised enum.
 *
 * Two rules are deliberate and not tunable:
 *  - `highway=path` is forbidden unless OSM explicitly grants motorcycle or
 *    motor-vehicle access. `footway`/`cycleway`/`bridleway` stay forbidden.
 *    A missing restriction is not positive evidence that a path is a road.
 *  - `motor_vehicle`/`motorcycle`/`vehicle`/`access` = no|private (and
 *    agricultural motor access) are forbidden for the same reason. Near
 *    Sigulda only 3 of 91 tracks are tagged this way, so this costs very
 *    little reachable network.
 *
 * What the rider's preferences change is the relative cost of tracks and
 * unpaved surfaces against ordinary asphalt roads, and — since the
 * 2026-09-03 audit — how rough a track may be, whether sand is welcome,
 * and how hard the router works to stay out of towns and yards.
 *
 * Two facts that shaped this file, both measured:
 *  - BRouter serialises into `WayTags` only the keys the profile references.
 *    `tracktype` and `smoothness` looked absent from every route until the
 *    profile mentioned them. Every key the classifier reports must therefore
 *    appear somewhere below, even where it has no cost effect.
 *  - Node-context keys (`barrier`, `ford` on nodes) referenced in the way
 *    context make the server reject the profile with a bare 500.
 */

export type MotoProfileOptions = {
  /** 0-1, appetite for tracks and unpaved surfaces */
  offRoad: number;
  /** sets how rough a track may be and how a ford is priced */
  difficulty: RouteIntent["difficulty"];
  /** true when the rider wants to stay off main roads */
  avoidMainRoads: boolean;
  avoidMotorways: boolean;
  /** "bez dziļām smiltīm" — sand is a hazard, not a feature */
  noSand: boolean;
  /** stay out of residential streets, yards and town centres */
  avoidTowns: boolean;
  /**
   * The "dotted lines": appetite for forest tracks over gravel roads. Real
   * OSM paths stay forbidden without explicit motor access; this dial is about how far
   * into the forest tracks the router goes versus staying on the continuous
   * gravel road that the turn and grade costs otherwise favour.
   */
  trails: RouteIntent["trailPreference"];
  /** permits bare OSM paths; never permits explicitly forbidden access */
  accessPolicy?: RouteIntent["accessPolicy"];
};

export function buildMotoProfileOptions(intent: RouteIntent): MotoProfileOptions {
  // The gravel preference IS the off-road dial: it says how much unpaved the
  // rider asked for. Difficulty no longer drags it down — with Claude parsing
  // "2h ap Tukumu, daudz grants" as easy + 80% gravel, the old base of 0.2
  // for easy would have sent the rider onto asphalt. Difficulty governs how
  // rough a track may be (grade, smoothness, sand, fords) in `costs()`.
  let offRoad = 0.1 + 0.9 * (intent.gravelPreference / 100);
  if (intent.difficulty === "hard") offRoad += 0.1;
  else if (intent.difficulty === "easy") offRoad -= 0.05;

  if (intent.trailPreference === "lots") offRoad = Math.max(offRoad, 0.9);

  return {
    offRoad: Math.min(1, Math.max(0, offRoad)),
    difficulty: intent.difficulty,
    trails: intent.trailPreference,
    accessPolicy: intent.accessPolicy,
    avoidMainRoads: intent.avoidMainRoads,
    avoidMotorways: intent.avoidMotorways,
    noSand: intent.noSand,
    avoidTowns: intent.avoidTowns,
  };
}

/**
 * Cost added when the route switches between paved and unpaved, in metres of
 * equivalent riding, and the cost of a 90° turn. Measured on six 25-75 km
 * Baltic legs: together they cut turns per 10 km by 30-60% and runs shorter
 * than 500 m by 50-90%, with the unpaved share unchanged within ±4 points.
 * Without them the router takes every 200 m gravel shortcut off an asphalt
 * road and back, which a rider experiences as constant turning for no gain.
 */
const SURFACE_SWITCH_COST_M = 400;
const TURN_COST_M = 120;

/**
 * The rider's complaint after the first version of these costs: "ved pa
 * granti, mežos īsti neved iekšā" — it rides the gravel roads but doesn't go
 * into the forest. The turn cost and grade penalties that stopped the
 * zigzagging also keep the router on the continuous road. So the trail dial
 * trades them back: with "lots", tracks cost far less than gravel roads,
 * grade 3-5 carry no penalty, and turning onto a side track is cheap again.
 */
function trailLevers(o: MotoProfileOptions) {
  const t = o.offRoad;
  switch (o.trails) {
    // Track costs are floored so that a main road never costs more than ~12×
    // a track: at 25× the router rode 13 km of forest to dodge 900 m of
    // primary, and no rider does that.
    case "lots":
      return { track: (0.9 - 0.4 * t).toFixed(2), turnCost: 50, switchCost: 150, trackEntryCost: 15, roadPenalty: 1.35 };
    // "lots" with hard difficulty is the rider asking for the dotted lines
    // themselves. Measured near Blīdene: at path 3.0 (6x a track) the router
    // never took one — 0% trail on every candidate — because a 300 m path
    // always had a track alternative that scored better. At 0.75 paths win
    // where they genuinely shortcut, and the trail share stops being zero.
    case "some":
      return { track: (1.2 - 0.6 * t).toFixed(2), turnCost: 80, switchCost: 250, trackEntryCost: 80, roadPenalty: 1.1 };
    default:
      return { track: (2.0 - 1.5 * t).toFixed(2), turnCost: TURN_COST_M, switchCost: SURFACE_SWITCH_COST_M, trackEntryCost: SURFACE_SWITCH_COST_M, roadPenalty: 1 };
  }
}

/** Cost factors: lower is more attractive to the router. */
function costs(o: MotoProfileOptions) {
  // At offRoad 0 a track costs the same as a quiet paved road; at 1 it is
  // strongly preferred. Main-road costs rise with the same dial so that
  // wanting gravel also means wanting to avoid the arterials that bypass it.
  const t = o.offRoad;
  const easy = o.difficulty === "easy";
  const hard = o.difficulty === "hard";
  const trails = trailLevers(o);
  const lots = o.trails === "lots";
  const some = o.trails === "some";

  return {
    track: trails.track,
    turnCost: trails.turnCost,
    switchCost: trails.switchCost,
    trackEntryCost: trails.trackEntryCost,
    unpavedBonus: (1 - 0.45 * t).toFixed(2),
    // Gravel roads get slightly dearer when the rider wants tracks, so the
    // forest track beside the road wins.
    unclassified: ((1.6 - 0.5 * t) * trails.roadPenalty).toFixed(2),
    // Streets and yards. Riders do not ride loops through suburbs; the floor
    // keeps them out even when the off-road dial is low, and `avoidTowns`
    // makes them a last resort.
    residential: (o.avoidTowns ? 5.0 : Math.max(3.0, 2.4 + 2 * t)).toFixed(2),
    service: o.avoidTowns ? "4.00" : "2.50",
    livingStreet: o.avoidTowns ? "8.00" : "4.00",
    // Main roads are connectors, not the enemy. The Valhalla-era formulas
    // (primary 12 + 60·t) put a primary road at 63× against a track at 0.37×
    // — a 170-fold gap — so wherever the network needs 2 km of main road (a
    // bridge over the Ogre, a railway crossing) the router rode 40 km of
    // tracks instead: three legs of a rider's 126 km plan came back at 36–55
    // km each. Riga loops crawled 50–80 km of residential streets for the
    // same reason (streets 3–5× vs arterials 26–63×). A rider's own plan used
    // 17 km of primary/secondary as links and thought nothing of it.
    tertiary: (2.2 + 1.5 * t).toFixed(2),
    secondary: (o.avoidMainRoads ? 10 : 3 + 2.5 * t).toFixed(2),
    primary: (o.avoidMainRoads ? 20 : 4 + 3 * t).toFixed(2),
    // Latvia has almost no motorways: the A-roads (A2 Rīga–Sigulda, A10 to
    // Jūrmala) are `trunk`, legal for any motorcycle and sometimes the only
    // way across a river or into a suburb. Forbidding them cost a rider's
    // last 5 km home a 44 km detour. Dear, never forbidden; only
    // `motorway` is refused with avoidMotorways.
    trunk: o.avoidMotorways ? "12.0" : "6.0",
    motorway: o.avoidMotorways ? "100000" : "8.0",

    // tracktype: grade1-2 are the adventure roads a rider wants; grade4-5 are
    // deeply rutted or overgrown and belong only in a "hard" ride. Multipliers
    // alone did not keep grade4-5 out of an "easy" route where the network
    // offers nothing else, hence the outright forbid for easy.
    // "lots" of dotted lines means the rough grades are the point of the ride;
    // "easy" still refuses grade5 unless the rider asked for lots of trails.
    grade3: hard || lots ? "1.00" : "1.10",
    grade4: hard || lots ? "1.00" : some ? "1.20" : easy ? "3.00" : "1.60",
    grade5: hard || lots ? "1.10" : some ? "2.00" : easy ? "100000" : "3.00",
    // smoothness: very_horrible/impassable are for 4x4s and trials bikes.
    horrible: hard ? "2.00" : easy && !lots ? "100000" : "5.00",
    // A mapper's "impassable" is a car's impassable; a rider's plan crossed
    // 200 m of it. Dear, not forbidden, except for an easy ride.
    impassable: hard ? "8.00" : easy && !lots ? "100000" : "20.0",
    veryBad: hard ? "1.20" : "2.00",
    bad: "1.20",

    // Deep sand is the Baltic adventure hazard riders most often ask to avoid.
    // It never gets the unpaved discount; "hard" merely tolerates it.
    sand: o.noSand ? "4.00" : hard ? "1.00" : easy ? "2.50" : "1.30",
    mud: "3.00",
    grass: easy ? "2.50" : "1.60",

    // Towns, from BRouter's own building-density estimate (1 = open country,
    // 6 = dense centre). Only bites where it should: on rural legs it stays
    // at zero kilometres; on a Riga-centre leg it moved 8.4 km of class ≥3
    // riding down to 2.8 km.
    town5: o.avoidTowns ? "3.00" : "1.50",
    town4: o.avoidTowns ? "2.00" : "1.20",
    town3: o.avoidTowns ? "1.40" : "1.00",

    // "Into the forest": BRouter estimates forest density per way (1 = open,
    // 6 = deep forest) from the OSM landuse around it. A discount that grows
    // with the trail dial pulls the route off the field-edge gravel road and
    // onto the forest tracks beside it — which is what "pa mežiem" means.
    forestDeep: lots ? "0.55" : some ? "0.75" : "0.90",
    forestMid: lots ? "0.70" : some ? "0.85" : "1.00",
    // Busy roads are what an adventure rider is escaping; BRouter's traffic
    // estimate (1-7) is the only signal for it in the data.
    trafficHeavy: "1.60",
    trafficBusy: "1.30",

    // Fords are the signature Baltic obstacle: a feature for an adventure
    // ride, something to price out of an easy one. Cost in metres.
    fordNode: easy ? "3000" : hard ? "100" : "300",
  };
}

/**
 * The .brf script. BRouter's syntax is prefix/Lisp-like: `switch cond a b`,
 * `or a b`, `multiply a b`.
 *
 * Note the shape of `costfactor`: BRouter rejects `multiply varA varB` with a
 * 500, so the factors are named variables and the road-class switch chain is
 * written inline as the last multiply operand.
 */
export function buildMotoProfile(o: MotoProfileOptions): string {
  const c = costs(o);

  return `# Mopik adventure motorcycle profile — generated, do not edit by hand
---context:global

assign consider_elevation = false
assign validForCars = 1

---context:way

# A 90-degree turn costs this many metres of riding: the router stops
# zigzagging through every side track for a few metres of gravel.
assign turncost = ${c.turnCost}

# Switching between paved and unpaved costs something too, so short gravel
# shortcuts off an asphalt road and back are no longer free.
assign is_unpaved =
  or highway=track or surface=gravel or surface=fine_gravel or surface=ground
  or surface=dirt or surface=earth or surface=compacted or surface=unpaved
  or surface=sand or surface=grass or surface=mud or surface=pebblestone
  or tracktype=grade2 or tracktype=grade3 or tracktype=grade4 tracktype=grade5
#
# The classifier has three levels, not two: asphalt (1), unpaved road (2) and
# forest track/trail (3). With only two, gravel road -> forest track counted
# as a full surface switch, and a rider who asked for tracks paid the
# anti-ping-pong penalty for every turn INTO what they came for. Latvian
# forest tracks are short — 300-800 m — so at switchCost 150 m a 500 m track
# cost 288 against 226 for staying on the gravel road, even though the track
# is 40% cheaper per km. Break-even sat at ~1.2 km, which is longer than most
# tracks exist. Hence trackEntryCost: near-free entry into a track when the
# rider asked for them, full price for asphalt <-> unpaved.
assign is_forest_way = or highway=track or highway=path highway=bridleway
assign initialclassifier =
  switch is_forest_way 3
  switch is_unpaved 2
  1
assign initialcost =
  switch is_forest_way ${c.trackEntryCost}
  ${c.switchCost}

# Ways a motor vehicle may not legally use. Kept absolute on purpose: the
# app must never route a rider onto private land or a foot/cycle path.
# Parking aisles and driveways are not "roads" in any rider's sense either.
#
# Only tag values present in BRouter's lookups.dat may appear here — an
# unknown one makes the server reject the whole profile with a 500 and no
# message. (motor_vehicle=forestry is an alias of =agricultural there.)
# A bare highway=path is not a road and does not acquire motor access merely
# because the rider asked for many trails. This matters especially on beaches
# and protected-area paths where the legal restriction may be implicit and
# absent from the individual OSM way. Use a path only when a mapper recorded
# positive mode-specific access. Ordinary highway=track forest roads are not
# affected by this conservative rule.
assign motor_path_allowed =
  or motorcycle=yes or motorcycle=designated
  or motor_vehicle=yes or motor_vehicle=designated
  or vehicle=yes vehicle=designated
assign unverified_forest_path =
  and highway=path and not foot=designated and not bicycle=designated not estimated_town_class=4
assign beach_like_path = and highway=path surface=sand
assign motor_forbidden =
  or beach_like_path
  or ${o.accessPolicy === "allow_unverified" ? "and highway=path and not motor_path_allowed not unverified_forest_path" : "and highway=path not motor_path_allowed"} or highway=footway or highway=cycleway
  or highway=bridleway or highway=steps or highway=pedestrian
  or highway=construction or highway=proposed
  or motor_vehicle=no or motor_vehicle=private or motor_vehicle=agricultural
  or motorcycle=no or motorcycle=private
  or vehicle=no or vehicle=private
  or access=no or access=private
  or service=parking_aisle service=driveway

# Unpaved surfaces are what the rider is after, so they get a discount
# rather than the penalty a car profile would apply — except sand, mud and
# grass, which are hazards priced by difficulty.
assign surface_factor =
  switch surface=sand ${c.sand}
  switch surface=mud ${c.mud}
  switch surface=grass ${c.grass}
  switch highway=track 1.0
  switch or surface=gravel or surface=fine_gravel or surface=ground or surface=dirt or surface=earth or surface=compacted or surface=unpaved surface=pebblestone ${c.unpavedBonus}
  1.0

assign grade_factor =
  switch tracktype=grade5 ${c.grade5}
  switch tracktype=grade4 ${c.grade4}
  switch tracktype=grade3 ${c.grade3}
  1.0

assign smooth_factor =
  switch or smoothness=impassable smoothness=very_horrible ${c.impassable}
  switch smoothness=horrible ${c.horrible}
  switch smoothness=very_bad ${c.veryBad}
  switch smoothness=bad ${c.bad}
  1.0

assign town_factor =
  switch or estimated_town_class=5 estimated_town_class=6 ${c.town5}
  switch estimated_town_class=4 ${c.town4}
  switch estimated_town_class=3 ${c.town3}
  1.0

assign forest_factor =
  switch or estimated_forest_class=5 estimated_forest_class=6 ${c.forestDeep}
  switch or estimated_forest_class=3 estimated_forest_class=4 ${c.forestMid}
  1.0

# A mild preference for roads near rivers. Candidate ranking decides the
# overall landscape mix; this only lets a scenic parallel road win a close
# choice inside one leg without causing a long river-seeking detour.
assign river_factor =
  switch or estimated_river_class=5 estimated_river_class=6 0.92
  switch or estimated_river_class=3 estimated_river_class=4 0.97
  1.0

# Noise is the opposite of the nature experience even when traffic tags are
# incomplete. Keep this mild because busy links can be necessary crossings.
assign noise_factor =
  switch or estimated_noise_class=5 estimated_noise_class=6 1.12
  switch estimated_noise_class=4 1.06
  1.0

assign traffic_factor =
  switch or estimated_traffic_class=6 estimated_traffic_class=7 ${c.trafficHeavy}
  switch estimated_traffic_class=5 ${c.trafficBusy}
  1.0

# Referenced only so BRouter reports them in WayTags for the classifier and
# the route summary; they carry no cost of their own here.
assign report_only =
  or tracktype=grade1 or tracktype=grade2 or smoothness=excellent or smoothness=good
  or smoothness=intermediate or estimated_town_class=1 or estimated_town_class=2
  or estimated_forest_class=1 or estimated_forest_class=2
  or estimated_river_class=1 or estimated_river_class=2
  or estimated_river_class=3 or estimated_river_class=4
  or estimated_river_class=5 or estimated_river_class=6
  or estimated_noise_class=1 or estimated_noise_class=2 or estimated_noise_class=3
  or estimated_noise_class=4 or estimated_noise_class=5 or estimated_noise_class=6
  or estimated_traffic_class=1 or estimated_traffic_class=2 or estimated_traffic_class=3
  or estimated_traffic_class=4 or ford=yes or 4wd_only=yes or service=alley service=logging

assign costfactor
  switch motor_forbidden 100000
  switch highway=path ${o.trails === "lots" ? (o.difficulty === "hard" ? "0.75" : "1.1") : o.trails === "some" ? "2.2" : "8.0"}
  multiply surface_factor
  multiply grade_factor
  multiply smooth_factor
  multiply town_factor
  multiply forest_factor
  multiply river_factor
  multiply noise_factor
  multiply traffic_factor
  switch highway=track         ${c.track}
  switch highway=unclassified  ${c.unclassified}
  switch highway=service       ${c.service}
  switch highway=residential   ${c.residential}
  switch highway=living_street ${c.livingStreet}
  switch highway=tertiary      ${c.tertiary}
  switch highway=secondary     ${c.secondary}
  switch highway=primary       ${c.primary}
  switch or highway=trunk highway=trunk_link ${c.trunk}
  switch or highway=motorway highway=motorway_link ${c.motorway}
  switch highway=primary_link ${c.primary}
  switch highway=secondary_link ${c.secondary}
  switch highway=tertiary_link ${c.tertiary}
  6.0

---context:node

# Gates are usually passable (forestry gates stand open more often than not);
# bollards, blocks, chains and fallen trees may not be, so they cost enough
# that the router only uses them when there is no other way through.
assign initialcost =
  switch or barrier=gate or barrier=lift_gate or barrier=swing_gate barrier=cattle_grid 200
  switch or barrier=bollard or barrier=block or barrier=chain or barrier=fence or barrier=log or barrier=debris barrier=motorcycle_barrier 5000
  switch ford=yes ${c.fordNode}
  0
`;
}
