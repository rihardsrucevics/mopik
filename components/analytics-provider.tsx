"use client";

import { useEffect } from "react";
import { startAnalytics } from "@/lib/analytics";

/** Starts PostHog after hydration. Renders nothing. */
export function AnalyticsProvider() {
  useEffect(() => { startAnalytics(); }, []);
  return null;
}
