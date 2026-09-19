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
  | "generation_cancelled"   // "Atcelt" on the loader; props: case (first_from_form → back to the form | later → stays in the chat)
  | "overlap_chat_shown"     // best version retraces > 20 %
  | "route_version_selected" // Taisnākā / Līkumotākā / Sarežģītākā
  | "alternative_cycled"      // a card swapped to another ride of its kind; props: variant, to
  | "gpx_downloaded"         // the GPX button; props: variant, km, minutes, repeated
  | "beer_popup"             // the thank-you shown
  | "beer_click"             // the Revolut link tapped
  | "instagram_opened"        // "Raksti mums" tapped; props: from (header|beer)
  | "map_fullscreen"         // phone map expanded
  | "route_shared"           // share button; props: method (share|copy), km, variant
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
  | "suggestion_added"        // "Pievienot" in Ieteikumi: a suggested place became a via point; props: via_count
  | "suggestion_shown"        // "Kartē" in Ieteikumi: the map flew to a suggestion without changing the ride; props: kind
  | "detour_previewed"       // a sight was ticked and its detour spliced into the drawn line; props: pois, delta_km
  | "trip_type_changed"       // props: to (one_way|round_trip) — is the new default right?
  | "ride_edit_opened"        // "Rediģēt formā" on a shared or saved ride; props: from, saved
  | "shared_correction_sent" // "Ko mainīt?" typed on a shared ride's page; props: length, saved
  | "edited_ride_kept"        // the edit produced a new ride and the original stays
  | "edited_ride_replaced";   // the edit replaced the ride it started from

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
