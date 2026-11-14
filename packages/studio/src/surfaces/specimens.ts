/**
 * The surface specimens, as a table both realms read (studio.md §4.6).
 *
 * The parent asks {@link specimenOf} whether the document a tab holds is one of Studio's own
 * surfaces with a specimen, and names it on the render it posts. The canvas frame looks the name up
 * here and imports the module, one chunk per specimen, on first use. The variant names are data in
 * the table for the parent's sake: it lists and refuses them without loading a specimen, and
 * `surface-specimens.test.ts` holds each list to the module's own.
 *
 * Hand-written, like the kit's loader tables, and held to the directory by the same suite: a
 * `*.specimen.ts` with no entry fails it, and so does an entry with no file.
 *
 * @docs extending/ui-kit
 */
import type { SurfaceSpecimen } from "./specimen";

/** One specimen: the variants it declares, and the module that makes its scopes. */
export interface SpecimenEntry {
  variants: readonly string[];
  /**
   * The width the surface is drawn at, in CSS pixels, for one that spans the window it sits in and
   * so has no layout at the canvas's default column width. Absent for a surface that is as wide as
   * its content or its panel.
   */
  width?: number;
  load: () => Promise<{ specimen: SurfaceSpecimen }>;
}

const TABLE = {
  "ai-model-picker": {
    load: () => import("./ai-model-picker.specimen"),
    variants: ["failed"],
  },
  menu: { load: () => import("./menu.specimen"), variants: ["empty"] },
  "panel-data": { load: () => import("./panel-data.specimen"), variants: ["empty"] },
  "progress-modal": {
    load: () => import("./progress-modal.specimen"),
    variants: ["cannot-stop"],
  },
  "settings-deploy": {
    load: () => import("./settings-deploy.specimen"),
    variants: ["failed"],
  },
  statusbar: {
    load: () => import("./statusbar.specimen"),
    variants: ["no-document"],
    width: 1200,
  },
  "style-panel": { load: () => import("./style-panel.specimen"), variants: ["empty"] },
} satisfies Readonly<Record<string, SpecimenEntry>>;

/** Surface name to specimen. The name is the surface file's, without `.json`. */
export const SPECIMENS: ReadonlyMap<string, SpecimenEntry> = new Map(Object.entries(TABLE));

/**
 * The `url` of Studio's own project (`packages/studio/project.json`). Identity, not location: a
 * copy of the project anywhere on disk is still Studio, which is what lets the screenshot lane's
 * scratch copy draw the same specimens.
 */
export const STUDIO_PROJECT_URL = "https://jxsuite.com/studio";

const SURFACE_FILE = /^src\/surfaces\/([a-z0-9-]+)\.json$/u;

/**
 * The specimen a document resolves with: the surface's name when the open project is Studio's and
 * the document is one of its surfaces with a specimen, and null for everything else, which is every
 * other project and every other file.
 *
 * @param {string | undefined} projectUrl - The open project's `url`
 * @param {string | null | undefined} documentPath - The document's path under the project root
 * @returns {string | null}
 */
export function specimenOf(
  projectUrl: string | undefined,
  documentPath: string | null | undefined,
): string | null {
  if (projectUrl !== STUDIO_PROJECT_URL || !documentPath) {
    return null;
  }
  const relative = documentPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const name = SURFACE_FILE.exec(relative)?.[1];
  return name !== undefined && SPECIMENS.has(name) ? name : null;
}

/**
 * The variants a specimen declares, for a name {@link specimenOf} answered; empty for any other.
 *
 * @param {string} name - A surface name
 * @returns {readonly string[]}
 */
export function specimenVariants(name: string): readonly string[] {
  return SPECIMENS.get(name)?.variants ?? [];
}

/**
 * The width a specimen's surface is drawn at, or null for one the canvas sizes as any document.
 *
 * @param {string} name - A surface name
 * @returns {number | null}
 */
export function specimenWidth(name: string): number | null {
  return SPECIMENS.get(name)?.width ?? null;
}
