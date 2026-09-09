/// <reference lib="dom" />
/**
 * The **Project Styles** canvas — the element catalogue with its per-file style defaults, rendered
 * through the IFRAME canvas pipeline: a specimen document is generated parent-side
 * ({@link file://./stylebook-doc.ts}) and mounted per breakpoint panel via `mountStylebookCanvas`,
 * so each panel is a real width-sized viewport and `@media` blocks evaluate for real (no JS
 * flatten). Hits decode to tags in the host and route back here through the injected stylebook-hit
 * handler (`setStylebookHitHandler` in studio.ts).
 *
 * **The chrome bar over the stage is a Jx document** (`surfaces/stylebook-chrome.json`, mounted by
 * `surfaces/stylebook-chrome.ts`) in a host this module owns and hands to lit as a child value. The
 * STAGE beneath it stays a lit template, and cannot be anything else here: its artboards are
 * `TemplateResult`s handed in by `canvas/canvas-render.ts` through {@link StylebookCtx}, and
 * `.panzoom-wrap` is the class `canvas/canvas-utils.ts` measures the pan transform against. Both
 * belong to the canvas rather than to this surface, so they move when the canvas does.
 *
 * Every identifier here still says `stylebook`, and that is deliberate: `"stylebook"` is the
 * `CANVAS_MODES` wire value this module mounts against, shared with `dist/iframe-entry.js`. The
 * user-facing name is {@link PROJECT_STYLES_TITLE} and nothing a reader sees may be spelled from
 * the wire value — see {@link file://../style/project-styles.ts}.
 */

import { html, render as litRender } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { ref } from "lit-html/directives/ref.js";

import { projectState, updateSession } from "../store";
import { createStylebookChromeSurface } from "../surfaces/stylebook-chrome";
import type { StylebookChromeSurface } from "../surfaces/stylebook-chrome";
import type { CanvasSurface } from "../canvas/canvas-surface";
import { tabOfPane } from "../canvas/canvas-surface";
import { activeTab } from "../workspace/workspace";
import { shell } from "../shell";
import { componentRegistry } from "../files/components";
import { getEffectiveMedia, getEffectiveStyle } from "../site-context";
import { parseMediaEntries } from "../utils/canvas-media";
import { mediaDisplayName } from "./shared";
import { buildStylebookDoc } from "./stylebook-doc";
import { PROJECT_STYLES_TITLE } from "../style/project-styles";
import { mountStylebookCanvas, panToStylebookTag } from "../canvas/iframe-host";
import stylebookMeta from "../../data/stylebook-meta.json";
import type { TemplateResult } from "lit-html";
import type { CanvasPanel } from "../types";

export interface StylebookEntry {
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
  style?: string;
  children?: StylebookEntry[];
}

interface StylebookCtx {
  canvasPanelTemplate: (
    mediaName: string | null,
    label: string | null,
    fullWidth: boolean,
    width?: number | null,
  ) => { tpl: TemplateResult; panel: CanvasPanel };
  applyTransform: (surface: CanvasSurface) => void;
  observeCenterUntilStable: (surface: CanvasSurface) => void;
  updateActivePanelHeaders: (surface: CanvasSurface) => void;
}

export { default as stylebookMeta } from "../../data/stylebook-meta.json";

/**
 * The chrome bar standing over each pane's stage.
 *
 * Keyed on the stage rather than held in a module slot: two panes can both be showing Project
 * Styles, and one slot would hand the second pane's stage the first pane's bar — the defect rule 2
 * of `scripts/check-pane-singletons.ts` is about. A `WeakMap` also needs no teardown hook, because
 * the record goes when the pane does.
 */
const chromeBars = new WeakMap<CanvasSurface, StylebookChromeSurface>();

/**
 * This stage's chrome bar, created on first use and updated after.
 *
 * The bar is a Jx document (`surfaces/stylebook-chrome.json`) in a host this module owns, so what
 * comes back is a NODE for the template below to interpolate — not markup. Everything the bar says
 * is decided here: both names are spelled from {@link PROJECT_STYLES_TITLE}, so the surface has one
 * name and not one per control, and the wire value never surfaces.
 */
function chromeBar(surface: CanvasSurface): HTMLElement {
  const view = {
    customizedHint: "Show only the elements this file has already styled",
    customizedLabel: "Customized",
    customizedOnly: shell.stylebook.customizedOnly,
    filter: shell.stylebook.filter,
    filterLabel: `Filter the ${PROJECT_STYLES_TITLE} catalogue`,
    title: PROJECT_STYLES_TITLE,
  };
  const standing = chromeBars.get(surface);
  if (standing) {
    standing.update(view);
    return standing.host;
  }
  const created = createStylebookChromeSurface(view, {
    setFilter: (value) => {
      shell.stylebook.filter = value;
    },
    toggleCustomized: () => {
      shell.stylebook.customizedOnly = !shell.stylebook.customizedOnly;
    },
  });
  chromeBars.set(surface, created);
  return created.host;
}

/**
 * Render the stylebook mode into the canvas: chrome bar + one iframe panel per breakpoint, all
 * mounting the SAME generated specimen document.
 *
 * @param {StylebookCtx} ctx
 */
export function renderStylebookMode(surface: CanvasSurface, ctx: StylebookCtx) {
  const canvasWrap = surface.wrap;
  /* THIS stage's tab. It was `activeTab.value` — the focused pane's — so a Stylebook drawn in the
     unfocused pane took its `$media` breakpoints from whatever document the keyboard was in, and
     rebuilt its specimen columns at the other document's widths. Found by the fourth rule in
     `scripts/check-pane-singletons.ts`, which is the whole reason that rule is per-FUNCTION: this
     module is not a singleton and its other focus read is legitimate. */
  const tab = tabOfPane(surface.paneId);
  const filter = shell.stylebook.filter.toLowerCase();
  const { customizedOnly } = shell.stylebook;

  const effectiveMedia = getEffectiveMedia(tab?.doc.document?.$media);
  const { sizeBreakpoints, baseWidth } = parseMediaEntries(effectiveMedia);
  const hasMedia = sizeBreakpoints.length > 0;

  /* The bar is a document in a node this module owns, so it is interpolated rather than authored:
     lit inserts a Node it is given instead of cloning it, and re-inserting the same one is a no-op,
     so the field keeps its caret across the stage rebuild a keystroke in it causes. */
  const chromeBarNode = chromeBar(surface);

  (canvasWrap as HTMLElement).style.overflow = "hidden";

  /** @type {{ name: string; displayName: string; width: number }[]} */
  const allPanelDefs = [];
  if (hasMedia) {
    allPanelDefs.push({
      displayName: mediaDisplayName("--"),
      name: "base",
      width: baseWidth,
    });
    for (const bp of sizeBreakpoints) {
      allPanelDefs.push({
        displayName: mediaDisplayName(bp.name),
        name: bp.name,
        width: bp.width,
      });
    }
  }

  /** @type {{ tpl: import("lit-html").TemplateResult; panel: CanvasPanel }[]} */
  let panelEntries;
  if (!hasMedia) {
    const hasBaseWidth = effectiveMedia && effectiveMedia["--"];
    const label = hasBaseWidth ? `${mediaDisplayName("--")} (${baseWidth}px)` : null;
    const entry = ctx.canvasPanelTemplate(
      hasBaseWidth ? "base" : null,
      label,
      !hasBaseWidth,
      hasBaseWidth ? baseWidth : undefined,
    );
    panelEntries = [{ panel: entry.panel, tpl: entry.tpl }];
  } else {
    panelEntries = allPanelDefs.map((def) => {
      const label = `${def.displayName} (${def.width}px)`;
      const { tpl, panel } = ctx.canvasPanelTemplate(def.name, label, false, def.width);
      return { panel, tpl };
    });
  }

  litRender(
    html`
      ${chromeBarNode}
      <div
        class="panzoom-wrap"
        style="transform-origin:0 0;padding-top:40px"
        ${ref((el) => {
          if (el) {
            surface.panzoomWrap = el as HTMLDivElement;
          }
        })}
      >
        ${repeat(
          panelEntries,
          /* Keyed on mediaName. Each entry owns a canvas IFRAME, and the breakpoint set changes
             with the project's media definitions — so position-based reuse hands one breakpoint's
             iframe to another's width. That is a live document rendered at the wrong viewport,
             not a cosmetic diff. */
          (e) => e.panel.mediaName,
          (e) => e.tpl,
        )}
      </div>
    `,
    /** @type {HTMLElement} */ canvasWrap,
  );

  // ONE generated doc shared by every panel — per-panel @media differentiation comes from each
  // Iframe's real viewport width, not from a per-panel style flatten.
  const generated = buildStylebookDoc({
    components: componentRegistry,
    customizedOnly: Boolean(customizedOnly),
    effectiveMedia: effectiveMedia ?? {},
    effectiveStyle: getEffectiveStyle(tab?.doc.document?.style),
    filter,
    meta: stylebookMeta as { $sections: { label: string; elements: StylebookEntry[] }[] },
    projectRoot: projectState?.projectRoot ?? null,
  });

  const { panels } = surface;
  for (const { panel } of panelEntries) {
    panels.push(panel);
    mountStylebookCanvas(
      surface.renderGeneration,
      generated,
      panel.canvas as HTMLElement,
      panel._width,
    );
  }
  if (hasMedia) {
    ctx.updateActivePanelHeaders(surface);
  }

  ctx.applyTransform(surface);
  ctx.observeCenterUntilStable(surface);
}

/**
 * Select a tag in the stylebook — shared by the canvas hit handler (via studio's
 * setStylebookHitHandler wiring), the stylebook layers panel, and the style panel. The host's
 * selection watcher tracks `shell.stylebook.selection` and measures the selected tag's card, so no
 * direct overlay drawing happens here.
 *
 * @param {string} tag
 * @param {string | null} [media]
 */
export function selectStylebookTag(tag: string, media?: string | null, { panCanvas = false } = {}) {
  shell.stylebook.selection = tag;
  updateSession(activeTab.value, {
    // The ROOT path, not an empty selection: stylebook mode has always parked the selection on the
    // Document element while the Style tab edits a TAG, and widening the field to a list changed
    // Which literal spells that — `[[]]` is one selected path, the root — not what it means.
    selection: [[]],
    ui: {
      activeSelector: tag,
      rightTab: "style",
      ...(media !== undefined ? { activeMedia: media } : {}),
    },
  });

  if (tag && panCanvas) {
    panToStylebookTag(tag);
  }
}

/** Re-exported for legacy consumers (the preview now lives in component-preview.ts). */
export { renderComponentPreview } from "./component-preview";
