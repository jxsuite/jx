/// <reference lib="dom" />
/**
 * The Overview surface: Project Settings' identity section, as a Jx document over the kit.
 *
 * This is the adapter. `settings/general-settings.ts` keeps the section — what a value means, what
 * is refused, what is written to `project.json` and what a failed write says — and hands this
 * module a projection: five values, the styles command's title and whether it can be run, and the
 * ONE failure the section is currently showing. The document renders that.
 *
 * The projection is flattened here rather than in the document because a document has no
 * conditional beyond `$switch` over a value: "is there an error, and is it this control's" is two
 * questions, so the adapter answers them and the surface reads booleans. That is the same division
 * `surfaces/about.ts` draws — the state machine on this side, the markup on the other.
 *
 * **A control the reader has typed into is not the scope's**, and that is why `update` takes a
 * patch rather than a whole projection. The section echoes what a control now holds before it
 * decides what to do with it, so that a refused or normalised value is a real change to the scope
 * and the runtime writes it back — `live()` did this for the lit template, and a binding that never
 * moved would otherwise leave a rejected value sitting in the field.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import overviewDoc from "./settings-overview.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-overview", overviewDoc as unknown as JxDocument);

/** Which control a failure belongs under. `"section"` puts it at the top of the section. */
export type OverviewErrorField = "name" | "description" | "url" | "favicon" | "section";

/** The one failure the section is showing, and where it belongs. */
export interface OverviewError {
  field: OverviewErrorField;
  message: string;
}

/** What the section says the surface should be showing right now. */
export interface OverviewValues {
  name: string;
  description: string;
  url: string;
  /** The configured favicon path, or `""` for none. */
  favicon: string;
  /** The `styles.open` record's own title, which is the button's tooltip. */
  stylesTitle: string;
  stylesDisabled: boolean;
  /** The last failure, or `null` when the last write succeeded. */
  error: OverviewError | null;
}

/** What a control can ask the section to do. Every one of them is a decision the section owns. */
export interface OverviewActions {
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setUrl: (value: string) => void;
  uploadFavicon: () => void;
  openStyles: () => void;
}

export interface OverviewSurfaceHandle {
  /** Bring the mounted document up to date. A key left out is left alone. */
  update: (patch: Partial<OverviewValues>) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/**
 * The scope the document reads: one field per binding, because `$switch` is the only conditional a
 * document has and `error.field === "name"` is not a value it can switch on.
 */
interface OverviewScope extends Record<string, unknown> {
  nameValue: string;
  nameError: string;
  nameInvalid: boolean;
  descriptionValue: string;
  descriptionError: string;
  descriptionInvalid: boolean;
  urlValue: string;
  urlError: string;
  urlInvalid: boolean;
  favicon: string;
  hasFavicon: boolean;
  faviconError: string;
  hasFaviconError: boolean;
  sectionError: string;
  hasSectionError: boolean;
  stylesTitle: string;
  stylesDisabled: boolean;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setUrl: (value: string) => void;
  uploadFavicon: () => void;
  openStyles: () => void;
}

/** The failure's message when it belongs to `field`, and `""` when it belongs anywhere else. */
function messageFor(error: OverviewError | null, field: OverviewErrorField): string {
  return error?.field === field ? error.message : "";
}

/**
 * Write a patch into the scope.
 *
 * `error` is spread over all five of its slots at once — a failure lands under exactly one control,
 * so setting one of them without clearing the other four is how two rejections end up on screen
 * together.
 */
function project(scope: OverviewScope, patch: Partial<OverviewValues>): void {
  if (patch.name !== undefined) {
    scope.nameValue = patch.name;
  }
  if (patch.description !== undefined) {
    scope.descriptionValue = patch.description;
  }
  if (patch.url !== undefined) {
    scope.urlValue = patch.url;
  }
  if (patch.favicon !== undefined) {
    scope.favicon = patch.favicon;
    scope.hasFavicon = patch.favicon !== "";
  }
  if (patch.stylesTitle !== undefined) {
    scope.stylesTitle = patch.stylesTitle;
  }
  if (patch.stylesDisabled !== undefined) {
    scope.stylesDisabled = patch.stylesDisabled;
  }
  if (patch.error !== undefined) {
    const { error } = patch;
    scope.nameError = messageFor(error, "name");
    scope.nameInvalid = scope.nameError !== "";
    scope.descriptionError = messageFor(error, "description");
    scope.descriptionInvalid = scope.descriptionError !== "";
    scope.urlError = messageFor(error, "url");
    scope.urlInvalid = scope.urlError !== "";
    scope.faviconError = messageFor(error, "favicon");
    scope.hasFaviconError = scope.faviconError !== "";
    scope.sectionError = messageFor(error, "section");
    scope.hasSectionError = scope.sectionError !== "";
  }
}

/**
 * Mount the Overview document into `container`.
 *
 * The container is cleared first: a settings section is handed the pane's content area, and
 * whatever the last section drew into it is not this one's to keep.
 */
export function mountOverviewSurface(
  container: HTMLElement,
  values: OverviewValues,
  actions: OverviewActions,
): OverviewSurfaceHandle {
  const scope = reactive<OverviewScope>({
    descriptionError: "",
    descriptionInvalid: false,
    descriptionValue: "",
    favicon: "",
    faviconError: "",
    hasFavicon: false,
    hasFaviconError: false,
    hasSectionError: false,
    nameError: "",
    nameInvalid: false,
    nameValue: "",
    openStyles: actions.openStyles,
    sectionError: "",
    setDescription: actions.setDescription,
    setName: actions.setName,
    setUrl: actions.setUrl,
    stylesDisabled: false,
    stylesTitle: "",
    uploadFavicon: actions.uploadFavicon,
    urlError: "",
    urlInvalid: false,
    urlValue: "",
  }) as OverviewScope;
  project(scope, values);

  container.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on the element, so the mount is all this has to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody here asking them to (§1.1, "await the element"). */
  void mountSurface("settings-overview", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight this surface owns the container only for as long as the
       container is still the empty one it was handed: a settings section is drawn into the pane's
       content area, and if something else has claimed it in the meantime the document must not
       land on top of that. Once mounted, the question is simply whether the root is still there —
       a section that was switched away from had its root taken out from under it. */
    connected: () =>
      !disposed &&
      (mounted === null
        ? container.childNodes.length === 0
        : (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (patch) => project(scope, patch),
  };
}
