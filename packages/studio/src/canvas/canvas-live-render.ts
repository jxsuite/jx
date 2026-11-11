/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Canvas live render — extracted from studio.js (Phase 4p). Async runtime rendering pipeline that
 * builds live canvas DOM using @jxsuite/runtime. Handles element registration, scope building, path
 * mapping ($map remapping), site-level style injection, and $head element injection.
 */

import { projectState, stripEventHandlers } from "../store";
import {
  displayTagName,
  isJsonObject,
  isMappedArray,
  isNonNullObject,
  isString,
} from "@jxsuite/schema/guards";
import { canvasModeOfTab } from "./canvas-surface";
import { toRaw } from "../reactivity";
import {
  distributePageIntoLayout,
  getEffectiveElements,
  getEffectiveHead,
  extensionClassPaths,
  getEffectiveImports,
  getEffectiveLayoutPath,
  getEffectiveMedia,
  resolveLayoutDoc,
} from "../site-context";
import { documentBase } from "./canvas-origin";
import { scriptCollector } from "./canvas-scripts";
import { componentRegistry, computeRelativePath } from "../files/components";
import { collectUsedTags } from "@jxsuite/schema/component-meta";
import { injectContext } from "@jxsuite/site/context";
import { documentUrlPattern } from "@jxsuite/site/routes";
import { entryBoundFields, entryRootsOf, prepareForEditMode } from "../utils/edit-display";
import { liveEntryState } from "./live-entry";
import {
  paramBoundStateKeys,
  resolveParamBoundState,
  substitutePreviewParams,
} from "../page-params";
import { isComponentDoc, substitutePreviewProps } from "../component-props";
import { assetContextFor, hostAssetDeclarations } from "./asset-refs";
import { collectionForFile } from "../content/collection-match";
import { writesEntryOnCanvas } from "../content/content-collections";
import { collectionPage, entryLayoutPath, entryLocale } from "../content/collection-pages";
import { isPagePath, pageContextFor } from "./canvas-page-context";
import { loadExtensions } from "../format/format-host";
import { bakeRepeaterSources, extensionClassKeys, repeaterSourceKeys } from "./repeater-sources";

import type { AssetContext } from "./asset-refs";
import type { CanvasScripts, ScriptCollector } from "./canvas-scripts";
import type {
  JsonValue,
  JxDocument,
  JxElement,
  JxMutableNode,
  JxPath,
  JxStyle,
} from "@jxsuite/schema/types";
import type { ComponentEntry } from "../files/components.js";
import type { LayoutMarker } from "./path-mapping";
import type { Tab } from "../tabs/tab";
import type { WireMapperCtx } from "./iframe-protocol";

/**
 * Walk the merged document tree to find where page children were distributed into the layout slot.
 * Returns the `prefix` path to the container whose children hold the page content (first container
 * with a non-$__layout child), plus the `offset` — the index of the first page-content child within
 * that container's children array. The offset is non-zero when the layout places sibling nodes
 * (e.g. a `<noscript>`) before the `<slot>`, which shifts every page child's render index relative
 * to its page-document index. The path mapper subtracts this offset so canvas paths line up with
 * the page document (and thus the layers panel).
 *
 * @param {JxMutableNode} node
 * @param {(string | number)[]} [path]
 * @returns {{ prefix: (string | number)[]; offset: number } | null}
 */
function findPageContentPrefix(
  node: JxMutableNode,
  path: (string | number)[] = [],
): { prefix: (string | number)[]; offset: number } | null {
  // Document JSON can hold a null or scalar where a node belongs; neither has page content.
  if (!isNonNullObject(node)) {
    return null;
  }
  if (Array.isArray(node.children)) {
    const firstPageIdx = node.children.findIndex(
      (child) => isNonNullObject(child) && !child.$__layout,
    );
    if (firstPageIdx !== -1) {
      return { offset: firstPageIdx, prefix: [...path, "children"] };
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (isNonNullObject(child) && child.$__layout) {
        const found = findPageContentPrefix(child, [...path, "children", i]);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

/**
 * Recursively mark every node of a layout doc tree with its ORIGIN — `$__layout: { file, path }` —
 * so the renderer can both tell layout nodes apart from page content and say which node of which
 * file each one is. The marker used to be a bare `true`, which made a layout node identifiable but
 * unaddressable: the canvas could tell you had clicked something it could not edit, but not what
 * you had clicked or where to go to edit it. `path` is the node's own path inside `file`, so the
 * editor can open the layout with that node selected. See {@link LayoutMarker}.
 */
export function markLayoutNodes(node: JxMutableNode, file: string, path: JxPath = []) {
  // Layout JSON can hold a null or scalar where a node belongs; there is nothing to mark on it.
  if (!isNonNullObject(node)) {
    return;
  }
  node.$__layout = { file, path } satisfies LayoutMarker;
  if (Array.isArray(node.children)) {
    for (const [i, child] of node.children.entries()) {
      if (isString(child)) {
        continue;
      }
      markLayoutNodes(child, file, [...path, "children", i]);
    }
  }
  if (Array.isArray(node.$elements)) {
    for (const [i, el] of node.$elements.entries()) {
      if (!isString(el)) {
        /* SAFETY: a non-string `$elements` entry is an inline element definition or a `{ $ref }`
           import. markLayoutNodes stamps `$__layout` and walks `children` / `$elements`, which a
           `$ref` entry simply lacks, so it is marked as a childless node. */
        markLayoutNodes(el as JxMutableNode, file, [...path, "$elements", i]);
      }
    }
  }
}

/**
 * A layout as the canvas wraps a document in it: read, its nodes marked with the file they come
 * from, and itself wrapped in the layout ITS `$layout` names, all the way up.
 *
 * A layout can sit in another layout (`layouts/post.json` → `layouts/base.json`), and the build
 * resolves the whole chain (`@jxsuite/site` `resolveLayout`), so a page drawn in the inner layout
 * alone lost the outer one's nav and footer on the canvas and nowhere else. Each level is merged
 * the way the build merges it, and each node keeps the marker of the file it was authored in, so
 * opening a locked node still opens the layout that holds it. A cycle stops at the first repeat
 * rather than recursing forever, and a parent that cannot be read leaves the chain where it is.
 *
 * Each layout's own script is addressed to it before the levels are merged (`canvas-scripts.ts`),
 * because the merged document cannot say which level an entry was written in.
 *
 * @param {string} layoutPath - The `$layout` reference, project-relative as authored
 * @param {Set<string>} [seen] - Files already on the chain
 * @param {ScriptCollector} [scripts] - Where each layout's client script is gathered
 * @returns {Promise<JxMutableNode | null>} The merged, marked layout, or null when unreadable
 */
export async function resolveCanvasLayout(
  layoutPath: string,
  seen = new Set<string>(),
  scripts: ScriptCollector | null = null,
): Promise<JxMutableNode | null> {
  const file = layoutPath.replace(/^\.\//, "");
  if (seen.has(file)) {
    return null;
  }
  seen.add(file);
  const read = await resolveLayoutDoc(layoutPath);
  if (!read) {
    return null;
  }
  const layoutDoc = scripts ? scripts.own(read, file) : read;
  // The SAME normalization resolveLayoutDoc reads the file with, so the marker's `file` is a path
  // The editor can hand straight to navigateToComponent when the author asks to open it.
  markLayoutNodes(layoutDoc, file);
  const parentRef = layoutDoc.$layout;
  if (!isString(parentRef) || !parentRef) {
    return layoutDoc;
  }
  const parent = await resolveCanvasLayout(parentRef, seen, scripts);
  if (!parent) {
    return layoutDoc;
  }
  const merged = distributePageIntoLayout(parent, layoutDoc);
  delete merged.$layout;
  return merged;
}

/**
 * Re-address a layout's `$elements` imports from the layout's file to the document being drawn.
 *
 * A layout's `{ $ref: "../components/site-nav.json" }` is relative to the LAYOUT, but once the
 * layout is merged around a document the canvas resolves every `$ref` against the document's own
 * base. A page in `pages/` sits as deep as `layouts/`, so the two answers agreed by coincidence; an
 * entry in `content/menu/` or a page in `pages/blog/` resolved the same ref to
 * `content/components/…`, which 404s and leaves the nav and footer unregistered. Each entry is
 * re-addressed from the file its `$__layout` marker names, which is the file it was authored in at
 * every level of a layout chain. Bare specifiers and URLs are left alone, and so is an entry with
 * no marker (the document's own).
 *
 * @param {(JxElement | string)[] | undefined} elements - The merged document's `$elements`
 * @param {string} documentPath - The project-relative path of the document being drawn
 */
export function rebaseLayoutElementRefs(
  elements: readonly (JxElement | string | null)[] | undefined,
  documentPath: string,
) {
  for (const el of elements ?? []) {
    if (!isNonNullObject(el) || !isString(el.$ref) || !/^\.\.?\//.test(el.$ref)) {
      continue;
    }
    const marker = el["$__layout"];
    if (!isJsonObject(marker) || !isString(marker.file)) {
      continue;
    }
    const target = new URL(el.$ref, `jx-project:/${marker.file}`).pathname.replace(/^\//, "");
    el.$ref = computeRelativePath(documentPath, target);
  }
}

/**
 * A document's own layout override: its root's `$layout`, or a Markdown document's frontmatter
 * `$layout` (which the build reads, and which the Inspector's Page tab writes); `undefined` when it
 * names none.
 */
export function pageLayout(doc: JxMutableNode, tab: Tab | null): string | false | undefined {
  if (doc.$layout !== undefined) {
    return doc.$layout;
  }
  const fromFrontmatter = tab?.doc.content.frontmatter.$layout;
  return isString(fromFrontmatter) || fromFrontmatter === false ? fromFrontmatter : undefined;
}

/**
 * The layout a collection entry is drawn in (studio.md §22.5): the entry's own `$layout` (on its
 * document, or in its frontmatter for a Markdown entry, {@link pageLayout}), else its collection's
 * template page's `$layout`, else the project's `defaults.layout`. `null` when none applies.
 *
 * When the collection's page draws the entry's body, the entry is written inside that page first
 * ({@link entryInPage}) and this is the layout the PAGE is drawn in; otherwise it is the layout the
 * entry is drawn in alone.
 */
export async function entryLayout(
  doc: JxMutableNode,
  tab: Tab | null,
  path: string | null | undefined,
): Promise<string | null> {
  const own = pageLayout(doc, tab);
  const match = path ? collectionForFile(path) : null;
  const page = match ? await collectionPage(match.name, entryLocale(path)) : null;
  return entryLayoutPath(own, page);
}

/** A collection entry spliced into its collection's page, ready to be wrapped in a layout. */
export interface EntryPage {
  /** The page, its nodes marked as the page's, with the entry's own tree where its body goes. */
  doc: JxMutableNode;
  /** The page's `ContentEntry` state key the entry stands in for (`entry`). */
  root: string;
  /** The page file, project-relative. */
  file: string;
}

/**
 * The node of a collection page that draws its entry's body: computed children reading the
 * `$children` of one of its `ContentEntry` state entries (`"${state.entry.$children ?? []}"`), with
 * the path to it. Null when the page draws no body.
 */
function entryBodyOf(
  node: JxMutableNode,
  roots: ReadonlySet<string>,
): { body: JxMutableNode; root: string } | null {
  if (!isNonNullObject(node)) {
    return null;
  }
  const { children } = node;
  if (isString(children)) {
    const fields = entryBoundFields(children, roots);
    const root = fields?.length === 1 && fields[0] === "body" ? entryRootOf(children, roots) : null;
    return root === null ? null : { body: node, root };
  }
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = isString(child) ? null : entryBodyOf(child, roots);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** The attribute that marks a page's text as one entry field the author can type in place. */
export const ENTRY_FIELD_ATTR = "data-jx-entry-field";

/** Text that is one whole field of `root`: `${state.entry.data.title}`, and nothing around it. */
function wholeFieldOf(text: string, root: string): string | null {
  const match = /^\$\{\s*state\.([\w$]+)\.data\.([\w$]+)\s*\}$/u.exec(text);
  return match?.[1] === root ? match[2]! : null;
}

/**
 * Mark every node of a collection page whose text is one whole field of the entry, so the canvas
 * lets the author type it in place and writes what they type to that field (studio.md §22.5). Text
 * that mixes fields or literals (`${state.entry.data.date} · ${state.entry.data.tag}`) has no
 * single field to write back to, and stays the Entry tab's.
 */
function markEntryFields(node: JxMutableNode, root: string): void {
  if (!isNonNullObject(node)) {
    return;
  }
  const field = isString(node.textContent) ? wholeFieldOf(node.textContent, root) : null;
  if (field !== null) {
    node.attributes = { ...node.attributes, [ENTRY_FIELD_ATTR]: field };
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (!isString(child)) {
        markEntryFields(child, root);
      }
    }
  }
}

/** Which of `roots` an entry-bound template reads (its first expression's `state.<root>`). */
function entryRootOf(template: string, roots: ReadonlySet<string>): string | null {
  const root = /\$\{\s*state\.([\w$]+)/u.exec(template)?.[1];
  return root !== undefined && roots.has(root) ? root : null;
}

/**
 * An entry written inside its collection's page (studio.md §22.5): the page the collection's
 * entries are published through, read and marked as locked template, with the entry's own tree in
 * place of the node that draws the entry's body. So a post is written under its page's title, date
 * and cover rather than in the bare layout, and every keystroke still lands in the entry's own
 * document: the spliced tree is the one unmarked run of nodes, which `findPageContentPrefix` finds
 * as the editable region exactly as it finds a page inside a layout.
 *
 * Null, and the entry is drawn in its layout alone as before, when the collection has no page, the
 * page cannot be read, or it draws no body (`"${state.entry.$children}"`), because a page that
 * places no body has nowhere to write one.
 *
 * @param entry - The entry's document as this render draws it (prepared, in Edit and Design)
 * @param path - The entry's file, project-relative
 * @param editable - Whether the render can be edited, so the page's whole-field text is marked as
 *   the entry's fields to type in place (Edit and Design; never Preview)
 * @param scripts - Where the page's client script is gathered
 */
export async function entryInPage(
  entry: JxMutableNode,
  path: string,
  editable = false,
  scripts: ScriptCollector | null = null,
): Promise<EntryPage | null> {
  const match = collectionForFile(path);
  const page = match ? await collectionPage(match.name, entryLocale(path)) : null;
  const read = page ? await resolveLayoutDoc(page.path) : null;
  if (!page || !read) {
    return null;
  }
  const doc = scripts ? scripts.own(read, page.path.replace(/^\.\//, "")) : read;
  const found = entryBodyOf(doc, entryRootsOf(doc));
  if (!found) {
    return null;
  }
  // Marked BEFORE the entry goes in, so the page's nodes are locked and the entry's are not.
  markLayoutNodes(doc, page.path);
  if (editable) {
    markEntryFields(doc, found.root);
  }
  const { children } = entry;
  found.body.children = Array.isArray(children) ? [...children] : [];
  return { doc, file: page.path, root: found.root };
}

/**
 * Resolve a document into the form the iframe canvas renders: layout-distributed, edit-transformed,
 * with components/imports/$media/$head merged in, plus the path-mapper context and site style. This
 * is the "parent resolves, iframe renders" split — the realm-specific work (defineElement,
 * injecting $head/site-style into the DOM, buildScope/renderNode) happens inside the iframe from
 * this result.
 *
 * **`tab` is the tab the render is FOR, and it is a parameter because it is not "the active tab".**
 * This function opened with `const tab = activeTab.value` and took its mode from an injected
 * `getCanvasMode()` — the focused pane's, one layer down — which threw away everything the caller
 * had already resolved correctly: `canvas-render.ts` picks the document with
 * `tabOfPane(surface.paneId)` and threads that tab's id through `mountIframeCanvas` →
 * `preparePassRender`. Six values came from the wrong tab whenever the pane being drawn was not the
 * focused one: `documentPath` (hence `docBase` and the `isPage` test), `showLayout`,
 * `previewParams`, `previewProps`, and the composed `canvasMode`.
 *
 * The mode is the one with teeth. `mountIframeCanvas` ends with `setHostPreview(state, message.mode
 * === "preview")`, so a side pane in Edit whose neighbour was in Preview got a PREVIEW frame — no
 * overlay, no editing messages honoured — and a pane being previewed beside an editing one got an
 * editable frame for a document nobody was editing. `canvasModeOfTab(tab)` is the same composition
 * every other gate reads, applied to the tab that is actually being drawn.
 *
 * **`modeOverride` is the last of those six, and `canvasModeOfTab` is not enough for it.** A LENS
 * draws the source pane's document in a mode of its own, and that mode is deliberately never
 * written onto the tab — so `tabOfPane` hops to the source tab and reports ITS mode. A Diff lens
 * beside a page in Design therefore resolved both of its artboards in `design`: editable frame,
 * placeholders on, anchors de-linked, and `classifyRenderNode` collapsing repeater hops that the
 * primary pane's `git-diff` render leaves alone. Two entry points to one comparison disagreed about
 * both editability and the coordinate space of every stamped path.
 *
 * `canvasModeOfPane(paneId)` is the answer, and it degrades to `canvasModeOfTab` for every pane
 * that is not a lens — so the one production caller passes it unconditionally, the way it already
 * passes `tabOfPane(surface.paneId)` for `tab`. Null keeps the old derivation for callers with a
 * tab and no pane.
 *
 * @param {JxMutableNode} doc
 * @param {Tab | null} tab — the tab whose document and view settings this render is of.
 * @param {string | null} modeOverride — the PANE's mode, when the caller has resolved one.
 */
export async function resolveCanvasDocument(
  doc: JxMutableNode,
  tab: Tab | null,
  modeOverride: string | null = null,
): Promise<{
  renderDoc: JxMutableNode;
  docBase: string | undefined;
  /** How the canvas must address project media, or null when its origin serves the site URL space. */
  assets: AssetContext | null;
  mapperCtx: WireMapperCtx;
  siteStyle: JxStyle | null;
  /** The state key of the entry drawn live inside its collection's page, or null for none. */
  entryRoot: string | null;
  /** The client script of every document this render is composed from, by its specifier. */
  scripts: CanvasScripts;
}> {
  const S = { documentPath: tab?.documentPath, mode: tab?.doc.mode };
  const canvasMode = modeOverride ?? canvasModeOfTab(tab);
  const fileBase = documentBase(projectState?.projectRoot);
  /* Each document is addressed BEFORE it is merged with another (canvas-scripts.ts), and after it
     is copied: the copy below is a structured clone in Preview, which a qualified copy still
     holding the tab's reactive nodes could not be given to. */
  const scripts = scriptCollector(fileBase);
  const unsaved = tab?.doc.dirty === true;

  let renderDoc = scripts.own(
    canvasMode === "preview"
      ? structuredClone(toRaw(doc))
      : prepareForEditMode(stripEventHandlers(doc)),
    S.documentPath,
    unsaved,
  );

  let layoutWrapped = false;
  const isPage = S.documentPath && projectState?.isSiteProject && isPagePath(S.documentPath);
  /* A collection entry written on the canvas is drawn the way a page is: inside a layout, with the
     layout's nodes locked and the entry's own tree the editable region (studio.md §22.5). */
  const isEntry =
    !isPage && Boolean(projectState?.isSiteProject) && writesEntryOnCanvas(S.documentPath);
  let pageContentPrefix: (string | number)[] | null = null;
  let pageContentOffset = 0;

  // Layout wrapping obeys the tab-bar's "show layout elements" toggle (default on); with it off,
  // The page renders alone — the unwrapped path is identical to a non-layout page.
  let entryPage: EntryPage | null = null;
  if ((isPage || isEntry) && tab?.session.ui.showLayout !== false) {
    const layoutPath = isEntry
      ? await entryLayout(doc, tab, S.documentPath)
      : getEffectiveLayoutPath(pageLayout(doc, tab));
    /* An entry goes into its collection's page first, and the page into the layout: the order the
       build composes them in (studio.md §22.5). */
    let pageForSlots =
      canvasMode === "preview"
        ? scripts.own(structuredClone(toRaw(doc)), S.documentPath, unsaved)
        : renderDoc;
    if (isEntry && S.documentPath) {
      entryPage = await entryInPage(
        pageForSlots,
        S.documentPath,
        canvasMode !== "preview",
        scripts,
      );
      pageForSlots = entryPage?.doc ?? pageForSlots;
    }
    const layoutDoc = layoutPath
      ? await resolveCanvasLayout(layoutPath, new Set<string>(), scripts)
      : null;
    if (!layoutDoc && entryPage) {
      // A page with no layout: the page alone is the frame the entry is written in.
      const pageDoc = entryPage.doc;
      renderDoc =
        canvasMode === "preview" ? pageDoc : prepareForEditMode(stripEventHandlers(pageDoc));
      layoutWrapped = true;
      const pageContent = findPageContentPrefix(pageDoc);
      pageContentPrefix = pageContent?.prefix ?? null;
      pageContentOffset = pageContent?.offset ?? 0;
    }
    if (layoutDoc) {
      const merged = distributePageIntoLayout(layoutDoc, pageForSlots);
      renderDoc =
        canvasMode === "preview" ? merged : prepareForEditMode(stripEventHandlers(merged));
      layoutWrapped = true;
      if (S.documentPath) {
        /* SAFETY: a document's `$elements` entries are tag-name strings, `{ $ref }` imports or
             inline element definitions (a hand-edited null among them is skipped by the walk). */
        rebaseLayoutElementRefs(
          renderDoc.$elements as (JxElement | string | null)[] | undefined,
          S.documentPath,
        );
      }
      const pageContent = findPageContentPrefix(merged);
      pageContentPrefix = pageContent?.prefix ?? null;
      pageContentOffset = pageContent?.offset ?? 0;
    }
  }

  /* `$site` / `$page`, and the project's own state, exactly as the build injects them — a layout
     that binds `${state.$page.url}` (a header marking its current link) threw on the canvas, and in
     Preview, where templates are live, that one TypeError blanked the whole page. Onto COPIES of
     `state` and `imports`: the edit-mode render doc shares both with the tab's source document,
     which must not gain injected keys it would then save. */
  const projectConfig = projectState?.projectConfig;
  if (isPage && projectConfig) {
    renderDoc = { ...renderDoc, state: { ...renderDoc.state } };
    if (renderDoc.imports) {
      renderDoc.imports = { ...renderDoc.imports };
    }
    /* SAFETY: a page render document is a JxDocument in all but its declared (mutable) type;
       `injectContext` writes `state`, `$media` and `imports`, all of which the copy above owns. */
    injectContext(renderDoc as JxDocument, projectConfig, {
      urlPattern: documentUrlPattern(S.documentPath),
    });
  }

  const docBase = S.documentPath ? new URL(S.documentPath, fileBase).href : undefined;
  /*
   * How this render addresses media, as PLAIN DATA — the resolver itself is a function and cannot
   * cross into the canvas realm, so the iframe rebuilds it from this.
   *
   * It replaces a walk over the render document that used to sit further down this function. A walk
   * can only ever see LITERAL values: `applyAttributes` resolves a `{"$ref": …}` or `"${…}"` src
   * inside a reactive effect, so at walk time a bound image src is not a string at all. That is why
   * a collection listing of thirty bound card images broke all at once in preview and nowhere else
   * — design and edit swap every bound src for a transparent pixel, so they never reached the
   * network to fail.
   */
  const assets = assetContextFor(S.documentPath, hostAssetDeclarations());

  // Substitute chosen dynamic route params ({$ref: "#/$params/x"} → literal), inject state.$page,
  // And bake the substituted class-prototype state entries via the backend resolver — in every
  // Mode, so ContentEntry state is real data for preview templates AND the design/edit data
  // Explorer. Pure rebuild: renderDoc shares node references with the tab's source document
  // (posted as shadowDoc), whose $refs must survive for editing/serialization.
  if (isPage && tab) {
    const { previewParams } = tab.session.ui;
    if (Object.keys(previewParams).length > 0) {
      const boundKeys = paramBoundStateKeys(doc.state ?? null);
      renderDoc = substitutePreviewParams(renderDoc, previewParams, S.documentPath);
      await resolveParamBoundState(renderDoc, boundKeys, docBase);
    }
  }

  // `$site` and `$page`, as the build injects them (canvas-page-context.ts), in every mode: Preview
  // Draws the page as it ships, and edit mode evaluates a component's bound props live. For a page
  // This refines the pair injected above with the chosen route params and the project's i18n, and
  // It is the only injection a collection entry gets.
  if ((isPage || isEntry) && S.documentPath) {
    const context = await pageContextFor(
      {
        documentPath: S.documentPath,
        fields: isEntry ? (tab?.doc.content.frontmatter ?? null) : null,
        isEntry,
        lang: doc.$lang,
        params: tab?.session.ui.previewParams ?? {},
        title: doc.title,
      },
      projectState?.projectConfig,
    );
    if (context) {
      // A rebuild, not a write: the render doc shares nodes with the tab's source document.
      renderDoc = { ...renderDoc, state: { ...renderDoc.state, ...context } };
    }
  }

  /* Class-backed state resolved before the render rather than by it (repeater-sources.ts): in every
     mode, an entry naming an enabled extension's class by a bare `$prototype`, as the build
     resolves it; in Edit and Design, also the collections a repeater reads, whose first item draws
     the repeater's template. */
  const extensions = await loadExtensions();
  const classes = extensionClassPaths(extensions);
  const bakeKeys = extensionClassKeys(renderDoc, classes);
  if (canvasMode !== "preview") {
    bakeKeys.push(...repeaterSourceKeys(doc));
  }
  renderDoc = await bakeRepeaterSources(renderDoc, [...new Set(bakeKeys)], docBase, classes);

  // Component definition docs (non-page): seed chosen test-prop values into the render doc's state
  // So a non-instantiated component previews with real data — templates, dataScope snapshots, and
  // Live/snapshot expression previews all see the values (M6, the previewParams mirror). Pure
  // Rebuild for the same reason as substitutePreviewParams above.
  if (!isPage && tab && isComponentDoc(renderDoc)) {
    const { previewProps } = tab.session.ui;
    if (previewProps && Object.keys(previewProps).length > 0) {
      renderDoc = substitutePreviewProps(renderDoc, previewProps);
    }
  }

  /* THE CONDITION IS "did `prepareForEditMode` run", not a list of modes, and the two had drifted.
     `prepareForEditMode` above builds a repeater perimeter for EVERY non-preview mode, and
     `arrayPaths` is what tells `classifyRenderNode` to collapse that perimeter's template hop back
     into a `map` segment. Naming two of those modes here meant a git-diff artboard grew the
     perimeters and then stamped every node under a `$prototype: "Array"` with the RENDER path
     instead of a document path — an address no document-space caller can resolve, which is exactly
     what a diff mark is. Stylebook and grid never reach this function with an array document, so
     the widening is only observable in git-diff. */
  const arrayPaths = new Set<string>();
  if (canvasMode !== "preview") {
    (function findArrayPaths(node: JxMutableNode, path: (string | number)[]) {
      // Document JSON can hold a null or scalar where a node belongs; it holds no repeater.
      if (!isNonNullObject(node)) {
        return;
      }
      if (node.$prototype === "Array") {
        arrayPaths.add(path.join("/"));
        const mapDef = node.map;
        if (isNonNullObject(mapDef)) {
          findArrayPaths(mapDef, [...path, "map"]);
        }
        return;
      }
      if (Array.isArray(node.children)) {
        for (const [i, child] of node.children.entries()) {
          if (isString(child)) {
            continue;
          }
          findArrayPaths(child, [...path, "children", i]);
        }
      } else if (isMappedArray(node.children)) {
        /* SAFETY: the bare mapped-array slot is a repeater node in all but its declared type, and
           the walk reads only what isMappedArray just established (`$prototype`) and its `map`
           template, an element definition. */
        findArrayPaths(node.children as JxMutableNode, [...path, "children"]);
      }
      if (node.$switch && node.cases) {
        for (const [k, v] of Object.entries(node.cases)) {
          findArrayPaths(v, [...path, "cases", k]);
        }
      }
    })(doc, []);
  }

  // Component auto-discovery (content mode, wrapped layout, or a layout opened on its own) —
  // Mirrors the legacy render path. A directly-opened layout is neither a page (so it never
  // Sets layoutWrapped) nor content mode (a plain .json file skips the mode-setting parse),
  // So it needs its own gate; scoping to layouts/ avoids the single-component-edit path, where
  // The doc's own root tag would otherwise inject a $ref to itself.
  const isLayoutDoc =
    S.documentPath != null &&
    (S.documentPath.startsWith("layouts/") || S.documentPath.startsWith("./layouts/"));
  /* SAFETY: a document's `$elements` entries are tag-name strings, `{ $ref }` imports or inline
     element definitions, each a JxElement or a string; getEffectiveElements only dedups them by the
     string itself or by `$ref`. */
  const effectiveElements = getEffectiveElements(renderDoc.$elements as (JxElement | string)[]);
  if ((S.mode === "content" || layoutWrapped || isLayoutDoc) && componentRegistry.length > 0) {
    const existingRefs = new Set(
      // A null entry in a document's `$elements` names nothing, so it contributes no ref.
      effectiveElements.map((e: JxElement | string) => (isNonNullObject(e) ? e.$ref : e)),
    );
    /* Every tag the render can reach: the document's own, then — through the registry's `uses` —
       each component's, transitively. Components address one another by bare `tagName` and declare
       no `$elements` (the build finds them project-wide), so a tag that only appears INSIDE a
       component (a card's panel, a header's theme toggle) was never registered here and rendered as
       an empty, unstyled element. */
    const byTag = new Map(componentRegistry.map((c: ComponentEntry) => [c.tagName, c]));
    /* SAFETY: a render document is JSON by construction (it crosses into the canvas realm by
       `postMessage`); the walk only reads `tagName`, `children`, `map` and `cases` off it. */
    const reachable = collectUsedTags(renderDoc as JsonValue);
    if (renderDoc.tagName) {
      reachable.add(displayTagName(renderDoc.tagName));
    }
    for (const tag of reachable) {
      for (const used of byTag.get(tag)?.uses ?? []) {
        reachable.add(used);
      }
    }
    for (const tag of reachable) {
      const comp = byTag.get(tag);
      if (comp && comp.source !== "npm" && comp.path) {
        const relPath = computeRelativePath(S.documentPath ?? null, comp.path);
        if (!existingRefs.has(relPath)) {
          effectiveElements.push({ $ref: relPath });
          existingRefs.add(relPath);
        }
      }
    }
  }
  if (effectiveElements.length > 0) {
    renderDoc.$elements = effectiveElements;
  }
  renderDoc.imports = getEffectiveImports(renderDoc.imports, extensions);
  // The effective-media/head getters always answer a value: the merge, or an empty one.
  renderDoc.$media = getEffectiveMedia(renderDoc.$media);
  renderDoc.$head = getEffectiveHead(renderDoc.$head);

  /* The page's entry state is the entry being written, set last so nothing between here and the
     page read (the class bake above) resolves the page's ContentEntry from disk over it. A rebuild,
     not a write: the render doc's state is shared with documents the tab saves. */
  if (entryPage && S.documentPath) {
    renderDoc = {
      ...renderDoc,
      state: { ...renderDoc.state, [entryPage.root]: liveEntryState(tab, S.documentPath) },
    };
  }

  return {
    assets,
    docBase,
    entryRoot: entryPage?.root ?? null,
    mapperCtx: {
      arrayPaths: [...arrayPaths],
      canvasMode,
      layoutWrapped,
      pageContentOffset,
      pageContentPrefix,
    },
    renderDoc,
    scripts: scripts.scripts,
    siteStyle: projectState?.projectConfig?.style ?? null,
  };
}
