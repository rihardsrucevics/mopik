"use client";

import posthog from "posthog-js";

/**
 * One `track()` for the whole app. Events go to PostHog (EU) when the public
 * project key is configured, and to Google Analytics when its tag is on the
 * page; neither is required for the app to work. Event names are the
 * product's vocabulary, not the UI's — see docs/PROGRESS.md for the list.
 */
export type AnalyticsEvent =
  | "form_generate"          // the composer's button; props: budget, trip type, profile
  | "chat_message_sent"      // a typed chat message; props: length, has_route
  | "quick_reply_used"       // a tap on a chip; props: label
  | "route_generated"        // routes arrived; props: versions, km, minutes, repeated, budget…
  | "route_infeasible"       // nothing fits the time; props: requested/minimum minutes
  | "route_unplannable"      // probe says the ride is too hard to search; props: leg_km, reason
  | "route_no_route"         // every candidate failed, no place to blame; props: tried, stops
  | "map_pin_pressed"        // a ride pin clicked to make its row active; props: role
  | "route_line_grabbed"     // edit mode: the drawn line grabbed, a shaping point in the making; props: slot
  | "shape_point_dragged"    // edit mode: a shaping point's dot dragged (waits for Confirm)
  | "shape_point_pressed"    // edit mode: a shaping point's dot tapped — selected, its sheet open
  | "map_stop_removed"       // „Izņemt” on a tapped stop's sheet on the map
  | "map_point_move"         // „Pārvietot” on a tapped point's sheet; props: kind (pin, shape)
  | "shape_point_edited"     // edit mode: a shaping point added/moved/removed/made a stop; props: kind
  | "batch_stop_marked"      // a pending stop added to a batch on the map; props: n (its place in the batch)
  | "batch_confirmed"        // „Apstiprināt visas”; props: n
  | "batch_discarded"        // ✕ on an open batch; props: n
  | "plan_undone"            // ↶ / Ctrl+Z in planning
  | "route_no_route_retry"   // a way out of that chosen; props: how (drop-stops, easier-profile)
  | "direct_leg_shown"       // rider took the direct-road offer (item 7b); props: km, minutes
  | "generation_cancelled"   // "Atcelt" on the loader; props: case (first_from_form → back to the form | later → stays in the chat)
  | "overlap_chat_shown"     // best version retraces > 20 %
  | "route_version_selected" // Taisnākā / Līkumotākā / Sarežģītākā
  | "alternative_cycled"      // a card swapped to another ride of its kind; props: variant, to
  | "gpx_downloaded"         // the GPX button; props: variant, km, minutes, repeated
  | "beer_popup"             // the thank-you shown
  | "beer_click"             // the Revolut link tapped
  | "instagram_opened"        // "Raksti mums" tapped; props: from (header|beer)
  | "map_fullscreen"         // phone map expanded
  | "route_shared"           // share button; props: method (share|copy), km, variant, long (true: the store failed, the long link went out)
  | "shared_route_viewed"    // /r/<code> opened
  | "shared_gpx_downloaded"  // GPX from a shared page
  | "install_prompt_shown"   // Android: add-to-home-screen offered
  | "install_accepted"
  | "install_dismissed"
  | "ride_saved"             // kept on this device; props: km, variant
  | "ride_unsaved"
  | "saved_ride_opened"
  | "saved_ride_removed"
  | "saved_gpx_downloaded"
  | "saved_list_opened"
  | "locale_changed"         // interface language switched from the header
  | "shared_ride_saved"      // kept a ride someone else sent
  | "shared_ride_unsaved"
  | "saved_alternative_opened" // opened another version of a saved ride
  | "form_map_opened"         // the map opened on request in the form (phones)
  | "form_location_used"      // "Mana vieta" filled the start from the device
  | "places_reordered"        // a stop moved; props: how (drag|tap|keyboard) — is the iOS path used?
  | "place_picked"            // a suggestion chosen; props: kind, group — are POIs actually picked?
  | "place_picked_on_map"     // a row filled by tapping the map; props: row, start — is the map used for the start, or for the places that have no name?
  | "stop_added_from_map"     // "+ Pietura" in the planning map's header made a new stop row; props: count — is the map the way stops get added, or is the form still carrying it?
  | "suggestion_added"        // "Pievienot" in Ieteikumi: a suggested place became a via point; props: via_count
  | "suggestion_shown"        // "Kartē" in Ieteikumi: the map flew to a suggestion without changing the ride; props: kind
  | "detour_previewed"       // a sight was ticked and its detour spliced into the drawn line; props: pois, delta_km
  | "sights_committed"       // "Pievienot izvēlētos": the spliced ride became the ride, with no search; props: pois, delta_km, ms — is the instant path actually the one riders take?
  | "search_better_loop"     // the full search asked for explicitly, with the ride's (possibly edited) places and any ticked sights as vias; props: pois, after_edit — how often is a cleaner loop worth 30-60 s?
  | "route_edit_opened"      // "Labot" on the result: edit mode on the same page; props: km, stops — do riders correct rides on the map?
  | "route_edit_finished"    // "Pabeigt labošanu"; props: edited — did the edits survive the session?
  | "route_edit_cancelled"   // "Atcelt labošanu": every edit of the session dropped; props: edited (whether there was anything to drop)
  | "route_edit_pin_dragged" // a ride pin dragged in edit mode, which marks that row; props: role (start|via|finish) — is dragging found, or is marking?
  | "route_edited"           // an edit re-routed and spliced; props: how (move-start|move-stop|move-finish|add-stop|remove-stop|reorder), ms (commit → line), runs, km_delta, repeated_before, repeated_after — is it under 5 s, and does it make retracing worse?
  | "route_edit_undone"      // the last edit was reverted; props: how — the honest read on whether the corrections are good
  | "route_edit_failed"      // the stretch could not be routed through the new point; props: reason (status|network|degenerate|no-place)
  | "trip_type_changed"       // props: to (one_way|round_trip) — is the new default right?
  | "ride_edit_opened"        // "Rediģēt formā" on a shared or saved ride; props: from, saved
  | "shared_correction_sent" // "Ko mainīt?" typed on a shared ride's page; props: length, saved
  | "edited_ride_kept"        // the edit produced a new ride and the original stays
  | "edited_ride_replaced"    // the edit replaced the ride it started from
  | "pick_off_road"           // a tapped place is too far from any road the profile may ride; props: row, distance_m, can_move — how often does the map offer ground a ride cannot reach?
  | "pick_off_road_moved"    // the rider took the nearest road instead of his tap; props: row, distance_m — is moving the pick the answer, or does he cancel it?
  // Phase 1 (docs/DESIGN-route-editing.md B3/B4, Contract C1): preview before commit and the stop ↔ pass-through switch.
  | "route_edit_proposed"     // a pending edit routed and shown as a preview; props: how, ms (mark → preview), km_delta, repeated_before, repeated_after — is the preview fast enough to be the default?
  | "route_edit_confirmed"    // ✓ on a preview, committed to the ride and the undo (`route_edited` still fires for the commit); props: how, while_routing (✓ pressed before it landed)
  | "route_edit_discarded"    // ✕ on a preview, or the pending mark went away; props: how, phase (routing|proposed|refused) — how often does the preview change the rider's mind?
  | "route_edit_refused"      // a preview could not be routed; props: how, reason (status|network|degenerate|broken-line|too-far|no-place|no-road)
  | "point_kind_switched"     // „Padarīt par pieturu” / „Padarīt caurbraucamu”, committed at once; props: to (stop|pass), mode (plan|edit) — is the one-kind-of-point model used both ways?
  // Phase 1 addition (2026-09-28): where a new point goes, its kind while pending, a pass-through point moved onto the line.
  | "new_point_placed"        // a new point went into its nearest leg; props: unsure (null|close|beyond-finish; "far" before release B), mode (plan|edit) — how often is Mopik not sure?
  | "new_point_leg_chosen"    // the rider picked the other choice chip; props: extend (a new finish) — do the chips get used, and which way?
  | "new_point_kind_toggled"  // „Pietura” ⇄ „Caurbraucams” while pending; props: to (stop|pass)
  | "moved_point_on_line"     // a pass-through point moved onto the line elsewhere; props: choice (keep|remove) — what does the rider mean by it?
  | "route_edit_wide_accepted" // „Pārrēķināt posmu” on a change only the whole-span re-route could make (it was refused with the km, `wide-ask`)
  | "route_edit_override_accepted" // „Tomēr braukt” on a proposal outside the profile or with a big detour; props: why (profile|detour|deadEnd), relax (the profile rung) — how often is the profile in the way?
  | "route_edit_straight_asked" // „Vest pa taisno” where no road reaches the point: routed as far as a road goes, then straight — how often does a rider need a point off every road?
  | "route_edit_widened" // a place left on a spur the router did not prove a dead end, ridden through by a wider stretch — how often was the window too tight? (spur_m, km_delta)
  // ── line-sheet ── Tap the line (2026-09-28): is the line's sheet found, and which row is used?
  | "line_tapped"             // edit mode: a tap on the drawn line opened its sheet
  | "line_via_asked"          // „Virzīt caur citu vietu”: the line grabbed at the tapped spot, waiting for the tap where to ride through
  | "line_point_added";       // „Pievienot punktu šeit”: a pass-through point on the line, committed at once
  // ── /line-sheet ──

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

let started = false;

/** Called once from the provider; safe to call again. */
export function startAnalytics(): void {
  if (started || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    capture_pageview: true,
    capture_pageleave: true,
    // Anonymous riders stay anonymous; nobody signs in to Mopik.
    person_profiles: "identified_only",
    // Replays are the "ieraksti": on, with text in inputs masked (places are
    // fine to see, a typed message is not).
    session_recording: { maskAllInputs: false, maskInputOptions: { password: true, email: true } },
    autocapture: false,
  });
  started = true;
}

export function track(event: AnalyticsEvent, props: Record<string, string | number | boolean | null | undefined> = {}): void {
  if (typeof window === "undefined") return;
  try { if (started) posthog.capture(event, props); } catch { /* analytics never breaks the ride */ }
  try { window.gtag?.("event", event, props); } catch { /* same */ }
}
