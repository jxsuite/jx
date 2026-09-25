/// <reference lib="dom" />
/**
 * Elements panel — the Insert palette: the blocks and components a page is built out of.
 *
 * **The body is a Jx document** (`surfaces/panel-elements.json`, mounted by
 * `surfaces/panel-elements.ts`), so `render` draws nothing and `afterRender` mounts. What stays
 * here is everything that is a DECISION — which categories survive the filter, which npm components
 * the open document has enabled, what a card inserts and where — projected into a scope whose every
 * card already carries the tag it inserts. `afterRender` runs on every repaint, so
 * {@link mountElementsPanel} is idempotent: the standing surface is updated where it is still
 * there, and re-mounted only where lit has taken it out (which is what a switch to another panel
 * does, because the document is appended into the `.panel-content` lit renders `nothing` into).
 *
 * **Filtering no longer repaints the Navigator, and that fixes a defect.** `panel-scheduler.ts`
 * withholds a repaint while a text input inside the panel has focus — which is exactly when
 * somebody is typing in the filter — so the palette used to sit stale, marked `data-jx-stale`,
 * until the field was blurred. A document is updated in place instead: the cards that no longer
 * match leave, the field is untouched, and no repaint is asked for at all.
 *
 * @docs studio/design/elements
 */

import { nothing } from "lit-html";
import { buildComponentInstance, componentRegistry } from "../files/components";
import { childList, getNodeAtPath } from "../store";
import { getEffectiveElements } from "../site-context";
import { mountElementsSurface } from "../surfaces/panel-elements";
import { mutateInsertNode, transactDoc } from "../tabs/transact";
import { primarySelection } from "../tabs/selection";
import { registerPanel } from "./panel-registry";
import { activeTab } from "../workspace/workspace";
import { view } from "../view";

import type { ComponentEntry } from "../files/components";
import type {
  ComponentCardView,
  ElementCategoryView,
  ElementsActions,
  ElementsSurfaceHandle,
  ElementsValues,
} from "../surfaces/panel-elements";
import type { JxElement, JxMutableNode } from "@jxsuite/schema/types";
import type { NavigatorPanelContext, NavigatorPanelDeps, PanelBody } from "./panel-registry";

/** The palette's source of blocks, as `NavigatorPanelDeps.webdata` carries it. */
interface ElementsWebdata {
  elements: Record<string, { tag: string }[]>;
}

/** The Components section's name — its accordion label AND its key in `view.elementsCollapsed`. */
const COMPONENTS = "Components";

/**
 * What the palette is built from, held at module scope rather than closed over at mount.
 *
 * The standing surface outlives the {@link NavigatorPanelContext} that mounted it — a card clicked
 * ten repaints later must reach the CURRENT `defaultDef` and the current drag registrations — so
 * the seat is rewritten on every `afterRender` and the actions read it rather than a captured
 * copy.
 */
let panelDeps: NavigatorPanelDeps | null = null;

/**
 * The surface standing in the Navigator, and the node it was mounted into.
 *
 * One slot rather than a per-host map, because there is one Navigator: a mount into a DIFFERENT
 * node is the old one being replaced, and holding both would leave the first one's effects running
 * against a scope nobody writes any more.
 */
let standing: { host: HTMLElement; handle: ElementsSurfaceHandle } | null = null;

/** What the filter matches on: the reader's text, lower-cased at the point of comparison. */
function needle(): string {
  return view.elementsFilter.toLowerCase();
}

/** The categories that still have something in them, with the filter applied. */
function categoryViews(webdata: ElementsWebdata, filter: string): ElementCategoryView[] {
  const sections: ElementCategoryView[] = [];
  for (const [name, elements] of Object.entries(webdata.elements ?? {})) {
    const matched = filter ? elements.filter((entry) => entry.tag.includes(filter)) : elements;
    if (matched.length === 0) {
      continue;
    }
    sections.push({
      elements: matched.map(({ tag }) => ({ tag })),
      name,
      open: !view.elementsCollapsed.has(name),
    });
  }
  return sections;
}

/**
 * The tag names the open document's `$elements` turn on.
 *
 * An entry is either `<package>/<modulePath>`, which names one component, or a bare package, which
 * names every component in it. A project component is not gated at all — it is in the project.
 */
function enabledNpmTags(): Set<string> {
  const tab = activeTab.value;
  const entries = getEffectiveElements(
    tab?.doc.document?.$elements as (string | JxElement)[] | undefined,
  );
  const tags = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }
    const named = componentRegistry.find(
      (comp: ComponentEntry) =>
        comp.source === "npm" && comp.modulePath && entry === `${comp.package}/${comp.modulePath}`,
    );
    if (named) {
      tags.add(named.tagName);
      continue;
    }
    for (const comp of componentRegistry) {
      if (comp.source === "npm" && comp.package === entry) {
        tags.add(comp.tagName);
      }
    }
  }
  return tags;
}

/** The component cards: the project's own, plus the npm ones this document has enabled. */
function componentViews(filter: string): ComponentCardView[] {
  if (componentRegistry.length === 0) {
    return [];
  }
  const enabled = enabledNpmTags();
  return componentRegistry
    .filter((comp) => comp.source !== "npm" || enabled.has(comp.tagName))
    .filter((comp) => !filter || comp.tagName.toLowerCase().includes(filter))
    .map((comp) => ({
      tagName: comp.tagName,
      title:
        comp.source === "npm" ? `${comp.package}: <${comp.tagName}>` : (comp.path ?? comp.tagName),
    }));
}

/** Everything the document draws, as one value. */
function panelValues(source: NavigatorPanelDeps): ElementsValues {
  const filter = needle();
  const categories = categoryViews(source.webdata as unknown as ElementsWebdata, filter);
  const components = componentViews(filter);
  const bare = categories.length === 0 && components.length === 0;
  return {
    categories,
    components,
    componentsOpen: !view.elementsCollapsed.has(COMPONENTS),
    emptyState: bare ? (filter ? "filtered" : "empty") : "none",
    /* The reader's own text, not `filter`: the field is bound to this, and a scope holding the
       lower-cased form would rewrite what was typed on every keystroke. */
    filter: view.elementsFilter,
    hasComponents: components.length > 0,
  };
}

/** Insert a node as the last child of the selected element — what both kinds of card do. */
function insertAtSelection(def: JxMutableNode): void {
  const tab = activeTab.value;
  if (!tab) {
    return;
  }
  const parentPath = primarySelection(tab.session.selection) ?? [];
  const parent = getNodeAtPath(tab.doc.document, parentPath);
  const index = childList(parent).length;
  transactDoc(tab, (tr) => mutateInsertNode(tr, parentPath, index, structuredClone(def)));
}

/**
 * Push a fresh projection into the standing surface, then re-register the drags.
 *
 * The drag registrations are deferred until the document has rendered: `mountSurface` resolving is
 * what says the cards exist, and a mapped array coalesces its re-render into a microtask, so a
 * registration that ran on the same turn as the write would walk the previous set of cards.
 */
function refresh(): void {
  const seat = standing;
  if (!seat || !panelDeps) {
    return;
  }
  seat.handle.update(panelValues(panelDeps));
  void seat.handle.ready.then(() => {
    if (standing !== seat) {
      return;
    }
    panelDeps?.registerElementsDnD();
    panelDeps?.registerComponentsDnD();
  });
}

/** What the document's controls do. Every one of them is a decision this module owns. */
const ACTIONS: ElementsActions = {
  clearFilter: () => {
    view.elementsFilter = "";
    refresh();
  },
  insertComponent: (tagName) => {
    const comp = componentRegistry.find((entry: ComponentEntry) => entry.tagName === tagName);
    if (comp) {
      insertAtSelection(buildComponentInstance(comp));
    }
  },
  insertElement: (tag) => {
    if (panelDeps) {
      insertAtSelection(panelDeps.defaultDef(tag) as JxMutableNode);
    }
  },
  setComponentsOpen: (open) => {
    setCollapsed(COMPONENTS, !open);
    refresh();
  },
  /* The echo: what the field now holds goes into the state the palette is filtered by, before
     anything is decided about it. */
  setFilter: (value) => {
    view.elementsFilter = value;
    refresh();
  },
  setSectionOpen: (name, open) => {
    setCollapsed(name, !open);
    refresh();
  },
};

/** Remember a section's disclosure across repaints and across panel switches. */
function setCollapsed(name: string, collapsed: boolean): void {
  if (collapsed) {
    view.elementsCollapsed.add(name);
  } else {
    view.elementsCollapsed.delete(name);
  }
}

/**
 * Draw the panel body — mounting the document the first time, updating it every time after.
 *
 * The document goes into `.panel-content`, not into the `.panel-body` this is handed. Both are
 * lit's, but only one of them is the node lit renders this panel's body INTO: a repaint commits
 * `nothing` there, which lit skips, and a switch to another panel commits that panel's template,
 * which clears to the end of the parent and takes this document with it. Appending to `.panel-body`
 * instead would survive the switch — and leave the palette drawn underneath the Files tree.
 *
 * @param {NavigatorPanelContext} ctx
 * @param {HTMLElement} host - The painted `.panel-body`
 */
export function mountElementsPanel(ctx: NavigatorPanelContext, host: HTMLElement): void {
  panelDeps = ctx.deps;
  const container = host.querySelector<HTMLElement>(".panel-content") ?? host;
  if (standing && (standing.host !== container || !standing.handle.connected())) {
    standing.handle.dispose();
    standing = null;
  }
  if (!standing) {
    standing = {
      handle: mountElementsSurface(container, panelValues(ctx.deps), ACTIONS),
      host: container,
    };
  }
  refresh();
}

/**
 * Contribute the Insert panel — **off the rail** (`rail: false`).
 *
 * §3.2 ② removes Elements from the Navigator rail because it is not a view of anything: it is an
 * insert palette, and a palette belongs at the caret (slash menu), on the canvas (`+`) and behind
 * ⌘⇧A, all of which are P3.5's Insert command family. The record survives that interval so the
 * surface stays reachable — `view.setActivity {tab:"insert"}`, the palette, and the screenshot
 * pipeline all still address it — and giving up its rail slot is what keeps the DOCUMENT group at
 * four.
 *
 * `level: "document"`, per principle 3's own worked example: it READS the project's component
 * registry and WRITES the document tree.
 */
export function registerInsertPanel(): void {
  registerPanel({
    id: "insert",
    title: "Insert",
    level: "document",
    dock: "navigator",
    icon: "grid-four",
    rail: false,
    // The body is a document, so lit draws nothing and the mount happens against the painted DOM.
    // `afterRender` runs on every repaint; {@link mountElementsPanel} is idempotent.
    render: (): PanelBody => nothing,
    afterRender: (ctx, host) => {
      mountElementsPanel(ctx, host);
    },
  });
}
