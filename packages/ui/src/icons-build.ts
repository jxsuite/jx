/**
 * The pure half of the icon build: how a Phosphor asset is named, and how its path data is lifted
 * out of the SVG. `scripts/build-icons.ts` supplies the file system; this module can be tested with
 * strings.
 */

/** The three weights the kit ships. `fill` is the "active" drawing of the same glyph. */
export const ICON_WEIGHTS = ["regular", "bold", "fill"] as const;
export type IconWeight = (typeof ICON_WEIGHTS)[number];

/** `name → weights` as authored in `icons/list.json`. */
export type IconList = Record<string, IconWeight[]>;

/** The committed manifest: one path-data string per name and weight, on one shared viewBox. */
export interface IconManifest {
  viewBox: string;
  icons: Record<string, Partial<Record<IconWeight, string>>>;
}

/** The Phosphor viewBox every glyph is drawn on. */
export const ICON_VIEW_BOX = "0 0 256 256";

/**
 * The asset path inside `@phosphor-icons/core` for a name and weight. Regular glyphs carry no
 * suffix; every other weight is `<name>-<weight>.svg` under its own directory.
 */
export function assetPath(name: string, weight: IconWeight): string {
  return weight === "regular"
    ? `assets/regular/${name}.svg`
    : `assets/${weight}/${name}-${weight}.svg`;
}

const PATH_D = /<path\b[^>]*\bd="([^"]+)"/g;

/**
 * Every `d` attribute in an SVG, joined into one path-data string. A glyph is one `<path>` in
 * practice; a second path starts with its own `M`, so concatenation draws both.
 *
 * @throws {Error} When the SVG carries no path at all — an icon that draws nothing is a build
 *   error.
 */
export function extractPathData(svg: string): string {
  const parts: string[] = [];
  for (const match of svg.matchAll(PATH_D)) {
    parts.push(match[1]!);
  }
  if (parts.length === 0) {
    throw new Error("icon svg carries no <path d>");
  }
  return parts.join(" ");
}

/**
 * Build the manifest from the list, reading each asset through `read`. Names and weights are
 * emitted sorted, so the committed file is stable across runs.
 */
export function buildManifest(
  list: IconList,
  read: (relativePath: string) => string,
): IconManifest {
  const icons: IconManifest["icons"] = {};
  for (const name of Object.keys(list).toSorted()) {
    const weights = list[name]!;
    const entry: Partial<Record<IconWeight, string>> = {};
    for (const weight of ICON_WEIGHTS) {
      if (!weights.includes(weight)) {
        continue;
      }
      entry[weight] = extractPathData(read(assetPath(name, weight)));
    }
    icons[name] = entry;
  }
  return { icons, viewBox: ICON_VIEW_BOX };
}
