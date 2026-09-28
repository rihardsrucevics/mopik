"use client";

import type { RefObject } from "react";
import type * as maplibregl from "maplibre-gl";
import type { ProposalView } from "@/lib/map/edit-proposal";

/**
 * The proposed edit on the map (Phase 1, docs/DESIGN-route-editing.md B4):
 * the new stretch in its real surface colours with a yellow halo over the
 * ride dimmed to 0.3, gone the moment `proposal` is null.
 *
 * CONTRACT C1: a no-op stub, called once from `RouteMap`. Owned and
 * implemented by P1-D.
 */
export function useProposalLayer(
  mapRef: RefObject<maplibregl.Map | null>,
  ready: boolean,
  proposal: ProposalView | null,
): void {
  void mapRef; void ready; void proposal;
}
