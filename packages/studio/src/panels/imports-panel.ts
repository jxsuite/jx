/// <reference lib="dom" />
/**
 * The Packages panel — context-aware import manager with cherry-pick component selection.
 *
 * This is the FLOW. The markup is `surfaces/panel-imports.json` and the scope that feeds it is
 * `surfaces/panel-imports.ts`; what stays here is every decision: which of the panel's two moods a
 * document puts it in, what a specifier means, what `bun` is asked to do, what a removal confirms,
 * and which of the two writers — the project config or the open document's `$elements` — a toggle
 * belongs to.
 *
 * When editing `project.json` it shows the project's imported modules, the four npm verbs, and a
 * checkbox per element of every installed package. When editing a page, layout, component or
 * content type it shows that document's `$ref` imports, the picker that adds one, and the same
 * per-element checkboxes written into the document instead.
 *
 * **The drafts live here, not in the DOM.** They used to be `ref()` handles read at submit time,
 * which is a spelling a document does not have: a binding writes only when the SCOPE moves, so
 * every field's setter states what the control now holds before anything is decided about it, and
 * clearing one after a successful add is then a real change the runtime carries back. `sync()` —
 * not `renderLeftPanel()` — is what an echo calls: it assigns into the standing scope in the same
 * turn, where a Navigator repaint is a frame away and would rebuild far more than one field.
 */

import { nothing } from "lit-html";
import { componentRegistry } from "../files/components";
import {
  disableElement,
  enableElement,
  hasElement,
  removeElementRef,
  removePackageElements,
} from "../files/elements";
import { projectState } from "../store";
import { updateSiteConfig } from "../site-context";
import { getPlatform } from "../platform";
import { showConfirmDialog } from "../ui/layers";
import { registerPanel } from "./panel-registry";
import { renderImportsSurface } from "../surfaces/panel-imports";
import { activeTab } from "../workspace/workspace";
import { transact } from "../tabs/transact";

import type { ComponentEntry } from "../files/components";
import type { ElementsEntry } from "../files/elements";
import type {
  ComponentRow,
  ImportsActions,
  ImportsView,
  PackageRow,
  PickerOption,
} from "../surfaces/panel-imports";
import type { JxElement, JxMutableNode } from "@jxsuite/schema/types";

/** What the panel is drawn against. `left-panel.ts`'s context, reduced to what this reads. */
export interface ImportsContext {
  renderLeftPanel: () => void;
  documentPath: string | null;
  documentElements: ElementsEntry[];
  applyMutation: (fn: (doc: JxMutableNode) => void) => void;
}

/* `ElementsEntry` is `files/elements.ts`'s now — the module that decides what belongs in the
   array owns the type of its members. Re-exported so importers of this panel keep resolving. */
export type { ElementsEntry } from "../files/elements";

/* `componentSpecifier` and `isComponentEnabled` are `files/elements.ts`'s `npmSpecifier` and
   `hasElement`. They lived here and answered only for the two checkboxes in this file; the picker
   below and the canvas drop each asked the question their own way and got different answers
   (plan §11.2). One rule, four call sites. */

// ─── The panel's own state ───────────────────────────────────────────────────

/** Where the surface is mounted, and the context it was last drawn against. */
let _host: HTMLElement | null = null;
let _ctx: ImportsContext | null = null;

/** The add-an-import draft — two halves of one pair, so neither is submitted alone. */
let _addName = "";
let _addPath = "";
/** The Add Dependency draft. */
let _addPackage = "";
/** What the component picker shows. `""` is its own empty row rather than a component. */
let _picker = "";

/**
 * Every component row the last projection drew, by the id it was given.
 *
 * A checkbox hands back an id and nothing else, because the package sections are a NESTED map and a
 * row inside the inner one cannot reach the package it is under. This is where that id is spent.
 */
const _byId = new Map<string, ComponentEntry>();

/** The id a component row is toggled by: its package and its tag, which together name one element. */
function componentId(pkg: string, comp: ComponentEntry): string {
  return `${pkg}::${comp.tagName}`;
}

/**
 * Group npm components by package name.
 *
 * @returns {Map<string, ComponentEntry[]>}
 */
function groupByPackage() {
  const groups = new Map<string, ComponentEntry[]>();
  for (const comp of componentRegistry) {
    if (comp.source !== "npm" || !comp.package || !comp.modulePath) {
      continue;
    }
    if (!groups.has(comp.package)) {
      groups.set(comp.package, []);
    }
    groups.get(comp.package)?.push(comp);
  }
  return groups;
}

/** The project's `$elements`, as the site-level mood reads and rewrites it. */
function siteElements(): ElementsEntry[] {
  return (projectState?.projectConfig?.$elements ?? []) as ElementsEntry[];
}

/**
 * One section per installed package, each element ticked or not.
 *
 * `enabled` is asked of `elements` — the project's list in the site mood, the open document's in
 * the other — through the ONE service that answers it (`files/elements.ts`), which is what stopped
 * this panel, the picker and the canvas drop from each having their own idea of "already
 * imported".
 */
function packageSections(
  elements: readonly ElementsEntry[],
  fromPath: string | null,
  canRemove: boolean,
): PackageRow[] {
  _byId.clear();
  return [...groupByPackage().entries()].map(([pkg, comps]): PackageRow => ({
    canRemove,
    components: comps.map((comp): ComponentRow => {
      const id = componentId(pkg, comp);
      _byId.set(id, comp);
      return { enabled: hasElement(elements, comp, fromPath), id, label: `<${comp.tagName}>` };
    }),
    name: pkg,
  }));
}

/** The site-level mood: the project's imported modules, its packages, and the npm verbs. */
function siteView(): ImportsView {
  const imports = projectState?.projectConfig?.imports ?? {};
  return {
    addName: _addName,
    addPackageValue: _addPackage,
    addPath: _addPath,
    mode: "site",
    modules: Object.entries(imports).map(([name, path]) => ({ name, path: String(path) })),
    packages: packageSections(siteElements(), null, true),
    pickerOptions: [],
    pickerValue: "",
    refEmptyMessage: "",
    refs: [],
  };
}

/** The document-level mood: this document's component imports, and what it could still import. */
function documentView(ctx: ImportsContext): ImportsView {
  const { documentElements, documentPath } = ctx;
  const refs = documentElements
    .filter(
      (entry): entry is { $ref: string } =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as { $ref?: unknown }).$ref === "string",
    )
    .map((entry) => ({ ref: entry.$ref }));
  /* The checkbox reads the STRING entries only. A `$ref` is a project component and is listed
     above; letting it answer here would tick an npm box for a file that happens to share a name. */
  const npmEntries = documentElements.filter((entry) => typeof entry === "string");
  const imported = new Set(refs.map((entry) => entry.ref));
  const available: PickerOption[] = componentRegistry
    .filter(
      (comp: ComponentEntry) =>
        comp.source !== "npm" &&
        comp.path != null &&
        !imported.has(`./${comp.path}`) &&
        !imported.has(comp.path),
    )
    .map((comp) => ({ label: `<${comp.tagName}>`, value: comp.tagName }));

  return {
    addName: _addName,
    addPackageValue: _addPackage,
    addPath: _addPath,
    mode: "document",
    modules: [],
    packages: packageSections(npmEntries, documentPath, false),
    pickerOptions: available,
    pickerValue: _picker,
    refEmptyMessage:
      available.length > 0
        ? "Components you add here can be dropped onto this page. Pick one below."
        : "Components you add here can be dropped onto this page. " +
          "This project has none yet — create one from any selection on the canvas.",
    refs,
  };
}

/** What the panel shows right now. `project.json` is the one document with the other mood. */
function view(ctx: ImportsContext): ImportsView {
  return ctx.documentPath?.endsWith("project.json") ? siteView() : documentView(ctx);
}

/** Push the current projection into the standing surface, in this turn. */
function sync(): void {
  if (!_host || !_ctx) {
    return;
  }
  renderImportsSurface(_host, view(_ctx), ACTIONS);
}

/** The context the actions run against. `null` before the panel has ever been drawn. */
function context(): ImportsContext | null {
  return _ctx;
}

// ─── The verbs ───────────────────────────────────────────────────────────────

async function onAddModule(): Promise<void> {
  const name = _addName.trim();
  const path = _addPath.trim();
  if (!name || !path) {
    return;
  }
  const imports = projectState?.projectConfig?.imports ?? {};
  _addName = "";
  _addPath = "";
  sync();
  await updateSiteConfig({ imports: { ...imports, [name]: path } });
  context()?.renderLeftPanel();
}

async function onRemoveModule(name: string): Promise<void> {
  const updated = { ...projectState?.projectConfig?.imports };
  delete updated[name];
  await updateSiteConfig({ imports: updated });
  context()?.renderLeftPanel();
}

async function onAddPackage(): Promise<void> {
  const name = _addPackage.trim();
  if (!name) {
    return;
  }
  _addPackage = "";
  sync();
  try {
    await getPlatform().addPackage(name);
    const { loadComponentRegistry } = await import("../files/components.js");
    await loadComponentRegistry();
    context()?.renderLeftPanel();
  } catch (error) {
    console.error("Failed to add package:", error);
  }
}

async function onRemovePackage(pkg: string): Promise<void> {
  const confirmed = await showConfirmDialog("Remove Package", `Remove ${pkg}?`, {
    confirmLabel: "Remove",
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  try {
    await getPlatform().removePackage(pkg);
    /* …including the legacy whole-package entry. The hand-rolled filter this replaced kept it, so
       removing a package left `@acme/ui` importing a package that was gone. */
    const updated = removePackageElements(siteElements(), pkg);
    const { loadComponentRegistry } = await import("../files/components.js");
    await loadComponentRegistry();
    await updateSiteConfig({ $elements: updated as (string | JxElement)[] });
    context()?.renderLeftPanel();
  } catch (error) {
    console.error("Failed to remove package:", error);
  }
}

/**
 * Tick or clear one element of one package.
 *
 * The one place the two moods diverge is WHO owns the array: `project.json`'s `$elements` is the
 * project's and goes through the config writer, a document's is the document's and goes through a
 * transaction. What is written into it is the same service's answer either way.
 */
async function onToggleComponent(id: string, checked: boolean): Promise<void> {
  const ctx = context();
  const comp = _byId.get(id);
  if (!ctx || !comp) {
    return;
  }
  if (ctx.documentPath?.endsWith("project.json")) {
    const before = siteElements();
    const updated = checked
      ? enableElement(before, comp, null)
      : disableElement(before, comp, null);
    await updateSiteConfig({ $elements: updated as (string | JxElement)[] });
    ctx.renderLeftPanel();
    return;
  }
  ctx.applyMutation((doc: JxMutableNode) => {
    const before = (doc.$elements ?? []) as ElementsEntry[];
    doc.$elements = (
      checked
        ? enableElement(before, comp, ctx.documentPath)
        : disableElement(before, comp, ctx.documentPath)
    ) as (string | JxElement)[];
  });
  ctx.renderLeftPanel();
}

/**
 * A pick from the component picker.
 *
 * The echo is doubled here on purpose: the control's own value moves to whatever was chosen, and
 * the picker's resting state is its empty row, so the scope is told BOTH — otherwise choosing the
 * same component twice would leave the second pick showing in a control the scope never moved.
 */
function onPick(value: string): void {
  const ctx = context();
  _picker = value;
  sync();
  _picker = "";
  sync();
  if (!ctx || !value) {
    return;
  }
  const comp = componentRegistry.find((c: ComponentEntry) => c.tagName === value);
  if (!comp?.path) {
    return;
  }
  /* Through the service, which is also what makes this idempotent: it checked nothing and pushed a
     second `$ref` every time you chose the same component. */
  ctx.applyMutation((doc: JxMutableNode) => {
    doc.$elements = enableElement(
      (doc.$elements ?? []) as ElementsEntry[],
      comp,
      ctx.documentPath,
    ) as (string | JxElement)[];
  });
  ctx.renderLeftPanel();
}

/** @param {string} elementRef The element reference to drop. Not `ref` — that is lit's directive. */
function onRemoveRef(elementRef: string): void {
  const ctx = context();
  if (!ctx) {
    return;
  }
  ctx.applyMutation((doc: JxMutableNode) => {
    doc.$elements = removeElementRef((doc.$elements ?? []) as ElementsEntry[], elementRef) as (
      | string
      | JxElement
    )[];
  });
  ctx.renderLeftPanel();
}

/**
 * What the reader may do. One set for the module, because the panel's whole state is the module's —
 * one project, one focused document, and one draft of each field across both.
 *
 * The three `edit*` entries are ECHOES: the scope has to be told what a field now holds even though
 * nothing else about the panel changes, because emptying it afterwards is otherwise a write of `""`
 * over a scope that already said `""` — no change, no binding, and the submitted text left sitting
 * in the field.
 */
const ACTIONS: ImportsActions = {
  addModule: () => {
    void onAddModule();
  },
  addPackage: () => {
    void onAddPackage();
  },
  editName: (value: string) => {
    _addName = value;
    sync();
  },
  editPackage: (value: string) => {
    _addPackage = value;
    sync();
  },
  editPath: (value: string) => {
    _addPath = value;
    sync();
  },
  pick: onPick,
  removeModule: (name: string) => {
    void onRemoveModule(name);
  },
  removePackage: (pkg: string) => {
    void onRemovePackage(pkg);
  },
  removeRef: onRemoveRef,
  toggleComponent: (id: string, checked: boolean) => {
    void onToggleComponent(id, checked);
  },
};

/**
 * Draw the panel into `host`, or bring the one already there up to date.
 *
 * @param {HTMLElement} host The panel's content area.
 * @param {ImportsContext} ctx What the panel is drawn against.
 */
export function renderImportsPanel(host: HTMLElement, ctx: ImportsContext): void {
  if (host !== _host) {
    /* A new content area is a new panel, and a half-typed pair belongs to the surface that was
       showing it. Switching panels and back is NOT this — lit reuses the same `.panel-content`, so
       the draft survives exactly as the `ref()` handles it replaced used to. */
    _addName = "";
    _addPath = "";
    _addPackage = "";
    _picker = "";
  }
  _host = host;
  _ctx = ctx;
  sync();
}

/**
 * The Navigator's content area inside a panel body.
 *
 * `afterRender` is handed the `.panel-body`, and the panel's own content goes one level in — which
 * is where the document must be mounted rather than beside it, because that child is lit's part and
 * clearing it is how switching to another panel takes this surface down. A body drawn by the
 * fallback path has no content area; mounting into the body itself is then still correct.
 */
function contentArea(body: HTMLElement): HTMLElement {
  return body.querySelector<HTMLElement>(".panel-content") ?? body;
}

/**
 * The Navigator no longer draws this panel with lit.
 *
 * The record below returns `nothing` and mounts its document in `afterRender`, so this is a stub:
 * it survives only because `NavigatorPanelDeps` still declares the injection and `studio.ts` still
 * passes it. Both go in the change that deletes this.
 *
 * @deprecated The panel is `surfaces/panel-imports.json`; call {@link renderImportsPanel}.
 * @returns {typeof nothing}
 */
export function renderImportsTemplate(_against: ImportsContext): typeof nothing {
  return nothing;
}

/**
 * Contribute the Packages panel.
 *
 * `level: "document"` — it writes the open document's `$elements`. The id and the title are both
 * `packages` now: "Imports" named the mechanism, and the panel silently changed meaning on
 * `documentPath?.endsWith("project.json")` with nothing on screen saying so. The header the
 * Navigator draws from this record ("PACKAGES · document") is where that stops.
 */
export function registerPackagesPanel(): void {
  registerPanel({
    id: "packages",
    title: "Packages",
    level: "document",
    dock: "navigator",
    icon: "cube",
    requiresDocument: "Open a page to choose which components it can use.",
    render: () => nothing,
    afterRender: (ctx, host) => {
      renderImportsPanel(contentArea(host), {
        applyMutation: (fn: (doc: JxMutableNode) => void) => {
          transact(activeTab.value, fn);
        },
        documentElements: ctx.doc?.document.$elements ?? [],
        documentPath: ctx.doc?.documentPath ?? null,
        renderLeftPanel: ctx.rerender,
      });
    },
  });
}
