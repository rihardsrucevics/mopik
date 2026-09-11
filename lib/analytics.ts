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
  | "overlap_chat_shown"     // best version retraces > 20 %
  | "route_version_selected" // Taisnākā / Līkumotākā / Sarežģītākā
  | "gpx_downloaded"         // the GPX button; props: variant, km, minutes, repeated
  | "beer_popup"             // the thank-you shown
  | "beer_click"             // the Revolut link tapped
  | "feedback_sent"          // feedback dialog submitted
  | "map_fullscreen"         // phone map expanded
  | "route_shared"           // share button; props: method (share|copy), km, variant
  | "shared_route_viewed"    // /r/<code> opened
  | "shared_gpx_downloaded"  // GPX from a shared page
  | "install_prompt_shown"   // Android: add-to-home-screen offered
  | "install_accepted"
  | "install_dismissed";

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
    // fine to see, the feedback form is not).
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
