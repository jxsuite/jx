/**
 * Icon lookup over the committed manifest. `jx-icon` reaches this through `$src`, so the manifest
 * stays a plain import rather than a state entry: a hundred kilobytes of path data has no business
 * being a reactive object.
 *
 * @docs extending/ui-kit
 */
import { isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import manifest from "../icons/manifest.json";
import { ICON_VIEW_BOX, ICON_WEIGHTS } from "./icons-build.ts";
import type { IconManifest, IconWeight } from "./icons-build.ts";

export { ICON_VIEW_BOX, ICON_WEIGHTS } from "./icons-build.ts";
export type { IconWeight } from "./icons-build.ts";

const iconManifest: IconManifest = manifest;
const { icons } = iconManifest;

/** Every icon name the kit ships, sorted. */
export const ICON_NAMES: readonly string[] = Object.keys(icons);

/** Whether the manifest carries a glyph for the name, at the weight when one is given. */
export function hasIcon(name: string, weight?: IconWeight): boolean {
  const entry = icons[name];
  if (!entry) {
    return false;
  }
  return weight === undefined || weight in entry;
}

const warned = new Set<string>();

/**
 * The path data for a name and weight. A weight the manifest lacks falls back to `regular`, which
 * every listed icon carries; a name it lacks warns once and draws nothing, so a typo shows as a gap
 * rather than a crash or a wrong glyph.
 *
 * Called from the `jx-icon` document with the element's own `name` and `weight` state. Both are
 * declared strings, but a property write can store any value, so neither is trusted to be one.
 */
export function iconPath(name: JsonValue | undefined, weight: JsonValue | undefined): string {
  const key = isString(name) ? name : "";
  const entry = icons[key];
  if (!entry) {
    if (key && !warned.has(key)) {
      warned.add(key);
      console.warn(`jx-icon: no icon named "${key}"`);
    }
    return "";
  }
  const w = ICON_WEIGHTS.find((candidate) => candidate === String(weight)) ?? "regular";
  return entry[w] ?? entry.regular ?? "";
}

/** The viewBox `jx-icon` draws on; the manifest's, so a rebuilt manifest cannot drift from it. */
export const iconViewBox: string = iconManifest.viewBox || ICON_VIEW_BOX;
