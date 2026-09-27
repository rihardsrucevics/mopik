/**
 * The page must not zoom while the map is full screen on a phone — and when it
 * has zoomed anyway, it must come back by itself (rider, 2026-09-27, iPhone:
 * "I accidentally zoom the page — the whole UI — and then I can barely get
 * back").
 *
 * Why it got stuck there, and not on the inline map: full screen is a
 * `fixed inset-0` layer with the body's scroll off, and every pixel of it is
 * either the MapLibre canvas — `touch-action: none`, so a pinch on it zooms the
 * map, never the page — or the 56 px chrome over it. Once iOS had zoomed the
 * page (focusing the 14 px map field, or a pinch / double-tap that landed on
 * the field, the legend or a button), the only surface that could pinch it
 * back out was that chrome, now enlarged and half off the screen.
 *
 * Three layers, none of which turns off zoom for the site:
 *  1. The map field is 16 px on a phone, so focusing it never auto-zooms.
 *  2. Full screen is `touch-action: none` (its scrolling lists `pan-y`), and
 *     Safari's own `gesturestart` is cancelled while it is open: a pinch or a
 *     double-tap on the chrome does nothing to the page. The map's pinch runs
 *     on touch events on its canvas and is untouched.
 *  3. If the page is zoomed anyway — it was zoomed before full screen opened,
 *     or some path we did not foresee — the zoom is reset: on entering full
 *     screen, on leaving it, and whenever the visual viewport reports a zoom
 *     while no field is being typed in. The reset is the one lever iOS gives
 *     a page: add `maximum-scale=1` to the viewport meta for a moment, which
 *     makes Safari fit the page to the screen, then put the meta back exactly
 *     as it was, so the rider can pinch-zoom the site again.
 */

/** Above this the page counts as zoomed; below is rounding noise. */
export const ZOOMED_SCALE = 1.01;

/** How long `maximum-scale=1` stays in the meta before it is restored. */
export const RESET_HOLD_MS = 300;

export function isPageZoomed(scale: number | undefined | null): boolean {
  return typeof scale === "number" && Number.isFinite(scale) && scale > ZOOMED_SCALE;
}

/**
 * The viewport content with `maximum-scale=1` — any existing maximum-scale
 * (and user-scalable, which would outlive the reset's intent) replaced, the
 * rest kept in order.
 */
export function withMaximumScaleOne(content: string): string {
  const kept = content
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^(maximum-scale|user-scalable)\s*=/i.test(part));
  return [...kept, "maximum-scale=1"].join(", ");
}

/** Typing in a field: iOS may hold a zoom for it, and a reset would jump under the caret. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file", "image"].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

let resetting = false;

/**
 * Bring a zoomed page back to scale 1 (iOS Safari). Does nothing when the page
 * is not zoomed, when there is no viewport meta, or while a reset is running.
 */
export function resetPageZoom(): void {
  if (typeof window === "undefined" || resetting) return;
  if (!isPageZoomed(window.visualViewport?.scale)) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute("content") ?? "";
  resetting = true;
  meta.setAttribute("content", withMaximumScaleOne(original));
  window.setTimeout(() => {
    meta.setAttribute("content", original);
    resetting = false;
  }, RESET_HOLD_MS);
}

/**
 * While the phone map is full screen: cancel Safari's page pinch and undo any
 * zoom that happens anyway. Returns the cleanup, which also resets the zoom on
 * the way out, so leaving full screen never leaves the page enlarged.
 */
export function guardFullscreenZoom(): () => void {
  const cancel = (e: Event) => e.preventDefault();
  // Safari-only events; elsewhere they never fire. The map's pinch is driven
  // by touch events on its canvas and does not see these.
  document.addEventListener("gesturestart", cancel, { passive: false });
  document.addEventListener("gesturechange", cancel, { passive: false });

  let timer: number | undefined;
  const check = () => {
    window.clearTimeout(timer);
    // After the keyboard has gone and iOS has settled the viewport.
    timer = window.setTimeout(() => {
      if (!isEditable(document.activeElement)) resetPageZoom();
    }, 150);
  };
  const vv = window.visualViewport;
  vv?.addEventListener("resize", check);
  document.addEventListener("focusout", check);
  resetPageZoom();

  return () => {
    document.removeEventListener("gesturestart", cancel);
    document.removeEventListener("gesturechange", cancel);
    vv?.removeEventListener("resize", check);
    document.removeEventListener("focusout", check);
    window.clearTimeout(timer);
    resetPageZoom();
  };
}
