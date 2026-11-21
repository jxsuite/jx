/**
 * The host's dependency graph (`specs/project-state.md` §8): for each document, the documents whose
 * rendering depends on it, by edge kind (§8.1), and the `dependentsInvalidated` events a change to
 * it causes.
 *
 * The module performs no I/O. A host parses a document, hands the parsed value to
 * {@link extractRefs}, and gives the result to the graph with the document's id and path; what the
 * graph needs from the project configuration and the collection loader arrives through
 * {@link DependencyGraph.configure}. That keeps the same module bundleable for every host: Bun
 * imports it as source, and a Durable Object, a browser or the desktop backend's Node bundle bundle
 * it unchanged (`packages/server/tests/refs-export.test.ts` proves its module graph has no
 * filesystem, process or watcher import).
 *
 * References come from `walkDocRefs` and tag uses from the walk behind `countTagUses`, imported
 * from the pure `refs.ts` module and never from the `./refactor` index, so the graph cannot
 * disagree with the rename refactor or the usage query (§12).
 *
 * @module
 */

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { PROJECT_FILE_NAMES } from "@jxsuite/schema/project-file";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { JsonValue } from "@jxsuite/schema/types";
import { DEPENDENCY_KIND_ORDER } from "@jxsuite/protocol/project-state";
import type {
  DependencyKind,
  DocId,
  DocKind,
  EventOrigin,
  ProjectEventInit,
} from "@jxsuite/protocol/project-state";
import { classifyRef, joinPosix, projectPathsForRootedRef } from "../refactor/paths.ts";
import { collectTagUses, walkDocRefs } from "../refactor/refs.ts";

// ─── What a document references ───────────────────────────────────────────────────────────────

/** One reference-bearing string `walkDocRefs` offered, exactly as authored. */
export interface ExtractedRef {
  value: string;
  /** The key that carried it (`walkDocRefs`' `refType`). */
  refType: string;
  /** Whether a bare value resolves against the project root rather than the document. */
  rootRelativeBare: boolean;
}

/**
 * A document's outgoing references, unresolved. The graph resolves them against the document's
 * current path and configuration, so a relabel or a configuration change re-resolves them without
 * the document being parsed again.
 */
export interface DocumentRefs {
  /** Every file reference in the document (`walkDocRefs`). */
  refs: readonly ExtractedRef[];
  /** The custom-element tags the document instantiates, its own definition's excluded. */
  tags: readonly string[];
  /**
   * How many nodes carry each `tagName`, every tag and the document's own root included: the tally
   * the usage query reads one tag of (`countTagUses`, §12).
   */
  tagCounts: Readonly<Record<string, number>>;
  /** The tag a component definition declares, `null` for every other document. */
  defines: string | null;
  /** Whether the document is a page that names no layout, so it wraps in `defaults.layout`. */
  implicitLayout: boolean;
  /**
   * The content types the document queries: `ContentCollection` and `ContentEntry` state in any
   * scope, and every `contentType` its `$paths` names, `each` included.
   */
  contentTypes: readonly string[];
  /**
   * The `$prototype` names the document uses that its own `imports` do not map, so the project
   * configuration's `imports` resolve them (`imports.md` §1.1).
   */
  prototypes: readonly string[];
}

/** The references of a document that has none, such as a media file or a stylesheet. */
export const NO_REFS: DocumentRefs = Object.freeze({
  contentTypes: [],
  defines: null,
  implicitLayout: false,
  prototypes: [],
  refs: [],
  tagCounts: {},
  tags: [],
});

/** The state prototypes that read a content collection (`site-architecture.md` §6.4). */
const CONTENT_PROTOTYPES = new Set(["ContentCollection", "ContentEntry"]);

/** Add `value`'s content type names, one or a list, to `into`. */
function addTypes(value: JsonValue | undefined, into: Set<string>): void {
  for (const type of Array.isArray(value) ? value : [value]) {
    if (isString(type)) {
      into.add(type);
    }
  }
}

/** Every `contentType` under a `$paths` source, `each` and nested sources included. */
function pathsContentTypes(node: JsonValue, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      pathsContentTypes(item, into);
    }
    return;
  }
  if (!isJsonObject(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "contentType") {
      addTypes(value, into);
    } else {
      pathsContentTypes(value, into);
    }
  }
}

/**
 * The content types a document queries and the prototype names it uses, from every scope: a nested
 * element's `state` lists a collection as the root's does (`spec.md` §23.3), and a `$paths` source
 * names its type (`site-architecture.md` §4.3).
 */
function queriesOf(doc: JsonValue) {
  const types = new Set<string>();
  const prototypes = new Set<string>();
  const visit = (node: JsonValue): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (!isJsonObject(node)) {
      return;
    }
    if (isString(node.$prototype)) {
      prototypes.add(node.$prototype);
      if (CONTENT_PROTOTYPES.has(node.$prototype)) {
        addTypes(node.contentType, types);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$paths") {
        pathsContentTypes(value, types);
      } else {
        visit(value);
      }
    }
  };
  visit(doc);
  const root = isJsonObject(doc) ? doc : null;
  const own = root !== null && isJsonObject(root.imports) ? root.imports : {};
  return {
    contentTypes: [...types].toSorted(),
    prototypes: [...prototypes].filter((name) => !Object.hasOwn(own, name)).toSorted(),
  };
}

/**
 * Extract a parsed document's references for the graph. Pure: `doc` is read, never written.
 *
 * @param doc - The parsed document (a JSON document, or what a format parser produced)
 * @param kind - The document's kind in the index (§2.2)
 */
export function extractRefs(doc: JsonValue, kind: DocKind): DocumentRefs {
  const refs: ExtractedRef[] = [];
  walkDocRefs(doc, (value, refType, rootRelativeBare) => {
    refs.push({ refType, rootRelativeBare, value });
    return null;
  });
  const root = isJsonObject(doc) ? doc : null;
  const rootTag = root !== null && isString(root.tagName) ? root.tagName : null;
  const defines = kind === "component" && rootTag?.includes("-") === true ? rootTag : null;
  const uses = collectTagUses(doc);
  const tags = [...uses.keys()].filter((tag) => tag.includes("-") && tag !== defines).toSorted();
  const { contentTypes, prototypes } = queriesOf(doc);
  return {
    contentTypes,
    defines,
    implicitLayout: kind === "page" && root !== null && root.$layout === undefined,
    prototypes,
    refs,
    tagCounts: Object.fromEntries(uses),
    tags,
  };
}

// ─── The graph ────────────────────────────────────────────────────────────────────────────────

/** What the graph reads from the project configuration and the collection loader. */
export interface DependencyGraphConfig {
  /**
   * The configuration's `defaults.layout` as authored (`./layouts/base.json`), `null` when it names
   * none. The graph resolves it against the project root, as it does a page's `$layout`.
   */
  defaultLayout?: string | null;
  /**
   * The configuration's `imports` as authored, name to path (`imports.md` §1.1). They cascade into
   * every document, so the file an import names is a `data-consumer` dependency of each document
   * whose `$prototype` uses the name and whose own `imports` do not map it.
   */
  imports?: Readonly<Record<string, string>>;
  /** Project-relative asset mounts, through which a rooted reference resolves. */
  mounts?: readonly AssetMount[];
  /**
   * Each content type's entry files, project-relative, as the collection loader resolved them. The
   * loader's list rather than the type's `source`, because a `{locale}` source is not a glob and
   * `exclude` and `where` leave files out. Between configuration changes the host keeps it current
   * entry by entry with {@link DependencyGraph.setEntryTypes}.
   */
  collections?: Readonly<Record<string, readonly string[]>>;
}

/** The documents one change invalidates through one edge kind. */
export interface Invalidation {
  kind: DependencyKind;
  /** Every dependent, transitive, once each, in a stable order; never the cause itself. */
  docIds: DocId[];
  /** The component tags the cause declared before and after the change. */
  tags: string[];
  /** `false` while a document whose references are unknown could be among the dependents (§8.2). */
  complete: boolean;
}

export interface DependencyGraphOptions {
  /**
   * Paths whose change invalidates every document (`project-config`): the project configuration and
   * the package manifest. Defaults to both spellings of the project file and `package.json`.
   */
  configPaths?: readonly string[];
}

export interface DependencyGraph {
  /**
   * Record a document's references, `null` for a document the host could not parse (unindexed,
   * §8.2), and answer the invalidations its change causes. Call it when a document's bytes change
   * or it is added, including at a path documents already reference.
   */
  update: (docId: DocId, path: string, refs: DocumentRefs | null) => Invalidation[];
  /** Forget a removed document and answer the invalidations of its now dangling referrers. */
  remove: (docId: DocId) => Invalidation[];
  /** Move a document to `to`, re-resolving its references, and answer both paths' referrers. */
  relabel: (docId: DocId, to: string) => Invalidation[];
  /** Replace what the configuration and the collection loader say; on `projectConfigChanged`. */
  configure: (config: DependencyGraphConfig) => void;
  /**
   * Record the content types whose resolved entry list now includes the file at `path` (`[]` for
   * none), after the collection loader re-resolved them for a file event under a collection's
   * source. Call it BEFORE the `update`, `remove` or `relabel` of that event: a type the entry
   * joined reaches its readers through that change, and a type it left is remembered until then, so
   * the readers of both appear in the same one event per kind (§8) rather than in two.
   */
  setEntryTypes: (path: string, types: readonly string[]) => void;
  /** The document's dependents by the kind of the first edge that reaches them. */
  dependentsOf: (docId: DocId) => Map<DependencyKind, DocId[]>;
  /** The dependents of whatever is, or will be, at `path`. */
  dependentsAt: (path: string) => Map<DependencyKind, DocId[]>;
  /** The documents recorded with unknown references. */
  unindexed: () => DocId[];
  /**
   * Every document the graph holds, with its current path and the references it was given (`null`
   * for one whose references are unknown, §8.2): what the usage query answers from (§12).
   */
  documents: () => GraphDocument[];
}

/** One document as the graph holds it. */
export interface GraphDocument {
  docId: DocId;
  path: string;
  refs: DocumentRefs | null;
}

/** The edge a reference makes, by the key that carried it; `null` for none. */
function edgeKindOf(refType: string): DependencyKind | null {
  switch (refType) {
    case "$layout": {
      return "layout-page";
    }
    case "$src":
    case "imports": {
      // A page's own class import is read as its `$src` is (`imports.md` §1.1).
      return "data-consumer";
    }
    case "$ref":
    case "$elements": {
      return "component-instance";
    }
    case "source": {
      // A collection's source: its entries reach their readers through the loader's list.
      return null;
    }
    default: {
      return "media-referrer";
    }
  }
}

const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** A configuration path (`./layouts/base.json`, `/layouts/base.json`) as a project path. */
function projectPath(value: string): string | null {
  const cls = classifyRef(value);
  if (cls.kind !== "path") {
    return null;
  }
  const resolved = joinPosix("/", cls.core).slice(1);
  return resolved === "" ? null : resolved;
}

/** Every project path a reference in the document at `from` could name. */
function resolveRef(from: string, ref: ExtractedRef, mounts: readonly AssetMount[]): string[] {
  const cls = classifyRef(ref.value);
  if (cls.kind !== "path") {
    return [];
  }
  if (cls.rooted) {
    return projectPathsForRootedRef(cls.core, mounts);
  }
  const base = ref.rootRelativeBare ? "/" : `/${dirOf(from)}`;
  const resolved = joinPosix(base, cls.core).slice(1);
  return resolved === "" ? [] : [resolved];
}

interface GraphNode {
  path: string;
  refs: DocumentRefs | null;
  /** The resolved outgoing path edges. */
  edges: { kind: DependencyKind; path: string }[];
}

const addTo = <K, V>(map: Map<K, Set<V>>, key: K, value: V): void => {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
};

const deleteFrom = <K, V>(map: Map<K, Set<V>>, key: K, value: V): void => {
  const set = map.get(key);
  set?.delete(value);
  if (set?.size === 0) {
    map.delete(key);
  }
};

/** Create an empty graph. */
export function createDependencyGraph(options: DependencyGraphOptions = {}): DependencyGraph {
  const configPaths = new Set(options.configPaths ?? [...PROJECT_FILE_NAMES, "package.json"]);
  const nodes = new Map<DocId, GraphNode>();
  /** Target path → the documents referencing it, each with the edge kind it does so by. */
  const referrers = new Map<string, Map<DocId, Set<DependencyKind>>>();
  const tagUsers = new Map<string, Set<DocId>>();
  const typeReaders = new Map<string, Set<DocId>>();
  const prototypeUsers = new Map<string, Set<DocId>>();
  /** Project path → the configuration import names that map to it. */
  let importsAt = new Map<string, Set<string>>();
  /** Entry path → the content types it left since its last change (`setEntryTypes`). */
  const departed = new Map<string, Set<string>>();
  const implicitPages = new Set<DocId>();
  const unknown = new Set<DocId>();
  let defaultLayout: string | null = null;
  let mounts: readonly AssetMount[] = [];
  /** Entry path → the content types that include it. */
  let entryTypes = new Map<string, Set<string>>();

  const unlink = (docId: DocId, node: GraphNode): void => {
    for (const edge of node.edges) {
      const byDoc = referrers.get(edge.path);
      byDoc?.delete(docId);
      if (byDoc?.size === 0) {
        referrers.delete(edge.path);
      }
    }
    const refs = node.refs ?? NO_REFS;
    for (const tag of refs.tags) {
      deleteFrom(tagUsers, tag, docId);
    }
    for (const type of refs.contentTypes) {
      deleteFrom(typeReaders, type, docId);
    }
    for (const name of refs.prototypes) {
      deleteFrom(prototypeUsers, name, docId);
    }
    implicitPages.delete(docId);
    unknown.delete(docId);
  };

  const link = (docId: DocId, path: string, refs: DocumentRefs | null): void => {
    const edges: GraphNode["edges"] = [];
    /*
     * The configuration renders nothing, and its own references (`defaults.layout`, `imports`,
     * `copy`) reach the graph through `configure`. Recording them as edges would make every layout it names
     * invalidate the configuration, and through it every document.
     */
    const outgoing = configPaths.has(path) ? [] : (refs?.refs ?? []);
    for (const ref of outgoing) {
      const kind = edgeKindOf(ref.refType);
      if (kind === null) {
        continue;
      }
      for (const target of resolveRef(path, ref, mounts)) {
        if (target === path) {
          continue;
        }
        edges.push({ kind, path: target });
        const byDoc = referrers.get(target) ?? new Map<DocId, Set<DependencyKind>>();
        addTo(byDoc, docId, kind);
        referrers.set(target, byDoc);
      }
    }
    nodes.set(docId, { edges, path, refs });
    if (refs === null) {
      unknown.add(docId);
      return;
    }
    for (const tag of refs.tags) {
      addTo(tagUsers, tag, docId);
    }
    for (const type of refs.contentTypes) {
      addTo(typeReaders, type, docId);
    }
    for (const name of refs.prototypes) {
      addTo(prototypeUsers, name, docId);
    }
    if (refs.implicitLayout) {
      implicitPages.add(docId);
    }
  };

  /** The documents one edge away from `path`, and from the definitions of `tags`. */
  const direct = (path: string, tags: Iterable<string>): Map<DependencyKind, Set<DocId>> => {
    const out = new Map<DependencyKind, Set<DocId>>();
    for (const [docId, kinds] of referrers.get(path) ?? []) {
      for (const kind of kinds) {
        addTo(out, kind, docId);
      }
    }
    for (const tag of tags) {
      for (const docId of tagUsers.get(tag) ?? []) {
        addTo(out, "component-instance", docId);
      }
    }
    if (defaultLayout !== null && path === defaultLayout) {
      for (const docId of implicitPages) {
        addTo(out, "layout-page", docId);
      }
    }
    for (const type of entryTypes.get(path) ?? []) {
      for (const docId of typeReaders.get(type) ?? []) {
        addTo(out, "content-collection", docId);
      }
    }
    for (const name of importsAt.get(path) ?? []) {
      for (const docId of prototypeUsers.get(name) ?? []) {
        addTo(out, "data-consumer", docId);
      }
    }
    if (configPaths.has(path)) {
      for (const docId of nodes.keys()) {
        addTo(out, "project-config", docId);
      }
    }
    return out;
  };

  /** The tags a document declares, for the dependents of its definition. */
  const definedBy = (docId: DocId): string[] => {
    const defines = nodes.get(docId)?.refs?.defines;
    return defines === null || defines === undefined ? [] : [defines];
  };

  /**
   * The dependents of `paths` and `tags` by first-hop kind, each group closed transitively over
   * every kind and never containing `cause`.
   */
  const reach = (
    paths: readonly string[],
    tags: readonly string[],
    cause: DocId | null,
    first = new Map<DependencyKind, Set<DocId>>(),
  ): Map<DependencyKind, DocId[]> => {
    for (const path of paths) {
      for (const [kind, ids] of direct(path, tags)) {
        for (const id of ids) {
          addTo(first, kind, id);
        }
      }
    }
    const out = new Map<DependencyKind, DocId[]>();
    for (const kind of DEPENDENCY_KIND_ORDER) {
      const seen = new Set(first.get(kind));
      if (cause !== null) {
        seen.delete(cause);
      }
      const queue = [...seen];
      while (queue.length > 0) {
        const id = queue.pop()!;
        const node = nodes.get(id)!;
        for (const next of direct(node.path, definedBy(id)).values()) {
          for (const dependent of next) {
            if (dependent !== cause && !seen.has(dependent)) {
              seen.add(dependent);
              queue.push(dependent);
            }
          }
        }
      }
      if (seen.size > 0) {
        out.set(kind, [...seen].toSorted());
      }
    }
    return out;
  };

  const invalidate = (
    cause: DocId,
    paths: readonly string[],
    tags: readonly string[],
  ): Invalidation[] => {
    const tagList = [...new Set(tags)].toSorted();
    const complete = [...unknown].every((id) => id === cause);
    // The readers of a collection the entry left still listed it, so they are invalidated too.
    const left = new Map<DependencyKind, Set<DocId>>();
    for (const path of paths) {
      for (const type of departed.get(path) ?? []) {
        for (const docId of typeReaders.get(type) ?? []) {
          addTo(left, "content-collection", docId);
        }
      }
      departed.delete(path);
    }
    return [...reach([...new Set(paths)], tagList, cause, left)].map(([kind, docIds]) => ({
      complete,
      docIds,
      kind,
      tags: tagList,
    }));
  };

  const rebuild = (): void => {
    const all = [...nodes];
    for (const [docId, node] of all) {
      unlink(docId, node);
    }
    for (const [docId, node] of all) {
      link(docId, node.path, node.refs);
    }
  };

  return {
    configure(config) {
      defaultLayout = isString(config.defaultLayout) ? projectPath(config.defaultLayout) : null;
      mounts = config.mounts ?? [];
      importsAt = new Map();
      for (const [name, value] of Object.entries(config.imports ?? {})) {
        const path = projectPath(value);
        if (path !== null) {
          addTo(importsAt, path, name);
        }
      }
      // A configuration change invalidates every document, so no departure is still owed.
      departed.clear();
      entryTypes = new Map();
      for (const [type, entries] of Object.entries(config.collections ?? {})) {
        for (const entry of entries) {
          addTo(entryTypes, entry, type);
        }
      }
      rebuild();
    },
    dependentsAt: (path) => reach([path], [], null),
    dependentsOf(docId) {
      const node = nodes.get(docId);
      return node === undefined ? new Map() : reach([node.path], definedBy(docId), docId);
    },
    setEntryTypes(path, types) {
      const next = new Set(types);
      for (const type of entryTypes.get(path) ?? []) {
        if (!next.has(type)) {
          addTo(departed, path, type);
        }
      }
      for (const type of next) {
        deleteFrom(departed, path, type);
      }
      if (next.size === 0) {
        entryTypes.delete(path);
      } else {
        entryTypes.set(path, next);
      }
    },
    relabel(docId, to) {
      const node = nodes.get(docId);
      if (node === undefined) {
        return [];
      }
      unlink(docId, node);
      link(docId, to, node.refs);
      return invalidate(docId, [node.path, to], definedBy(docId));
    },
    remove(docId) {
      const node = nodes.get(docId);
      if (node === undefined) {
        return [];
      }
      const tags = definedBy(docId);
      unlink(docId, node);
      nodes.delete(docId);
      return invalidate(docId, [node.path], tags);
    },
    unindexed: () => [...unknown].toSorted(),
    documents: () =>
      [...nodes].map(([docId, node]) => ({ docId, path: node.path, refs: node.refs })),
    update(docId, path, refs) {
      const before = nodes.get(docId);
      const tags = definedBy(docId);
      if (before !== undefined) {
        unlink(docId, before);
      }
      link(docId, path, refs);
      const paths = before === undefined ? [path] : [before.path, path];
      return invalidate(docId, paths, [...tags, ...definedBy(docId)]);
    },
  };
}

// ─── Events ───────────────────────────────────────────────────────────────────────────────────

type DependentsInvalidatedInit = Extract<ProjectEventInit, { type: "dependentsInvalidated" }>;

/**
 * One `dependentsInvalidated` per kind that reaches a dependent (§8), for the host to append after
 * the cause's file event and its `docChanged`.
 */
export function invalidationEvents(
  cause: DocId,
  invalidations: readonly Invalidation[],
  origin: EventOrigin,
): DependentsInvalidatedInit[] {
  return invalidations.map((invalidation) => ({
    cause: { docId: cause, kind: invalidation.kind },
    complete: invalidation.complete,
    docIds: [...invalidation.docIds],
    origin,
    tags: [...invalidation.tags],
    type: "dependentsInvalidated",
  }));
}
