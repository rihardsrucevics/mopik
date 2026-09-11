"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PROFILE,
  loadStoredProfile,
  normalizeProfile,
  saveStoredProfile,
  type RideProfile,
} from "@/lib/chat/ride-profile";

/**
 * The rider's profile as an external store: read from the device on first
 * client render, written back on every change. `useSyncExternalStore` gives
 * the server the default and lets React swap in the stored profile on the
 * client without a hydration error or a setState-in-effect.
 */
let current: RideProfile | null = null;
const listeners = new Set<() => void>();

function snapshot(): RideProfile {
  if (!current) current = loadStoredProfile();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRideProfile(next: RideProfile): void {
  current = normalizeProfile(next);
  saveStoredProfile(current);
  for (const listener of listeners) listener();
}

export function useRideProfile(): [RideProfile, (next: RideProfile) => void] {
  const profile = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PROFILE);
  return [profile, setRideProfile];
}
