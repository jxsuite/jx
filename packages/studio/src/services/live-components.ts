/**
 * Live project components: a project's own component definition reaching every canvas frame the
 * moment it changes.
 *
 * A canvas frame defines a project component by URL the first time a document's `$elements` names
 * it (`canvas/iframe-render.ts` `registerElements`), and the runtime never defines a tag twice: the
 * custom element registry is one-shot, and `defineElement` keys its own fetch on the URL. So a
 * component saved in Studio, or rewritten on disk by an editor, git or an assistant, used to leave
 * every open frame drawing the definition it fetched first, and the stylebook's specimens with it,
 * until the window was reloaded. Re-fetching cannot fix that, whatever the URL carries: the tag is
 * already defined, so a second definition by URL is a no-op. What fixes it is the runtime's own
 * replacement path (embedding.md §7), which the chrome lane (`live-surfaces.ts`) already posts to
 * every frame for Studio's kit components; this module is that same post for every OTHER component
 * a project defines.
 *
 * **The canvas frames only, never the shell.** The shell's realm hosts Studio's own `jx-*` kit, and
 * a project is free to name a component anything a custom element may be called. Redefining a
 * project tag in the shell could replace a control the chrome is drawn from, so this lane posts to
 * the frames, whose realms hold only what the project's documents defined, and leaves the shell
 * alone. The kit's own files stay the chrome lane's: a path that lane claims is skipped here, so
 * one save never posts twice.
 *
 * Two doors lead in, and they are the two ways a definition changes:
 *
 * - **A save** ({@link LiveComponentLane.saved}): the document the tab just wrote, handed over by the
 *   save path, never read back.
 * - **A change on disk** ({@link LiveComponentLane.changedOnDisk}): a `change` event for a file
 *   Studio did not write (the event stream's echo filter has already dropped Studio's own). The
 *   file is read and parsed, and the component registry is brought up to date from it as a save
 *   would bring it, since the scan that built the registry ran when the project opened. A file open
 *   in a DIRTY tab is left alone: the author's unsaved definition is the one being edited, and its
 *   save is what redefines.
 *
 * Either way the Library's rendered preview of that file is evicted, so the next paint renders it
 * again rather than showing the card the old definition drew, and the preview realm is told the
 * tag's definition changed: a realm whose registry already holds the tag is replaced, because no
 * registry can redefine one (`project-state.md` §11.2). The shell's own registry is never asked.
 *
 * While the host's project state subscription is live (`project-state.md` §11.1), the change on
 * disk arrives as the `docChanged` of a document Studio did not write, and a third door joins
 * them:
 *
 * - **A dependency changed** ({@link LiveComponentLane.dependentsInvalidated}): the host's
 *   `dependentsInvalidated` names the documents whose rendering depends on a changed file and the
 *   tags whose definitions changed with it. Each dependent's preview is evicted, and each tag's
 *   definition is re-read and redefined as a change on disk is, unless its current bytes already
 *   came through the save door or the change-on-disk door.
 *
 * @docs studio/design/components
 */
import { componentMetaFrom } from "@jxsuite/schema/component-meta";
import { isNativeDocumentPath, parseNativeDocument } from "@jxsuite/schema/jxn";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";
import { canvasBaseFor, liveSurfaceTarget } from "./live-surfaces";

/** What one change did. */
export interface LiveComponentResult {
  /** The custom element name the changed file defines. */
  readonly tag: string;
  /** How many canvas frames were told of the redefinition. */
  readonly canvases: number;
  /** Whether the component registry's entry for the file changed (a disk change only). */
  readonly registryChanged: boolean;
}

/** The open tab state the lane reads: which paths are open, and whether each holds unsaved work. */
export interface LiveComponentTab {
  readonly documentPath: string | null;
  readonly doc: { readonly dirty: boolean };
}

/**
 * What the lane needs from the shell, injected so this module imports no canvas, panel or platform
 * and a test hands it plain records.
 */
export interface LiveComponentDeps {
  /** The workspace record; `projectRoot` and `tabs` are read at change time, never captured. */
  workspace: {
    readonly projectRoot: string | null;
    readonly tabs: ReadonlyMap<string, LiveComponentTab>;
  };
  /**
   * Redefine an element in every live canvas frame and render them; answers how many were told.
   * `canvas-render.ts`'s `redefineElementOnCanvases`.
   */
  redefineOnCanvases: (doc: JxDocument, base: string) => number;
  /** Drop the Library's rendered preview of a path (`browse/library-preview.ts`). */
  evictPreview: (path: string) => void;
  /**
   * The definitions of `tags` changed: the preview realm is replaced if it holds one
   * (`preview-realm/client.ts`'s `previewDefinitionsChanged`).
   */
  redefineInPreviews?: (tags: readonly string[]) => void;
  /** Read a project file's text (`platform.readFile`). */
  readFile: (path: string) => Promise<string>;
  /**
   * Bring the component registry up to date with a document read from disk; answers whether it
   * changed. `files/components.ts`'s `noteComponentSaved`, which the save path already calls.
   */
  noteComponent: (path: string, doc: JxDocument) => boolean;
  /** Repaint what reads the registry and the previews (the left panel). */
  repaint: () => void;
  /**
   * The project file that defines a custom element, if the registry has one
   * (`files/components.ts`'s `componentPathOf`).
   */
  componentPath?: (tag: string) => string | undefined;
}

/** The lane's doors. Each resolves to what it did, or null when the file was not a component. */
export interface LiveComponentLane {
  saved: (path: string | null, doc: JxDocument | null) => LiveComponentResult | null;
  changedOnDisk: (path: string) => Promise<LiveComponentResult | null>;
  /**
   * Documents whose rendering depends on a changed one, and the tags whose definitions changed: the
   * dependents' previews are evicted and each tag's definition goes through {@link changedOnDisk},
   * unless `applied` says its file's current bytes already reached the canvas (Studio saved them,
   * or a change on disk already brought them).
   */
  dependentsInvalidated: (
    paths: readonly string[],
    tags: readonly string[],
    applied: (path: string) => boolean,
  ) => Promise<(LiveComponentResult | null)[]>;
}

/**
 * The custom element a document defines, or null when it is not a component: the same test the
 * registry's scan applies (`componentMetaFrom`, a hyphenated `tagName`).
 */
export function componentTagOf(doc: JxDocument | null | undefined, path: string): string | null {
  /* SAFETY: a document Studio parsed from a JSON or JXN file holds JSON values only, which is the
     model the extractor reads; anything else it returns null for. */
  const meta = componentMetaFrom(doc as JsonValue | undefined, path);
  return meta ? meta.tagName : null;
}

/**
 * Build the lane.
 *
 * @param deps The shell's workspace record and the canvas, preview and registry hooks.
 */
export function createLiveComponentLane(deps: LiveComponentDeps): LiveComponentLane {
  /** Post one definition to the frames and evict its preview. Null for a file this lane skips. */
  function apply(
    path: string,
    doc: JxDocument,
  ): Omit<LiveComponentResult, "registryChanged"> | null {
    const root = deps.workspace.projectRoot;
    // The kit's own files belong to the chrome lane, which posts to the frames itself.
    if (!root || liveSurfaceTarget(root, path)) {
      return null;
    }
    const tag = componentTagOf(doc, path);
    if (!tag) {
      return null;
    }
    deps.evictPreview(path);
    deps.redefineInPreviews?.([tag]);
    let base: string;
    try {
      base = canvasBaseFor(root, path);
    } catch {
      /* No absolute document base (a shell whose origin is opaque): no frame can have mounted at
         one either, so none holds a definition to replace. The save goes on regardless. */
      return { canvases: 0, tag };
    }
    const canvases = deps.redefineOnCanvases(doc, base);
    return { canvases, tag };
  }

  function openDirty(path: string): boolean {
    for (const tab of deps.workspace.tabs.values()) {
      if (tab.documentPath === path && tab.doc.dirty) {
        return true;
      }
    }
    return false;
  }

  const lane: LiveComponentLane = {
    async changedOnDisk(path) {
      if (!deps.workspace.projectRoot || !isNativeDocumentPath(path) || openDirty(path)) {
        return null;
      }
      const root = deps.workspace.projectRoot;
      let doc: JxDocument;
      try {
        doc = parseNativeDocument(await deps.readFile(path), path);
      } catch {
        // A file mid-write, or one that no longer parses: the next change event tries again.
        return null;
      }
      // The project closed, or another opened, while the file was read.
      if (deps.workspace.projectRoot !== root) {
        return null;
      }
      const registryChanged = deps.noteComponent(path, doc);
      const applied = apply(path, doc);
      if (applied || registryChanged) {
        deps.repaint();
      }
      return applied ? { ...applied, registryChanged } : null;
    },
    saved(path, doc) {
      if (!path || !doc) {
        return null;
      }
      const applied = apply(path, doc);
      return applied ? { ...applied, registryChanged: false } : null;
    },
    async dependentsInvalidated(paths, tags, applied) {
      for (const path of paths) {
        deps.evictPreview(path);
      }
      deps.redefineInPreviews?.(tags);
      const definitions = new Set<string>();
      for (const tag of tags) {
        const path = deps.componentPath?.(tag);
        if (path !== undefined && !applied(path)) {
          definitions.add(path);
        }
      }
      return Promise.all([...definitions].map(async (path) => lane.changedOnDisk(path)));
    },
  };
  return lane;
}
