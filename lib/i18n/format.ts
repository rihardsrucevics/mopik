/**
 * Placeholder interpolation for the interface strings.
 *
 * The dictionary in `messages.ts` writes its variable parts as `{n}`, `{place}`
 * and the like, and the call sites used to chain `.replace("{n}", …)` per
 * placeholder — which reads badly at three variables and silently does nothing
 * when a translation spells the placeholder differently. `fi` substitutes them
 * all in one pass. An unknown placeholder is left standing rather than blanked:
 * a visible `{place}` in the interface names the bug, an empty gap hides it.
 */
export function fi(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
