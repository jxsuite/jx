/**
 * Port of `isAppRegionDragTarget` from `vendor/electrobun/package/src/preload/dragRegions.ts`
 * (lines 416-437), kept minimal and faithful on purpose — a regression guard for commandbar.ts must
 * encode Electrobun's real ancestry-walk algorithm, not just check that some CSS rule exists.
 * Re-diff against the vendor file whenever packages/desktop's Electrobun pin changes.
 *
 * Not imported from the vendor module directly: `dragRegions.ts` pulls in `./internalRpc`, which is
 * native-bridge-coupled and not meant to run outside a real Electrobun webview, and
 * `packages/studio` has no dependency on `packages/desktop`'s vendored, version-pinned copy.
 */

const DRAG_CLASS = "electrobun-webkit-app-region-drag";
const NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";
const MIRRORED_PROPERTY = "--electrobun-app-region";
const APP_REGION_PROPERTIES = [
  MIRRORED_PROPERTY,
  "-webkit-app-region",
  "app-region",
  "window-drag",
];

type AppRegion = "drag" | "no-drag" | null;

function normalizedRegion(value: string | null | undefined): AppRegion {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "drag" || normalized === "no-drag") {return normalized;}
  return null;
}

function inlineRegion(element: Element): AppRegion {
  const style = element.getAttribute?.("style");
  if (!style) {return null;}
  const match = style.match(
    /(?:^|;)\s*(?:-webkit-app-region|app-region|window-drag)\s*:\s*(no-drag|drag)\b/i,
  );
  return normalizedRegion(match?.[1]);
}

function computedRegion(element: Element): AppRegion {
  try {
    const style = window.getComputedStyle(element);
    for (const propertyName of APP_REGION_PROPERTIES) {
      const region = normalizedRegion(style.getPropertyValue(propertyName));
      if (region) {return region;}
    }
  } catch {
    // Detached or synthetic elements may not have a computed style.
  }
  return null;
}

/** True when `target` (or one of its ancestors) is a drag handle, per Electrobun's own walk. */
export function isAppRegionDragTarget(target: EventTarget | null): boolean {
  let element: Element | null =
    target && typeof (target as Element).getAttribute === "function" ? (target as Element) : null;
  let foundDragRegion = false;

  while (element) {
    if (element.classList?.contains(NO_DRAG_CLASS)) {return false;}
    if (element.classList?.contains(DRAG_CLASS)) {foundDragRegion = true;}

    const region = inlineRegion(element) ?? computedRegion(element);
    if (region === "no-drag") {return false;}
    if (region === "drag") {foundDragRegion = true;}

    element = element.parentElement;
  }

  return foundDragRegion;
}
