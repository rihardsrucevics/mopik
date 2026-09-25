/**
 * Confirming a batch of new stops in edit mode, and what the map says while
 * it is routed (2026-09-25).
 *
 * The bug: ✓ on a batch turned its stops into confirmed rows at once, so for
 * as long as the re-route took they were numbered pins off the line with ↶
 * hidden — on a phone the editor is full screen and the panel that said
 * „Pārrēķinu posmu…” was behind it. A refusal re-seeded the rows (the stops
 * vanished, the reason unseen), and a batch confirmed while another change
 * was still routing was dropped without a word, its pins left off the line.
 *
 * The rule now, pure and tested (`scripts/batch-commit.test.ts`):
 * - ✓ is taken only when nothing is being routed; the batch stays pending
 *   (dashed pins) while its stretch is routed, and ✓ says it is working;
 * - the line landing clears the batch;
 * - a refusal keeps it pending, and the reason is said on the map.
 */
export type BatchCommit = { committing: boolean };

export type BatchEvent =
  | { type: "confirm"; busy: boolean }
  | { type: "landed" }
  | { type: "refused" };

export function stepBatch(state: BatchCommit, event: BatchEvent): { state: BatchCommit; send: boolean; clearBatch: boolean } {
  switch (event.type) {
    case "confirm":
      if (state.committing || event.busy) return { state, send: false, clearBatch: false };
      return { state: { committing: true }, send: true, clearBatch: false };
    case "landed":
      return { state: { committing: false }, send: false, clearBatch: true };
    case "refused":
      return { state: { committing: false }, send: false, clearBatch: false };
  }
}

/** What the edit map's notice line says: the routing in progress, else the last verdict, else what it said before. */
export function editNotice<N extends { text: string; title: string }>(params: {
  rerouting: boolean;
  note: string | null;
  routingText: string;
  base: N | null | undefined;
}): { text: string; title: string } | null {
  if (params.rerouting) return { text: params.routingText, title: params.routingText };
  if (params.note) return { text: params.note, title: params.note };
  return params.base ?? null;
}
