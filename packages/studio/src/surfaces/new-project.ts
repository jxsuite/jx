/// <reference lib="dom" />
/**
 * The New Project wizard as a mounted document.
 *
 * `new-project/new-project-modal.ts` is the flow — it holds the step, the tab, the chosen starter
 * and the two forms behind it, decides what the AI gate answers, calls `createProject` and resolves
 * the promise its entry point returns — and this is the surface it draws into: the reactive scope
 * the document reads, the discriminants it branches on, and the mount that lives in the dialog
 * layer until the flow takes it down.
 *
 * **The flow states facts; the surface derives what the document branches on.** Which step is up,
 * which tab is chosen and whether AI is usable are the flow's; that those add up to one of five
 * bodies is {@link derive}'s, so neither the flow nor the document has to know that "the Import tab
 * with no key" and "the Agent tab with no key" are the same gate said twice.
 *
 * **Three islands, all through `onNodeCreated`.** The credentials form, the keyless Cloudflare
 * offer and the model catalogue are each a mounted document of their own with a host element the
 * controller owns, so the wizard's document renders three empty boxes and this module puts those
 * hosts inside them (specs/studio-ui-guidelines.md §9.4). A box is filled when it is created AND on
 * every update, because a controller's `render()` is what brings its own surface up to date — and
 * the placement is conditional on the host not already being there, because re-appending a node
 * that is already in place disconnects and reconnects it, which would take the caret out of the
 * field a reader is typing a key into.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts`, `surfaces/publish.ts` and `surfaces/add-repo.ts` rather than
 * reimplemented.
 *
 * @docs studio/projects/create
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import newProjectDoc from "./new-project.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

registerSurface("new-project", newProjectDoc as unknown as JxDocument);

/** One row of a kit `jx-select`, and of the tab strip: a value and what it reads. */
export interface NewProjectRow {
  value: string;
  label: string;
}

/** One card in the starter gallery — including the one that is not a starter. */
export interface NewProjectCard {
  /** The starter id, and the row's key. `""` is Start from scratch. */
  id: string;
  name: string;
  tagline: string;
  /** The tooltip: the starter's own description, or empty for the scratch card. */
  title: string;
  thumbnail: string;
  /** `"thumb"` draws the picture, `"blank"` draws the `+` well and spans the gallery. */
  art: "thumb" | "blank";
  selected: boolean;
}

/** Which body the document draws. Five, because the two gates are one sentence with two texts. */
export type NewProjectBody = "starter" | "gate" | "agent" | "import" | "params";

/**
 * What the flow knows. Every one of these may change while the wizard is up, and not one of them is
 * a decision: the words and the shapes belong to the document.
 */
export interface NewProjectView {
  /** The headline, which is also the dialog's accessible name: the two steps name themselves. */
  headline: string;
  /** The primary button's text; empty draws no primary, which is how a closed gate says so. */
  confirmLabel: string;
  /** Back, on the second step only. Empty draws nothing. */
  secondaryLabel: string;
  /** Whether the source tabs are on screen — step one only. */
  showTabs: boolean;
  /** The chosen tab's value, and the strip's rows. */
  tab: string;
  tabs: NewProjectRow[];
  /** Which body to draw. */
  body: NewProjectBody;
  /** The sentence above a closed AI gate: the two tabs ask for the same thing differently. */
  gateIntro: string;
  /** The gallery, already ordered and already carrying the scratch card. */
  cards: NewProjectCard[];
  /** The Agent tab's brief. */
  agentPrompt: string;
  /** The source this project is being made from, said on the step with no tab strip. */
  contextLabel: string;
  /** The sentence at the foot of the second step. */
  note: string;
  /** Name and slug, held by the flow so a repaint cannot lose what the reader typed. */
  name: string;
  nameError: string;
  slug: string;
  /** What the slug field is called: a folder on disk, or a repository. */
  slugLabel: string;

  // ── destination (new-project/location-fields.ts) ──────────────────────────
  /** Which destination shape this platform writes: a path, or a repository. */
  destination: "path" | "repo";
  parent: string;
  parentPlaceholder: string;
  /** This platform can open a native directory dialog. */
  canBrowse: boolean;
  browsing: boolean;
  browseLabel: string;
  owner: string;
  owners: NewProjectRow[];
  /** `"private"` or `"public"` — a value rather than a flag, because a select holds one. */
  visibility: string;
  visibilities: NewProjectRow[];
  /** The owner already has a repository of this name. Empty says nothing. */
  repoTaken: string;
  /** `Creates` or `Repository`, and the destination itself. */
  previewLabel: string;
  preview: string;
  destinationError: string;

  // ── import (new-project/import-tab.ts) ────────────────────────────────────
  url: string;
  depth: string;
  maxDepth: string;
  maxPages: string;
  breakpointMode: string;
  breakpointModes: NewProjectRow[];
  breakpointCount: string;
  maxBreakpoints: string;
  breakpointWidths: string;
  breakpointRounding: string;
  roundings: NewProjectRow[];
  /** What the chosen mode says will happen. */
  breakpointHint: string;
  aiNaming: boolean;
  /** This backend compiles, so the fidelity check can run at all. */
  canVerify: boolean;
  verify: boolean;
  minFidelity: string;
  importPrompt: string;
  importError: string;

  /** The last backend refusal, verbatim from whatever raised it. Empty draws nothing. */
  error: string;
  /** A structured `needs_installation_access` failure's install link. */
  errorInstallUrl: string;
}

/** Everything the reader can do here. Each one is a decision the flow makes, never this module. */
export interface NewProjectActions {
  /** The primary button: Next on step one, the create or the hand-off on step two. */
  confirm: () => void;
  /** Back. */
  secondary: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  closed: () => void;
  pickTab: (value: string) => void;
  pickCard: (id: string) => void;
  setAgentPrompt: (value: string) => void;
  setName: (value: string) => void;
  setSlug: (value: string) => void;
  setParent: (value: string) => void;
  browse: () => void;
  setOwner: (value: string) => void;
  setVisibility: (value: string) => void;
  setUrl: (value: string) => void;
  setDepth: (value: string) => void;
  setMaxPages: (value: string) => void;
  setBreakpointMode: (value: string) => void;
  setBreakpointCount: (value: string) => void;
  setBreakpointWidths: (value: string) => void;
  setBreakpointRounding: (value: string) => void;
  setAiNaming: (on: boolean) => void;
  setVerify: (on: boolean) => void;
  setMinFidelity: (value: string) => void;
  setImportPrompt: (value: string) => void;
}

/**
 * The three mounted documents this one hosts, each asked for its host element.
 *
 * A function rather than an element, because asking is what brings the controller's own surface up
 * to date: `render()` on all three updates the mount it already made and hands back the same node.
 * A controller with nothing to offer answers `null`, which is how the keyless offer withdraws
 * itself on a platform that brokers nothing.
 */
export interface NewProjectIslands {
  creds: () => HTMLElement | null;
  managed: () => HTMLElement | null;
  model: () => HTMLElement | null;
}

export interface NewProjectSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** What to draw before anything has landed: the flow's own view, so there is one builder of it. */
  view: NewProjectView;
  actions: NewProjectActions;
  islands: NewProjectIslands;
}

export interface NewProjectSurfaceHandle {
  /** The slot in the dialog layer that carries the dialog. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: NewProjectView) => void;
  /** Bring the second step back to the top and put the caret in the name field. */
  focusName: () => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document discriminates on, and the flags it reads. Derived, never handed in. */
interface NewProjectFlags {
  /** Which value control the chosen breakpoint mode takes, or neither. */
  breakpointValue: "count" | "widths" | "none";
  /** Both modes that match a kept width to a declared one show the rounding rule. */
  showRounding: boolean;
  /** The fidelity floor only means anything while the check that produces a score is on. */
  showFidelity: boolean;
  /** The owner list has landed, so the field is a picker rather than free text. */
  hasOwners: boolean;
  hasNameError: boolean;
  hasDestinationError: boolean;
  hasRepoTaken: boolean;
  hasImportError: boolean;
  hasError: boolean;
  hasInstallUrl: boolean;
}

interface NewProjectScope
  extends Record<string, unknown>, NewProjectView, NewProjectFlags, NewProjectActions {}

/** The view plus the flags the document renders from. */
function derive(view: NewProjectView): NewProjectView & NewProjectFlags {
  return {
    ...view,
    breakpointValue:
      view.breakpointMode === "limit"
        ? "count"
        : view.breakpointMode === "explicit"
          ? "widths"
          : "none",
    hasDestinationError: view.destinationError !== "",
    hasError: view.error !== "",
    hasImportError: view.importError !== "",
    hasInstallUrl: view.errorInstallUrl !== "",
    hasNameError: view.nameError !== "",
    hasOwners: view.owners.length > 0,
    hasRepoTaken: view.repoTaken !== "",
    showFidelity: view.canVerify && view.verify,
    showRounding: view.breakpointMode !== "all",
  };
}

/** A node's authored `part`, which is how an island announces which one it is. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Open the wizard. The handle's `ready` resolves once the dialog is showing.
 *
 * @param options What to draw, every decision a control can ask the flow for, and the three
 *   controllers whose own documents this one hosts.
 * @returns The handle the flow updates and closes.
 */
export function openNewProjectSurface(options: NewProjectSurfaceOptions): NewProjectSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close`, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.actions.closed();
  };

  /** The island boxes the document has announced, by part. Replaced as the bodies come and go. */
  const boxes = new Map<string, HTMLElement>();

  /**
   * Ask each controller for its host and put it in the box, if it is not already there.
   *
   * Nothing here asks whether a box is still in the page, and the reason is the moment
   * `onNodeCreated` fires: a node is announced when it is BUILT, one append before its parent puts
   * it in the tree, so a connectedness test would throw every fresh box away and leave the gate
   * showing two empty divs. One box per part instead — the map is keyed by it, so a rebuilt body
   * replaces the entry and the host moves into the one that is showing.
   */
  const fillIslands = (): void => {
    for (const [part, box] of boxes) {
      const source =
        part === "creds-island"
          ? options.islands.creds
          : part === "managed-island"
            ? options.islands.managed
            : options.islands.model;
      const element = source();
      /* Guarded on placement, not on emptiness: `append` of a node that is already the box's child
         removes and re-inserts it, which disconnects and reconnects every custom element under it
         — and under `creds-island` that is three fields a reader may be typing a key into. */
      if (element && element.parentNode !== box) {
        box.append(element);
      }
    }
  };

  const scope = reactive({
    ...derive(options.view),
    ...options.actions,
    browse: () => {
      options.actions.browse();
    },
    closed: finish,
  }) as NewProjectScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("new-project", scope, slot, {
    onNodeCreated: (element, _path, def) => {
      const part = partOf(def);
      if (element instanceof HTMLElement && part.endsWith("-island")) {
        boxes.set(part, element);
        fillIslands();
      }
    },
  }).then(async (surface) => {
    mounted = surface;
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (closed) {
      return element;
    }
    /* The region goes on the platform's own `<dialog>`, which is the one element here that HAS a
       box: `jx-dialog` is `display: contents`, and the slot wraps a dialog the top layer takes out
       of flow, so both measure 0×0 — and a region whose box is empty is refused outright by
       `scripts/screenshots/lib/shot.ts`. The kit treats that node as a seam already; its own
       behaviour sidecar finds it by exactly this selector. */
    const box = element.querySelector<HTMLElement>('dialog[part="dialog"]') ?? element;
    box.setAttribute(REGION_ATTR, overlayRegion("dialog", "new-project"));
    showModal(element);
    fillIslands();
    return element;
  });

  return {
    close() {
      /* Guarded on the WORK rather than on `closed`, and the difference is a slot that would
         otherwise be left behind: the platform's own `close` runs `finish()` before any caller
         reaches here, so a `close()` that returned early on `closed` would take the dialog down and
         leave its host div in the layer. Every line below is idempotent instead. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does — `finish` tells it so.
      mounted?.dispose();
      mounted = null;
      boxes.clear();
      slot.remove();
      finish();
    },
    focusName() {
      const element = mounted?.root;
      if (!(element instanceof HTMLElement)) {
        return;
      }
      /* After the frame the write above paints in: the field only exists once the body switch has
         reconciled onto the second step, and a refused submit is exactly the moment it did not
         move. Measurement and a focus move are the two imperative things a surface may still do
         (ui.md §2 rule 5). */
      requestAnimationFrame(() => {
        element.querySelector('[part="dialog"]')?.scrollTo?.(0, 0);
        element.querySelector<HTMLElement>('[part="name"] [part="input"]')?.focus?.();
      });
    },
    host: slot,
    ready,
    update(view) {
      Object.assign(scope, derive(view));
      /* The controllers are asked again on every update, because `render()` is what brings each
         one's own surface up to date. A box that the body switch has not built yet is filled by
         `onNodeCreated` when it is. */
      fillIslands();
    },
  };
}
