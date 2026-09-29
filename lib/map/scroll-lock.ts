/**
 * The page under the full-screen map stays where it is (backlog 51; rider's
 * iPhone, 2026-09-30: "dragging scrolls the page itself").
 *
 * `body { overflow: hidden }` alone was the lock. It stops a wheel on the
 * desktop, but not everything that moves a page: iOS Safari scrolls the
 * document under a fixed layer from a touch that starts on something that
 * is not the canvas, and the browser itself scrolls it to bring a focused
 * element into view (a tap on the map canvas, which has a tabindex, moved
 * the page 196 px in the smoke run). The rider then closes full screen onto
 * a page somewhere else, or sees it move behind the map.
 *
 * The lock, for as long as the full-screen map is open:
 * - `overflow: hidden` on both `html` and `body`, `overscroll-behavior: none`;
 * - a non-passive `touchmove` on the document that cancels a touch's scroll
 *   unless it is inside a list that really scrolls (the field's suggestions);
 * - any scroll that happens anyway is put back at once;
 * - on unlock, the styles as they were and the page where it was.
 */

/** Whether `el` (or an ancestor up to `root`) scrolls on its own: its touch is its own, not the page's. */
export function insideScroller(el: Element | null, root: Element | null, style: (e: Element) => { overflowY: string } = (e) => getComputedStyle(e)): boolean {
  for (let e = el; e && e !== root; e = e.parentElement) {
    const oy = style(e).overflowY;
    if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 1) return true;
  }
  return false;
}

export function lockPageScroll(root: HTMLElement | null): () => void {
  if (typeof window === "undefined") return () => {};
  const html = document.documentElement;
  const body = document.body;
  const x = window.scrollX;
  const y = window.scrollY;
  const was = { html: html.style.overflow, body: body.style.overflow, htmlOs: html.style.overscrollBehavior, bodyOs: body.style.overscrollBehavior };
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
  body.style.overscrollBehavior = "none";
  const onTouchMove = (e: TouchEvent) => {
    if (!e.cancelable) return;
    if (insideScroller(e.target as Element | null, root)) return;
    e.preventDefault();
  };
  const onScroll = () => { if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y); };
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("scroll", onScroll);
  return () => {
    document.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("scroll", onScroll);
    html.style.overflow = was.html;
    body.style.overflow = was.body;
    html.style.overscrollBehavior = was.htmlOs;
    body.style.overscrollBehavior = was.bodyOs;
    window.scrollTo(x, y);
  };
}
