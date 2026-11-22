/**
 * Derive.ts — what each change the content store applies means for Studio's caches
 * (`project-state.md` §11.1).
 *
 * Every cache Studio keeps about the open project is a function of the documents and hashes the
 * store holds, so while a subscription is live this module is the one place that reads its events
 * and says which caches are stale. The caches themselves are injected ({@link DerivationTargets}):
 * they live in panels and services far above the file layer, and `files/fs-events.ts` (which runs
 * the subscription) hands them over from the bootstrap.
 *
 * - **Which files exist** (`fileAdded`, `fileRemoved`, `fileRenamed`): the caches keyed on the file
 *   set (pages, templates, layouts, collections, media) and the usage counts are dropped, and the
 *   content versions of what went or moved are forgotten.
 * - **What a document holds** (`docChanged`, never a bare `fileChanged`, §4.3): the caches keyed on
 *   contents are dropped, and a document another writer changed reaches the live component lane.
 *   Studio's own write is known by the hash its `fileAdded` or `fileChanged` echo carried, since
 *   the `docChanged` that follows it carries only the host's origin.
 * - **What a document's rendering depends on** (`dependentsInvalidated`): the dependents' derived
 *   caches go, and a definition whose tag changed is redefined unless its current bytes already
 *   reached the canvas (Studio's own save, or the `docChanged` before it). An invalidation that is
 *   not `complete` (a partial graph, `project-state.md` §8.2) reaches every document the store
 *   holds as unindexed too.
 * - **The project** (`componentsChanged`, `formatsChanged`, `gitChanged`, `readiness`): the component
 *   registry is re-read, the format registry rebuilt, git status re-read, the Site panel
 *   re-indexed.
 *
 * A snapshot that replaces earlier state stands for every event it summarises: the paths it changed
 * are dropped as one structural change, and each project field that moved is reported as its event
 * would have reported it. The first snapshot a store takes reports no project field: Studio read
 * all of them itself while opening the project.
 *
 * @license MIT
 * @docs extending/embedding/platform-adapter
 */

import type { ContentHash, DocId, ReadinessState } from "@jxsuite/protocol/project-state";
import type { ContentStore, StoreChange } from "./store";
import type { AppliedEvent } from "./subscription";

/** The caches a store change can make stale; every member is the cache's own invalidator. */
export interface DerivationTargets {
  /** Drop every memoised usage query (`services/references.ts`). */
  invalidateUsages: () => void;
  /** Forget the listing versions of files and of everything under directories (`asset-versions`). */
  forgetVersions: (paths: readonly string[], dirs: readonly string[]) => void;
  /**
   * The store holds the current hash of each of `paths` (`asset-versions`'
   * `derivedVersionsChanged`): a version {@link forgetVersions} withheld for them is current
   * again.
   */
  releaseVersions?: ((paths: readonly string[]) => void) | undefined;
  /**
   * Drop the caches keyed on the project's files: `structural` when the file set itself changed, as
   * `FsSyncContext.invalidateDerivedCaches` takes it.
   */
  invalidateDerivedCaches?: ((paths: readonly string[], structural: boolean) => void) | undefined;
  /** Another writer changed a document's bytes (the live component lane's door). */
  documentChanged?: ((path: string) => void) | undefined;
  /**
   * Documents whose rendering depends on a changed one, and the tags whose definitions changed.
   * `applied` says whether a path's current bytes have already reached the canvas: Studio wrote
   * them (the save path applied them) or {@link documentChanged} was already told of them.
   */
  dependentsInvalidated?:
    | ((
        paths: readonly string[],
        tags: readonly string[],
        applied: (path: string) => boolean,
      ) => void)
    | undefined;
  /** The set of discoverable components changed: re-read the registry. */
  componentsChanged?: (() => void) | undefined;
  /** The project's format set changed: rebuild the format registry. */
  formatsChanged?: (() => void) | undefined;
  /** The repository's state changed: re-read git status. */
  gitChanged?: (() => void) | undefined;
  /** The host's readiness moved. */
  readinessChanged?: ((state: ReadinessState) => void) | undefined;
  /** Repaint what draws the dropped caches (the left panel). */
  repaint: () => void;
}

/** Applies store changes to the caches; one per subscription. */
export interface StoreDerivations {
  /** A batch of events the subscription applied, in revision order. */
  events: (applied: readonly AppliedEvent[]) => void;
  /** A snapshot the subscription applied, with what it changed. */
  snapshot: (change: StoreChange) => void;
}

/** The project fields a snapshot can move, as comparable values. */
interface ProjectFields {
  components: string;
  formats: string | null;
  git: string;
  readiness: ReadinessState | null;
}

function fieldsOf(store: ContentStore): ProjectFields {
  return {
    components: JSON.stringify(store.components),
    formats: store.formats,
    git: JSON.stringify(store.git),
    readiness: store.readiness,
  };
}

/** Derive the caches from `store`'s changes. */
export function createStoreDerivations(
  store: ContentStore,
  targets: DerivationTargets,
): StoreDerivations {
  /**
   * The hash each document's bytes had when they last reached the canvas: Studio's own write, or a
   * change {@link DerivationTargets.documentChanged} was told of. Another writer's file event clears
   * it until its `docChanged` arrives.
   */
  const appliedHashes = new Map<DocId, ContentHash>();
  let last = fieldsOf(store);
  /** Whether a snapshot has been taken, so a later one's fields can be compared with it. */
  let seen = store.readiness !== null;

  const isApplied = (path: string): boolean => {
    const doc = store.docAt(path);
    return doc?.hash !== undefined && appliedHashes.get(doc.docId) === doc.hash;
  };

  /** Record who wrote a file's current bytes: Studio's are applied already, nobody else's are. */
  const attribute = (docId: DocId, hash: ContentHash | undefined, own: boolean) => {
    if (own && hash !== undefined) {
      appliedHashes.set(docId, hash);
    } else {
      appliedHashes.delete(docId);
    }
  };

  /** Tell the lane another writer changed a document, once per hash. */
  const changed = (path: string) => {
    const doc = store.docAt(path);
    if (doc?.hash !== undefined) {
      appliedHashes.set(doc.docId, doc.hash);
    }
    targets.documentChanged?.(path);
  };

  /** Drop the file caches for `paths`, then repaint once. */
  const drop = (paths: readonly string[], structural: boolean) => {
    targets.invalidateUsages();
    targets.invalidateDerivedCaches?.(paths, structural);
  };

  return {
    events(applied) {
      const structural = new Set<string>();
      const contents = new Set<string>();
      const forgotten: string[] = [];
      const forgottenDirs: string[] = [];
      let repaint = false;
      for (const { event, own } of applied) {
        switch (event.type) {
          case "fileAdded": {
            structural.add(event.path);
            attribute(event.docId, event.hash, own);
            break;
          }
          case "fileChanged": {
            attribute(event.docId, event.hash, own);
            break;
          }
          case "fileRemoved": {
            structural.add(event.path);
            forgotten.push(event.path);
            if (event.isDir) {
              forgottenDirs.push(event.path);
            }
            appliedHashes.delete(event.docId);
            break;
          }
          case "fileRenamed": {
            structural.add(event.from);
            structural.add(event.to);
            forgotten.push(event.from);
            if (event.isDir) {
              forgottenDirs.push(event.from);
            }
            break;
          }
          case "docChanged": {
            contents.add(event.path);
            if (!own && appliedHashes.get(event.docId) !== event.hash) {
              changed(event.path);
            }
            break;
          }
          case "projectConfigChanged": {
            contents.add(event.path);
            break;
          }
          case "dependentsInvalidated": {
            const paths: string[] = [];
            for (const docId of event.docIds) {
              const path = store.document(docId)?.path;
              if (path !== undefined) {
                paths.push(path);
                contents.add(path);
              }
            }
            /* A partial graph's list is a lower bound (§8.2): every document the host could not
               read may depend on the cause too, so each one the store holds as unindexed goes. */
            if (!event.complete) {
              for (const doc of store.documents()) {
                if (!doc.isDir && !doc.indexed && !paths.includes(doc.path)) {
                  paths.push(doc.path);
                  contents.add(doc.path);
                }
              }
            }
            targets.dependentsInvalidated?.(paths, event.tags, isApplied);
            break;
          }
          case "componentsChanged": {
            targets.componentsChanged?.();
            repaint = true;
            break;
          }
          case "formatsChanged": {
            targets.formatsChanged?.();
            repaint = true;
            break;
          }
          case "gitChanged": {
            targets.gitChanged?.();
            break;
          }
          case "readiness": {
            targets.readinessChanged?.(event.state);
            repaint = true;
            break;
          }
          default: {
            // Conflicts, operations and watcher notices change no cache by themselves.
            break;
          }
        }
      }
      if (forgotten.length > 0) {
        targets.forgetVersions(forgotten, forgottenDirs);
      }
      if (structural.size > 0 || contents.size > 0) {
        drop([...structural, ...contents], structural.size > 0);
        repaint = true;
      }
      last = fieldsOf(store);
      if (repaint) {
        targets.repaint();
      }
    },
    snapshot(change) {
      appliedHashes.clear();
      const fields = fieldsOf(store);
      let repaint = false;
      if (change.paths.length > 0) {
        /* The listings' versions of what the snapshot replaced are stale, but the store already
           holds the new hashes: a forget withholds a derived version until the store reports the
           path again, and it just has, so the paths are released at once. */
        targets.forgetVersions(change.paths, []);
        targets.releaseVersions?.(change.paths);
        drop(change.paths, true);
        for (const path of change.paths) {
          if (store.docAt(path)?.isDir === false) {
            changed(path);
          }
        }
        repaint = true;
      }
      if (seen) {
        if (fields.components !== last.components) {
          targets.componentsChanged?.();
          repaint = true;
        }
        if (fields.formats !== last.formats) {
          targets.formatsChanged?.();
          repaint = true;
        }
        if (fields.git !== last.git) {
          targets.gitChanged?.();
        }
        if (fields.readiness !== last.readiness && fields.readiness !== null) {
          targets.readinessChanged?.(fields.readiness);
          repaint = true;
        }
      }
      seen = true;
      last = fields;
      if (repaint) {
        targets.repaint();
      }
    },
  };
}
