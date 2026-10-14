/**
 * Format registry — auto-discovery of format-extension classes from a project imports map.
 *
 * A class participates in format dispatch iff its .class.json carries a top-level `format` block.
 * Hosts (compiler, server, studio) build a registry from the project-level imports map and dispatch
 * file-extension work (parse, serialize, discover, load) through it. `.json` is the single native
 * built-in and never appears in a registry.
 *
 * All I/O is injected via FormatHostIO so the same module serves node (fs + import) and browser
 * (fetch + dynamic import) hosts.
 */

import { isFunction, isJsonObject, isString } from "./guards";
import { mediaTypeEssence, mediaTypeProblem } from "./media-type";
import type { AssetMount } from "./asset-paths";
import type { ExtensionRegistry } from "./extension-registry";
import type {
  ContentFieldValue,
  ContentLoaderEntry,
  ContentTypeSchema,
  JsonObject,
  JsonValue,
  JxDocument,
  JxDocumentValue,
  JxElement,
  JxHeadEntry,
  JxPathsDef,
  JxPrototypeDef,
  JxStateDefinition,
  ProjectConfig,
} from "../types";

export type FormatCapability = "parse" | "serialize" | "rewrite" | "discover" | "load";

export const FORMAT_CAPABILITIES: readonly FormatCapability[] = [
  "parse",
  "serialize",
  "rewrite",
  "discover",
  "load",
];

/**
 * All well-known static capability roles across admission blocks (specs/extensions.md §8): format
 * roles plus project-section (`projectData`, `resolvePaths`), compile-away (`lower`), build-time
 * asset emission (`emit`), `<head>` contribution (`head`), static asset mounts (`assets`),
 * server-mount (`mount`), and connector (`dialect`, `deploySchema`, `bindings`, `testConnection`)
 * roles.
 *
 * `rewrite` is the narrow sibling of `serialize`, and the two are not ranked: a format may declare
 * either, both or neither. `serialize` says "this document round-trips through me"; `rewrite` says
 * only "I can replace these authored values in my own source text and change nothing else". A
 * load-only format — a CSV collection is read to load entries, never re-emitted as a document — can
 * honestly promise the second and not the first, which is enough for a rename to repair a reference
 * living inside it (specs/extensions.md §8).
 */
export type ExtensionCapability =
  | FormatCapability
  | "projectData"
  | "resolvePaths"
  | "lower"
  | "emit"
  | "head"
  | "assets"
  | "mount"
  | "dialect"
  | "deploySchema"
  | "bindings"
  | "testConnection";

export const EXTENSION_CAPABILITIES: readonly ExtensionCapability[] = [
  ...FORMAT_CAPABILITIES,
  "projectData",
  "resolvePaths",
  "lower",
  "emit",
  "head",
  "assets",
  "mount",
  "dialect",
  "deploySchema",
  "bindings",
  "testConnection",
];

/**
 * One authored value the `rewrite` capability replaces in a document's own source text
 * (specs/extensions.md §8): every place the source holds exactly `from` becomes `to`, and nothing
 * else changes.
 */
export interface ValueEdit {
  /** The value as the format's `parse` produced it. */
  from: string;
  /** What to write in its place. */
  to: string;
}

export type FormatTiming = "compiler" | "server" | "client";

export type FormatDocumentKind = "page" | "component" | "content";

export interface FormatBlock {
  extensions: string[];
  mediaType?: string;
  documentKinds?: FormatDocumentKind[];
  exportTarget?: boolean;
  remote?: boolean;
}

export interface StudioHints {
  icon?: string;
  modes?: string[];
  documentMode?: {
    default?: "content" | "component";
    componentWhen?: { frontmatterKey?: string; matches?: string };
  };
  newFileTemplate?: string;
  elements?: {
    block?: string[];
    inline?: string[];
    void?: string[];
    textOnly?: string[];
    nesting?: Record<
      string,
      {
        block?: boolean;
        inline?: boolean;
        directive?: boolean;
        only?: string[];
      }
    >;
  };
  /** Any further hint a format declares; `.class.json` is JSON, so every hint is a JSON value. */
  [key: string]: JsonValue | undefined;
}

export interface CapabilityInfo {
  /** Static method name on the implementation class. */
  identifier: string;
  /** Environments allowed to call directly; others round-trip via the dev server. */
  timing: FormatTiming[];
  /** For `resolvePaths`: the `$paths` key that routes to this class. */
  discriminator?: string;
}

/** A class owns a project.json section iff its descriptor carries a `project` block. */
export interface ProjectBlock {
  /** The project.json top-level property the class owns. */
  key: string;
  title?: string;
  description?: string;
  referenceable?: boolean;
}

/** A class mounts routes in the site worker/dev server iff it carries a `server` block. */
export interface ServerBlock {
  basePath: string;
  order?: number;
  module?: string;
}

/** A class provides database connections iff it carries a `connector` block. */
export interface ConnectorBlock {
  provider: string;
  kind: "sqlite" | "postgres";
  local?: string;
  serve?: string;
  /** Provider-specific settings; the block is open by design and, like its descriptor, JSON. */
  [key: string]: JsonValue | undefined;
}

/**
 * Result shape of the connector `deploySchema` capability (specs/extensions.md §8): the compiled
 * additive DDL, whether it ran, and any drift warnings. Declared here, beside the capability's
 * name, because both the connector that answers it and the hosts that call it read it.
 */
export interface DeploySchemaResult {
  statements: string[];
  applied: boolean;
  warnings: string[];
}

/** Result shape of the connector `testConnection` capability (specs/extensions.md §8). */
export interface TestConnectionResult {
  ok: boolean;
  error?: string;
}

/**
 * What a schema push over a project's connections is asked to do: `jx db push` and the Studio
 * data-push route take the same two choices.
 */
export interface DataPushRequest {
  /** Restrict the push to one connection; omitted = every declared connection. */
  connection?: string;
  /** Compile the plan without executing it. */
  dryRun?: boolean;
}

// ─── Capability contracts (specs/extensions.md §8) ───────────────────────────

/**
 * The environment a dispatching host resolves connections and mounts against: env vars and secrets
 * by name (process.env merged under `.dev.vars` on the dev server and the CLI, specs/extensions.md
 * §13). Connections carry identifiers only; every secret is read from here.
 */
export type HostEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Options a host passes a format capability by name. They are JSON, as the method declares them in
 * its `parameters` (specs/extensions.md §8.2).
 */
export type FormatOptions = Readonly<Record<string, JsonValue | undefined>>;

/**
 * What a format's `parse` answers (specs/extensions.md §8): a Jx document, or, from a format that
 * declares only the `content` document kind, the entries it loaded.
 */
export type ParseResult = JxDocument | ContentLoaderEntry[];

/**
 * The export-mode options a site build hands `serialize` for an `exportTarget` sidecar
 * (specs/extensions.md §7): clean, lossy output that inlines the custom elements `componentDefs`
 * defines. The template hooks a site build adds are host code over the host's own scope, so the
 * host that supplies them declares them by merging into this interface.
 */
export interface SerializeExportOptions {
  mode: "export";
  componentDefs?: Map<string, JxElement>;
}

/** The options a format's `discover` receives from the content section's host. */
export interface FormatDiscoverOptions {
  /** The project root a relative `source` resolves against. */
  baseDir: string;
  /** The content type's `exclude` globs, passed only when it declares some. */
  exclude?: readonly string[] | undefined;
}

/** The options a format's `load` receives from the content section's host. */
export interface FormatLoadOptions {
  /** The content type's schema, which drives per-field coercion. */
  schema?: ContentTypeSchema | undefined;
  /** Directive options derived from the content type's `$elements`: the tags a directive may name. */
  directiveOptions?: { allowedNames: string[] } | undefined;
  /** The field an entry's id is read from. */
  idField?: string;
  /** A directory source's resolved root, from which nested entries take path-based ids. */
  sourceRoot?: string;
  /** The content type's GitHub-alert options: alert type to element, or `false` for blockquotes. */
  alerts?: JsonValue;
  /** Told of each alert marker whose type is not enabled (it stays a blockquote). */
  onUnknownAlert?: (type: string) => void;
}

/** Host context passed to a section owner's `projectData`. */
export interface ProjectDataContext {
  projectConfig?: ProjectConfig | undefined;
  /** Absolute project root directory. */
  root: string;
  /** The project's extension registry; format dispatch goes through its `formats` view. */
  registry: ExtensionRegistry;
  /** The host's injected I/O. */
  io?: FormatHostIO;
}

/**
 * A project section's loaded data: what its owner's `projectData` answers. Hosts keep it as
 * `_project[<key>]` and hand it, unread, to the owner's `resolvePaths` and to every `emit`. It is
 * document data, or a map of collection name to loaded entries (the `content` section's).
 */
export type ProjectSectionData = JxDocumentValue | Map<string, ContentLoaderEntry[]>;

/** What a `$paths` result carries about the entry its route was generated from. */
export type PathEntryMeta = NonNullable<ContentLoaderEntry["_meta"]>;

/**
 * One route a `resolvePaths` expands a page into: route parameter to value, plus the reserved
 * `_meta`, which the host strips before substituting the parameters.
 */
export interface PathParams {
  _meta?: PathEntryMeta;
  [param: string]: ContentFieldValue | PathEntryMeta | undefined;
}

/** Host context passed to a section owner's `resolvePaths`: the page being expanded, and its data. */
export interface ResolvePathsContext {
  /** The section's loaded data, as its owner's `projectData` answered it. */
  data: ProjectSectionData | undefined;
  /** The locale of the route being expanded, when the project has any. */
  locale: string | null | undefined;
  projectConfig: ProjectConfig | undefined;
  /** Absolute project root directory. */
  root: string;
  /** The dynamic page's parameter names, in order. */
  params?: readonly string[];
  /** The dynamic page's URL pattern (`/kb/:category/:slug`). */
  urlPattern?: string;
  /** The URL pattern of every dynamic page in the project. */
  patterns?: readonly string[];
}

/** Host context passed to a `lower` (specs/extensions.md §8.3). */
export interface LowerContext {
  projectConfig?: ProjectConfig | undefined;
  /** Absolute project root directory. */
  root: string;
  /** The route being compiled: its source file and resolved path parameters. */
  route: { sourcePath?: string; _pathParams?: Record<string, string> };
}

/** Host context passed to a section owner's `head` and `assets` (specs/extensions.md §8.5, §8.6). */
export interface SectionContext {
  projectConfig: ProjectConfig;
  /** Absolute project root directory. */
  root: string;
}

/** A route of the expanded route table, as an `emit` receives it. */
export interface EmitRoute {
  /** The route's URL, concrete once expanded (`/blog/hello`). */
  urlPattern: string;
  /** The page source the route renders. */
  sourcePath: string;
}

/** Host context passed to a section owner's `emit` (specs/extensions.md §8.4). */
export interface EmitHostContext extends SectionContext {
  /** Every loaded project section, by section key. */
  sections: Readonly<Record<string, ProjectSectionData>>;
  /** The expanded route table. */
  routes: readonly EmitRoute[];
}

/** One file an `emit` contributes to the build output; the host writes it (§8.4). */
export interface EmitFile {
  /** Output-directory-relative path; a leading `/` is tolerated. */
  path: string;
  content: string | Uint8Array;
}

/** What a host hands a mount (specs/extensions.md §11). */
export interface MountOptions {
  /** The route subtree the mount owns. */
  basePath: string;
  /** Run additive schema syncs on first touch (the dev server's local databases). */
  autoSync?: boolean;
  /**
   * Connector provider implementations by provider id, with the dev server's `local` stand-ins
   * applied (§12). The host relays them unread; the mount that receives them calls them.
   */
  connectors: Readonly<Record<string, ImplementationExport | null | undefined>>;
  /** Every extension-contributed project section the project declares, by section key. */
  sections: Readonly<Record<string, JxDocumentValue | undefined>>;
}

/** The fetch-style handler a mount answers with; the host dispatches its route subtree to it. */
export type MountHandler = (request: Request, env: HostEnvironment) => Promise<Response>;

/** The options a connector's `deploySchema` receives. */
export interface ConnectorDeployOptions {
  env: HostEnvironment;
  /** Compile the additive DDL without executing it. */
  dryRun?: boolean;
}

/**
 * A `data` section table definition, as a host hands it to a connector (§12). The connector owns
 * the full definition; a host reads only which connection the table lives on.
 */
export interface DataTableDefinition {
  connection?: string;
}

/** The options a section owner's `deploySchema` receives (specs/extensions.md §11.1). */
export interface SectionDeployOptions {
  env: HostEnvironment;
  /** Compile the steps without applying them. */
  dryRun?: boolean;
  /** The one connection a push is filtered to, when it is. */
  connection?: string;
  /** The connector providers the mounts receive, so a dev push reaches the same stand-ins. */
  connectors?: Readonly<Record<string, ImplementationExport | null | undefined>>;
}

/** One step a section owner contributes to a schema push (specs/extensions.md §11.1). */
export interface SectionPushStep {
  /** The step's kind; hosts default an empty one to the contributing section key. */
  kind: string;
  table?: string;
  /** One-line human description of the step. */
  summary: string;
  sql?: string;
  connection?: string;
}

/** What a section owner's `deploySchema` answers (specs/extensions.md §11.1). */
export interface SectionDeployResult {
  steps: SectionPushStep[];
  applied: boolean;
  warnings: string[];
  /** The connection the section lives on. */
  connection?: string;
}

/**
 * What a host passes each capability role and what the role answers: the contract a class signs
 * when it declares the role on a static method in `$defs.methods` (specs/extensions.md §8).
 * {@link FormatEntry.call} takes and returns exactly these, so no host restates a capability's
 * answer.
 *
 * `dialect` is absent on purpose. Its answer is the dialect of the host's own query builder, a type
 * this package cannot name, so the host that opens connections declares that role by merging into
 * this interface (the dev server's data API does, for Kysely).
 */
export interface CapabilityContracts {
  parse: { args: [source: string, options?: FormatOptions | undefined]; result: ParseResult };
  serialize: {
    args: [doc: JxDocumentValue, options?: FormatOptions | SerializeExportOptions | undefined];
    result: string;
  };
  rewrite: { args: [source: string, edits: readonly ValueEdit[]]; result: string };
  discover: { args: [source: string, options: FormatDiscoverOptions]; result: string[] };
  load: { args: [path: string, options: FormatLoadOptions]; result: ContentLoaderEntry[] };
  projectData: {
    args: [sectionValue: JxDocumentValue | undefined, context: ProjectDataContext];
    result: ProjectSectionData;
  };
  resolvePaths: {
    args: [pathsDef: JxPathsDef, context: ResolvePathsContext];
    result: PathParams[];
  };
  lower: { args: [def: JxPrototypeDef, context: LowerContext]; result: JxStateDefinition };
  /* `emit`, `head` and `assets`: a section owner with nothing to contribute may answer null, which
     contributes no files, no `<head>` entries and no mounts. */
  emit: {
    args: [sectionValue: JxDocumentValue | null, context: EmitHostContext];
    result: EmitFile[] | null;
  };
  head: {
    args: [sectionValue: JxDocumentValue | null, context: SectionContext];
    result: JxHeadEntry[] | null;
  };
  assets: {
    args: [sectionValue: JxDocumentValue | null, context: SectionContext];
    result: AssetMount[] | null;
  };
  /** `context` is the one shared server context per isolate; its members belong to the mounts. */
  mount: { args: [options: MountOptions, context: object]; result: MountHandler };
  deploySchema: {
    args: [
      tables: Readonly<Record<string, DataTableDefinition>>,
      connection: JsonObject,
      options: ConnectorDeployOptions,
    ];
    result: DeploySchemaResult;
  };
  /** Answers the wrangler config fragment the connection provisions. */
  bindings: { args: [connection: JsonObject]; result: JsonObject };
  testConnection: {
    args: [connection: JsonObject, env: HostEnvironment];
    result: TestConnectionResult;
  };
}

/**
 * The section-owner form of `deploySchema` (specs/extensions.md §11.1). A `project` class with no
 * `connector` block has no single connection to hand over, so it takes its section value and the
 * project config instead, and answers push steps rather than DDL.
 */
export interface SectionDeployContract {
  args: [
    sectionValue: JxDocumentValue,
    projectConfig: ProjectConfig,
    options: SectionDeployOptions,
  ];
  result: SectionDeployResult;
}

/** A capability role some contract describes. */
export type ContractedCapability = ExtensionCapability & keyof CapabilityContracts;

/** Every argument list a capability may be called with. */
type CapabilityArgs =
  | CapabilityContracts[ContractedCapability]["args"]
  | SectionDeployContract["args"];

/** Every answer a capability may give. */
type CapabilityAnswer =
  | CapabilityContracts[ContractedCapability]["result"]
  | SectionDeployContract["result"];

/**
 * A capability's static method, as dispatch calls it: a member of an implementation export (see
 * {@link ImplementationExport}) that takes the contracts' arguments and gives their answers. The
 * arguments are a list rather than the contracts' tuples so that a member checked only as callable
 * can be claimed as one; the overloads of {@link FormatEntry.call} keep each contract's exact
 * form.
 */
type CapabilityMethod = ImplementationExport &
  ((...args: CapabilityArgs[number][]) => CapabilityAnswer | PromiseLike<CapabilityAnswer>);

/**
 * A loaded implementation module's namespace object, as a host's loader resolves it.
 * {@link FormatEntry.implementation} reads it by export name, as an {@link ImplementationExport}.
 */
export type ImplementationModule = object;

/**
 * An implementation module's export, or a member read off one, before dispatch has checked it.
 * Reading a member is defined for every value but `null` and `undefined` (a function reads its own
 * properties, a primitive its wrapper's), and reading members is all this view admits: whatever
 * dispatch calls, it first checks is callable.
 */
export interface ImplementationExport {
  readonly [member: string]: ImplementationExport | null | undefined;
}

export interface FormatHostIO {
  /** Read and parse a JSON file or URL. */
  loadJson: (pathOrUrl: string) => Promise<JsonValue>;
  /** Import a JS module by path or URL, resolving to its namespace object. */
  importModule: (pathOrUrl: string) => Promise<ImplementationModule>;
  /** Resolve a relative reference against a base (node: path.resolve; browser: new URL). */
  resolvePath: (base: string, ref: string) => string;
}

interface ClassMethodLike {
  role?: string;
  identifier?: string;
  scope?: string;
  timing?: FormatTiming[];
  discriminator?: string;
}

/** The `$defs` block of a class descriptor, as far as capability discovery reads it. */
interface ClassDefsLike {
  methods?: Record<string, ClassMethodLike>;
}

/** A `.class.json` descriptor, as far as dispatch reads it. */
export interface ClassDefLike {
  title?: string;
  $implementation?: string;
  format?: FormatBlock;
  project?: ProjectBlock;
  server?: ServerBlock;
  connector?: ConnectorBlock;
  $studio?: StudioHints;
  $defs?: ClassDefsLike;
  /** Every other descriptor key, read by hosts as JSON (`description`, …). */
  [key: string]:
    | JsonValue
    | FormatBlock
    | ProjectBlock
    | ServerBlock
    | ConnectorBlock
    | StudioHints
    | ClassDefsLike
    | undefined;
}

/**
 * Read a loaded `.class.json` as a class descriptor.
 *
 * A non-object file declares nothing, so it reads as an empty descriptor, except `null`, which is
 * refused the way the descriptor's first read has always refused it.
 */
export function classDefFrom(value: JsonValue): ClassDefLike {
  if (value === null) {
    throw new TypeError("A class descriptor cannot be null");
  }
  /* SAFETY: a `.class.json` is a ClassDef document (class-schema.json, which `jx validate` and the
     editor enforce), and the blocks dispatch depends on are re-checked where they are read:
     `format.extensions` by `buildFormatRegistry`, `mediaType` by the FormatRegistry constructor,
     method roles and `discriminator` by `extractCapabilities`. */
  return isJsonObject(value) ? (value as ClassDefLike) : {};
}

const DEFAULT_TIMING: FormatTiming[] = ["compiler", "server"];

export class FormatEntry {
  readonly name: string;
  readonly classPath: string;
  readonly classDef: ClassDefLike;
  readonly extensions: string[];
  readonly mediaType: string | null;
  /**
   * The media type without its parameters — `text/markdown` for `text/markdown; variant=GFM`.
   *
   * Anything that keys on a type rather than describing one wants this: a File System Access
   * `accept` map, an editor language id. Those broke the moment a format declared the `variant`
   * parameter RFC 7763 defines, which is a good reason for the distinction to exist in the type
   * rather than in each caller's split.
   */
  readonly mediaTypeEssence: string | null;
  readonly documentKinds: FormatDocumentKind[];
  readonly exportTarget: boolean;
  readonly remote: boolean;
  readonly studio: StudioHints | null;
  readonly project: ProjectBlock | null;
  readonly server: ServerBlock | null;
  readonly connector: ConnectorBlock | null;
  readonly capabilities: Partial<Record<ExtensionCapability, CapabilityInfo>>;

  #io: FormatHostIO;
  #implementation: Promise<ImplementationExport> | null = null;

  constructor(name: string, classPath: string, classDef: ClassDefLike, io: FormatHostIO) {
    this.name = name;
    this.classPath = classPath;
    this.classDef = classDef;
    this.#io = io;

    // The format block is optional: entries also represent project/server/connector classes
    // (specs/extensions.md §6). Absent block → no extensions claimed.
    const { format } = classDef;
    this.extensions = (format?.extensions ?? []).map((e) => e.toLowerCase());
    this.mediaType = format?.mediaType ?? null;
    this.mediaTypeEssence = mediaTypeEssence(this.mediaType);
    this.documentKinds = format?.documentKinds ?? [];
    this.exportTarget = format?.exportTarget === true;
    this.remote = format?.remote === true;
    this.studio = classDef.$studio ?? null;
    this.project = classDef.project ?? null;
    this.server = classDef.server ?? null;
    this.connector = classDef.connector ?? null;
    this.capabilities = extractCapabilities(classDef);
  }

  /** Import (and cache) the class's $implementation module, read by export name. */
  implementation(): Promise<ImplementationExport> {
    if (!this.#implementation) {
      const impl = this.classDef.$implementation;
      if (!impl) {
        return Promise.reject(
          new Error(`Format class "${this.name}" has no $implementation to import`),
        );
      }
      /* SAFETY: a module namespace is an object, and ImplementationExport claims nothing about it
         but that its members can be read, which holds for it and for every non-nullish value read
         off it; dispatch calls nothing it has not checked. */
      this.#implementation = this.#io.importModule(
        this.#io.resolvePath(this.classPath, impl),
      ) as Promise<ImplementationExport>;
    }
    return this.#implementation;
  }

  /**
   * The export capabilities are called on (specs/extensions.md §6.1, step 4): the one the
   * descriptor's `title` names, else that name on the default export, else the default export
   * itself. Nullish when the module exports none of the three.
   */
  async implementationExport(): Promise<ImplementationExport | null | undefined> {
    return this.#exportOf(await this.implementation());
  }

  /** {@link implementationExport}, read off an already imported module. */
  #exportOf(exported: ImplementationExport): ImplementationExport | null | undefined {
    const title = this.classDef.title ?? this.name;
    return exported[title] ?? exported.default?.[title] ?? exported.default;
  }

  /**
   * Invoke a capability's static method on the implementation export, with the arguments and the
   * answer its contract fixes ({@link CapabilityContracts}).
   */
  call<C extends ContractedCapability>(
    capability: C,
    ...args: CapabilityContracts[C]["args"]
  ): Promise<CapabilityContracts[C]["result"]>;
  /** Invoke a section owner's `deploySchema` ({@link SectionDeployContract}). */
  call(
    capability: "deploySchema",
    ...args: SectionDeployContract["args"]
  ): Promise<SectionDeployContract["result"]>;
  async call(capability: ContractedCapability, ...args: CapabilityArgs): Promise<CapabilityAnswer> {
    const cap = this.capabilities[capability];
    if (!cap) {
      throw new Error(`Format class "${this.name}" does not declare a "${capability}" capability`);
    }
    const owner = this.#exportOf(await this.implementation());
    const member = owner?.[cap.identifier];
    if (!isFunction(member)) {
      const title = this.classDef.title ?? this.name;
      throw new TypeError(
        `Format class "${this.name}": implementation export "${title}" has no static "${cap.identifier}" method`,
      );
    }
    /* SAFETY: dispatch can check only that the member is callable. What it accepts and answers is
       the contract its class signed by declaring this role (specs/extensions.md §8), which hosts
       rely on rather than re-validate, so that signature is trusted here, in this one place. */
    const method = member as CapabilityMethod;
    return await method.call(owner, ...args);
  }

  /**
   * Parse a page or component source. What `parse` answers is decided by the format's
   * `documentKinds` (specs/extensions.md §8): a format declaring `page` or `component` answers the
   * Jx document it built from the text.
   */
  async parseDocument(source: string, options?: FormatOptions): Promise<JxDocument> {
    const parsed = await this.call("parse", source, options);
    /* SAFETY: hosts call this to read a page or a component, and specs/extensions.md §8 has every
       format that declares the `page` or `component` document kind answer a JxDocument; only a
       format declaring `content` alone may answer entries. A content-only format read as a page
       breaks that rule, and its answer passes through unchecked, exactly as it always has. */
    return parsed as JxDocument;
  }
}

export class FormatRegistry {
  #entries: FormatEntry[];

  constructor(entries: FormatEntry[]) {
    this.#entries = entries;

    /*
     * A declared media type reaches an HTTP header, an editor's file association and a Studio
     * label. Nothing checked it before, so `text/markdown;variant GFM` — one missing `=` — would
     * have been served to a browser verbatim as a malformed header value (RFC 6838 §4.2).
     */
    for (const entry of entries) {
      if (entry.mediaType === null) {
        continue;
      }
      const problem = mediaTypeProblem(entry.mediaType);
      if (problem !== null) {
        throw new Error(`Format "${entry.name}" declares an invalid mediaType: ${problem}`);
      }
    }

    // Ambiguous (extension, capability) claims are a configuration error.
    for (const cap of FORMAT_CAPABILITIES) {
      const seen = new Map<string, FormatEntry>();
      for (const entry of entries) {
        if (!entry.capabilities[cap]) {
          continue;
        }
        for (const ext of entry.extensions) {
          const prior = seen.get(ext);
          if (prior) {
            throw new Error(
              `Format conflict: "${prior.name}" and "${entry.name}" both claim "${ext}" with the "${cap}" capability`,
            );
          }
          seen.set(ext, entry);
        }
      }
    }
  }

  get entries(): readonly FormatEntry[] {
    return this.#entries;
  }

  /** Look up the format claiming an extension, optionally requiring a capability. */
  byExtension(ext: string, capability?: FormatCapability): FormatEntry | undefined {
    const norm = normalizeExt(ext);
    return this.#entries.find(
      (e) => e.extensions.includes(norm) && (!capability || e.capabilities[capability]),
    );
  }

  byName(name: string): FormatEntry | undefined {
    return this.#entries.find((e) => e.name === name);
  }

  withCapability(capability: FormatCapability): FormatEntry[] {
    return this.#entries.filter((e) => e.capabilities[capability]);
  }

  /**
   * All registered extensions, optionally filtered by document kind. Never includes ".json" — JSON
   * is the native built-in, handled inline by hosts.
   */
  documentExtensions(kind?: FormatDocumentKind): string[] {
    const exts = new Set<string>();
    for (const entry of this.#entries) {
      if (kind && !entry.documentKinds.includes(kind)) {
        continue;
      }
      for (const ext of entry.extensions) {
        exts.add(ext);
      }
    }
    exts.delete(".json");
    return [...exts];
  }

  has(ext: string): boolean {
    const norm = normalizeExt(ext);
    return this.#entries.some((e) => e.extensions.includes(norm));
  }
}

/**
 * Build a registry by scanning an imports map ({name: path}) for format classes.
 *
 * Only values ending in ".class.json" are inspected; other imports (layouts, components) are
 * skipped, as are class files that fail to load or carry no `format` block.
 */
export async function buildFormatRegistry(
  imports: Record<string, string> | undefined,
  io: FormatHostIO,
  base?: string,
): Promise<FormatRegistry> {
  const entries: FormatEntry[] = [];
  for (const [name, ref] of Object.entries(imports ?? {})) {
    if (!isString(ref) || !ref.endsWith(".class.json")) {
      continue;
    }
    let classPath: string;
    let loaded: JsonValue;
    try {
      classPath = base ? io.resolvePath(base, ref) : ref;
      loaded = await io.loadJson(classPath);
    } catch {
      continue; // Unresolvable or unreadable imports are not format classes
    }
    if (!isJsonObject(loaded)) {
      continue;
    }
    const classDef = classDefFrom(loaded);
    if (!classDef.format || !Array.isArray(classDef.format.extensions)) {
      continue;
    }
    entries.push(new FormatEntry(name, classPath, classDef, io));
  }
  return new FormatRegistry(entries);
}

function extractCapabilities(
  classDef: ClassDefLike,
): Partial<Record<ExtensionCapability, CapabilityInfo>> {
  const out: Partial<Record<ExtensionCapability, CapabilityInfo>> = {};
  const methods = classDef.$defs?.methods ?? {};
  for (const [key, method] of Object.entries(methods)) {
    const { role } = method;
    if (!isExtensionCapability(role)) {
      continue;
    }
    const info: CapabilityInfo = {
      identifier: method.identifier ?? key,
      timing: method.timing ?? DEFAULT_TIMING,
    };
    if (isString(method.discriminator)) {
      info.discriminator = method.discriminator;
    }
    out[role] = info;
  }
  return out;
}

const CAPABILITY_ROLES: ReadonlySet<string> = new Set(EXTENSION_CAPABILITIES);

/** Whether a declared method `role` is one of the capability roles dispatch knows. */
function isExtensionCapability(role: string | undefined): role is ExtensionCapability {
  return role !== undefined && CAPABILITY_ROLES.has(role);
}

function normalizeExt(ext: string): string {
  const lower = ext.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}
