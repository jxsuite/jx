/**
 * Monaco editor setup — workers, the editor feature set, language services, and JX schema
 * registration.
 *
 * **Every editor feature is registered here, up front, through `features/register.all`.** Studio
 * used to import one `register` module per capability it wanted, as a statement of what the code
 * editor can do. Monaco does not let that statement hold, and trying cost two console exceptions on
 * every editor:
 *
 * - The JSON and TypeScript language modes load lazily, the first time a model of their language
 *   exists, and their worker manager imports `vs/internal/common/workers.js`, which imports every
 *   editor contribution in monaco (0.57.0). So the features left off the list were registered
 *   anyway, part-way through the session.
 * - Monaco snapshots its registered singleton services when its standalone services first initialize,
 *   which the first editor does. Two late contributions bring their services with them
 *   (`ICodeLensCache`, `treeViewsDndService`), registered after that snapshot, so every editor
 *   created afterwards threw `[createInstance] … depends on UNKNOWN service` for CodeLens and
 *   drop-into-editor, while the other late contributions (color picker, inlay hints, linked
 *   editing, font zoom…) switched on silently. What the editor could do depended on whether a
 *   `.json` had been opened yet.
 *
 * Registering the whole set here, with the editor API and before any editor exists, makes the set
 * the same in every session and puts every service in the snapshot. It is the set the session
 * reached anyway, so nothing a reader had becomes unavailable, and it ships in the lazy Monaco
 * chunk, which only a code view loads (`services/monaco-lazy.ts`).
 *
 * The suggest widget is part of it (`features/inlineCompletions/register` is the public entry that
 * reaches `suggestController.js`, and `register.all` includes it): without the widget, JSON schema
 * completion and the Logic tab's `state.*` completion register and never appear.
 */

import * as monacoApi from "monaco-editor/editor";

// Every editor feature, before any editor exists: see the note at the top of this file.
import "monaco-editor/features/register.all";
// Languages.
import { jsonDefaults } from "monaco-editor/languages/features/json/register";
import {
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  typescriptDefaults,
} from "monaco-editor/languages/features/typescript/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/typescript/register";

import { flattenSchema } from "@jxsuite/schema/project-schemas";
import type { ComposedProjectSchemas } from "@jxsuite/schema/project-schemas";
import jxSchema from "@jxsuite/schema/schema.json";
import projectSchema from "@jxsuite/schema/project-schema.json";
import type { JsonObject } from "@jxsuite/schema/types";
import type { ProjectSchemasResponse } from "../types";
import { bundleUrl } from "./bundle-base";
import { PROJECT_FILE_NAMES } from "@jxsuite/schema/project-file";
import { registerJxnCompletion } from "./jxn-completion";
import { registerJxnLanguage } from "./jxn-language";

/* Re-exported for the modules that already imported it from here. New callers should reach for
   `./model-uri` directly — it is Monaco-free, and importing this module loads the editor. */
export { modelUriFor } from "./model-uri";

/** The worker every label without a language service of its own runs in. */
const EDITOR_WORKER_FILE = "editor.worker.js";

/** Monaco worker label → the pre-bundled worker file that serves it. */
const WORKER_FILES = new Map([
  ["editorWorkerService", EDITOR_WORKER_FILE],
  ["javascript", "ts.worker.js"],
  ["json", "json.worker.js"],
  ["typescript", "ts.worker.js"],
]);

/**
 * Resolve a Monaco worker to the PRE-BUNDLED copy that ships NEXT TO THE ENTRY — `dist/workers/`
 * beside `dist/studio.js`, written by scripts/build-workers.ts.
 *
 * Self-location is what makes one expression correct on every host, because none of them agree on a
 * prefix and two of them cannot be served by one: the repo dev server mounts the shell at
 * `/packages/studio/index.html`, the packaged desktop app at `views://studio/index.html`, the
 * desktop loopback server under `/__studio__/`, and a cloud host under whatever prefix it staged
 * the tree at. The only invariant is the bundle's own location.
 *
 * **But `import.meta.url` is not that location, and this function used to think it was.** It is
 * THIS MODULE's url, and since the code-split (78d85ba2) this module is emitted into
 * `dist/chunks/monaco-setup-<hash>.js` — so the expression resolved to `chunks/workers/<name>`, a
 * directory that has never existed in any distribution. Only the two entries have a contractual
 * emitted path (studio.md §11.1), which is exactly what `services/bundle-base` records.
 *
 * The bug this closes is invisible by construction, which is why it survived: a Monaco worker that
 * 404s takes the whole JSON language service with it — no schema validation, no completion, no
 * hover — and surfaces no error at all. The same silence covered the predecessor of the
 * `import.meta.url` form, a root-absolute `/monaco-editor/esm/vs/...` that resolved on the repo dev
 * server alone.
 *
 * @param {string} label - Monaco worker label ("json", "typescript", …)
 * @returns {string} Absolute URL of the worker bundle
 */
export function workerUrl(label: string): string {
  const file = WORKER_FILES.get(label) ?? EDITOR_WORKER_FILE;
  return bundleUrl(`workers/${file}`);
}

self.MonacoEnvironment = {
  getWorker(_, label: string) {
    return new Worker(workerUrl(label), { type: "module" });
  },
};

/* Monaco caches glyph widths when an editor is created. JetBrains Mono is a
   vendored webfont (index.html @font-face) and may finish loading after the
   first editor mounts, so remeasure once all document fonts are ready to keep
   cursor and selection alignment correct. `lib.dom` declares `document.fonts` unconditionally, but
   DOM shims (happy-dom under test) ship without it, so the font set is typed as possibly absent. */
const documentFonts: FontFaceSet | undefined =
  typeof document === "undefined" ? undefined : document.fonts;
if (documentFonts?.ready) {
  // oxlint-disable-next-line unicorn/prefer-top-level-await -- fire-and-forget: awaiting fonts.ready at top level would block module evaluation (and studio startup) until webfonts load
  void documentFonts.ready.then(async () => {
    const monaco = await import("monaco-editor/editor");
    monaco.editor.remeasureFonts();
  });
}

registerJxnLanguage(monacoApi.languages);

/** Folder globs whose JSON files validate against the (per-project or core) document schema. */
const DOCUMENT_FILE_MATCH = [
  "pages/*.json",
  "pages/**/*.json",
  "layouts/*.json",
  "layouts/**/*.json",
  "components/*.json",
  "components/**/*.json",
  "elements/*.json",
  "elements/**/*.json",
];

/**
 * Model ids the committed entry documents are bound by. A Jx project binds its files with a
 * RELATIVE in-document pointer (extensions.md §5.2/§5.4) — `project.json` carries `"$schema":
 * "./project.schema.json"` — and Monaco mounts every studio model at
 * `file:///<project-relative-path>` (canvas/canvas-render.ts), so the language service resolves
 * that pointer against the model's own directory and lands on the project root.
 *
 * The document id is the same target for a document that spells its pointer at the RIGHT depth
 * (`../document.schema.json` from `pages/`, `../../` from `pages/blog/`). A pointer with too few
 * `../` resolves to a file that does not exist and fails everywhere — Monaco, VS Code and ajv alike
 * — so it is an authoring error, not something to paper over with extra registrations.
 */
const PROJECT_ENTRY_SCHEMA_ID = "file:///project.schema.json";
const DOCUMENT_ENTRY_SCHEMA_ID = "file:///document.schema.json";

/** The project-root files those ids belong to (`jx schema` writes exactly these two names). */

/**
 * Register the JSON diagnostics schemas. Fetched per-project schemas are inline OBJECTS (never URLs
 * — `enableSchemaRequest` stays off), so backends must serve them PRE-BUNDLED; the bundled core
 * schemas remain the offline fallback.
 *
 * Each schema registers TWICE: once under its canonical `https://jxsuite.com/…` uri with the
 * fileMatch patterns that cover documents carrying no `$schema` of their own, and again under the
 * `file:///…` id above. The second registration is what makes the `$schema` binding work offline.
 * An in-document `$schema` takes ABSOLUTE precedence over fileMatch in the language service
 * (`getSchemaForResource` consults it first and returns early), and resolution goes through
 * `getOrAddSchemaHandle`, which checks the by-id registry BEFORE reaching for a request service.
 * Without the id registered there is no service to reach for, so every `project.json` reported
 * `Unable to load schema from '/project.schema.json'. No schema request service available` — and,
 * worse, resolved to an empty schema, so the fileMatch registration never ran and REAL violations
 * went unreported behind that one diagnostic.
 */
function applyJsonSchemas(documentSchema: JsonObject, projectJsonSchema: JsonObject) {
  schemasInForce = { document: documentSchema, project: projectJsonSchema };
  jsonDefaults.setDiagnosticsOptions({
    allowComments: false,
    schemas: [
      {
        fileMatch: DOCUMENT_FILE_MATCH,
        schema: documentSchema,
        uri: "https://jxsuite.com/schema/v1",
      },
      {
        // Monaco's JSON service, so only the JSON spelling; a `project.jxn` is read by its own grammar.
        fileMatch: PROJECT_FILE_NAMES.filter((name) => name.endsWith(".json")),
        schema: projectJsonSchema,
        uri: "https://jxsuite.com/schema/project/v1",
      },
      { schema: projectJsonSchema, uri: PROJECT_ENTRY_SCHEMA_ID },
      { schema: documentSchema, uri: DOCUMENT_ENTRY_SCHEMA_ID },
    ],
    validate: true,
  });
}

/* A function body is TypeScript (`spec.md` §23.1) and opens as `typescript`. It is a body, not a
   module: top-level `return` and `await` are what it is, and its names (`state`, `event`) come from
   the runtime, so Monaco checks only the syntax of the buffer itself. Types are checked in a file
   written around the body (`services/type-check.ts`), which the worker reads as a program of its own,
   and these are the options it reads it under: strict, but not `noImplicitAny`, because a body is
   as often JavaScript as TypeScript and an untyped callback parameter is not a mistake in it. The
   Code view's check (`services/source-type-check.ts`) reads the modules of a whole `.jxn` file under
   the same options, so a body says the same on both surfaces. */
typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
typescriptDefaults.setCompilerOptions({
  allowNonTsExtensions: true,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  noEmit: true,
  noImplicitAny: false,
  skipLibCheck: true,
  strict: true,
  target: ScriptTarget.ESNext,
});

/* Flattened once at module load: the shipped core schemas reference the well-known union resources
   by canonical $id (the `$paths` source union, extensions.md §5.3), and Monaco resolves anything with
   a URI before the `#` by FETCHING it — with `enableSchemaRequest` off that just fails, leaving
   `$paths` reporting an unresolvable ref. Flattening rewrites those refs onto the shipped defaults
   embedded in the same document, which is exactly the right fallback semantics. */
const FALLBACK_DOCUMENT_SCHEMA = flattenSchema(jxSchema);
const FALLBACK_PROJECT_SCHEMA = flattenSchema(projectSchema);

/* The pair Monaco's JSON service was last given. A `.jxn` file is no JSON, so that service never
   reads one, and its completion asks for the same pair here (§4.2.1): the two spellings of a
   document are then completed and validated by one set of rules, whichever project is open. */
let schemasInForce: ComposedProjectSchemas = {
  document: FALLBACK_DOCUMENT_SCHEMA,
  project: FALLBACK_PROJECT_SCHEMA,
};

// Bundled core schemas register at module init — the offline fallback every platform starts from.
applyJsonSchemas(FALLBACK_DOCUMENT_SCHEMA, FALLBACK_PROJECT_SCHEMA);
registerJxnCompletion(monacoApi.languages, () => schemasInForce);

/**
 * Swap Monaco's JSON diagnostics to the ACTIVE project's generated entry documents — the
 * pre-bundled payload behind the platform's optional `fetchProjectSchemas` member (dev server:
 * `/__studio/project-schemas`; desktop: RPC into the project session). Called on project
 * activation, after a `project.json` write, and on `extensions` changes.
 *
 * Takes an ALREADY-FETCHED payload rather than the platform, so ONE fetch can feed both Monaco and
 * the AI assistant's validator (format/format-host.ts). The backends regenerate stale entry
 * documents on demand and write them to disk, so a second concurrent fetch is not a harmless
 * duplicate — it races the first on the same two files.
 *
 * @param {object | null} schemas - Pre-bundled `{ document, project }` payload
 * @returns {boolean} True when per-project schemas were applied; false on fallback
 */
export function applyProjectSchemas(schemas: ProjectSchemasResponse | null | undefined): boolean {
  const { document, project } = schemas ?? {};
  if (!document && !project) {
    return false;
  }
  applyJsonSchemas(document ?? FALLBACK_DOCUMENT_SCHEMA, project ?? FALLBACK_PROJECT_SCHEMA);
  return true;
}

/** Restore the bundled core schemas (project closed / tests). */
export function resetProjectSchemas(): void {
  applyJsonSchemas(FALLBACK_DOCUMENT_SCHEMA, FALLBACK_PROJECT_SCHEMA);
}
