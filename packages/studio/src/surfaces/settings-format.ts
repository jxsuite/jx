/// <reference lib="dom" />
/**
 * The Document format surface: Project Settings' default notation and the project-wide conversion,
 * as a Jx document.
 *
 * `settings/format-section.ts` keeps the section: what the census says, what reaches
 * `defaults.format`, what a failed write says and what Convert does. This module hands the document
 * a projection and is otherwise the Deploy surface's twin: `update` takes a patch, and a value the
 * reader moved is echoed to the scope by the section before it decides about it.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import formatDoc from "./settings-format.json";
import type { SurfaceHandle, SurfaceOption } from "../ui/surface";

registerSurface("settings-format", formatDoc);

/** What the section says the surface should be showing right now. */
export interface FormatValues {
  /** The default notation, `jxn` or `json`. */
  format: string;
  /** Every notation it may be. */
  formats: SurfaceOption[];
  /** How the project's documents divide, in a sentence. */
  summary: string;
  /** Whether any document is not in the chosen notation. */
  canConvert: boolean;
  /** The button's words. */
  convertLabel: string;
  /** What the last write failed with, or `""`. */
  error: string;
}

/** What the reader can do here. */
export interface FormatActions {
  setFormat: (value: string) => void;
  convert: () => void;
}

export interface FormatSurfaceHandle {
  /** Bring the mounted document up to date. A key left out is left alone. */
  update: (patch: Partial<FormatValues>) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads. `hasError` is derived: `$switch` is a document's only conditional. */
export interface FormatScope extends FormatValues, FormatActions {
  hasError: boolean;
}

/** Write a patch into the scope. */
function project(scope: FormatScope, patch: Partial<FormatValues>): void {
  if (patch.format !== undefined) {
    scope.format = patch.format;
  }
  if (patch.formats !== undefined) {
    scope.formats = patch.formats;
  }
  if (patch.summary !== undefined) {
    scope.summary = patch.summary;
  }
  if (patch.canConvert !== undefined) {
    scope.canConvert = patch.canConvert;
  }
  if (patch.convertLabel !== undefined) {
    scope.convertLabel = patch.convertLabel;
  }
  if (patch.error !== undefined) {
    scope.error = patch.error;
    scope.hasError = patch.error !== "";
  }
}

/** Mount the Document format document into `container`, clearing it first. */
export function mountFormatSurface(
  container: HTMLElement,
  values: FormatValues,
  actions: FormatActions,
): FormatSurfaceHandle {
  const scope: FormatScope = reactive<FormatScope>({
    canConvert: false,
    convert: actions.convert,
    convertLabel: "",
    error: "",
    format: "",
    formats: [],
    hasError: false,
    setFormat: actions.setFormat,
    summary: "",
  });
  project(scope, values);

  container.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("settings-format", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    connected: () =>
      !disposed &&
      (mounted === null
        ? container.childNodes.length === 0
        : mounted.root.parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (patch) => project(scope, patch),
  };
}
