# Imports

**Version:** 0.1.10-draft\
**Status:** Partial\
**Updated:** 2026-08-27\
**License:** MIT

---

The JX import system provides a unified way to manage three types of external dependencies: JX class files, npm packages, and web component libraries.

## 1. Import Types

### 1.1 JX Class Imports

> **Status: Partial.** The build meets it: `injectContext` (`packages/site/src/context.ts`) merges project `imports` under the page's, and `nodeImportRebaser` (`packages/compiler/src/site/context-injection.ts`) rewrites a relative project entry onto the page's directory. The studio canvas does not rebase: `getEffectiveImports` (`packages/studio/src/site-context.ts`) merges project `imports` unchanged, and the canvas resolves each `$src` against the open document's own URL (`docBase` in `packages/studio/src/canvas/canvas-live-render.ts`), so a relative project import resolves against the wrong directory in any document outside the project root.

Class imports map short names to file paths, enabling `$prototype` resolution without full paths. Defined in `project.json` under `imports`:

```json
{
  "imports": {
    "MyLayout": "./layouts/main.json",
    "PostCard": "./components/post-card.class.json"
  }
}
```

These cascade from site level into every page. Page-level `imports` merge on top (page wins on conflict).

### 1.2 Format Class Auto-Discovery

> **Status: Partial.** No host reads the project `imports` map for format classes: the compiler, the dev server and the desktop session build the format registry from the project.json `extensions` array through each package's `jx-extension.json` manifest (`buildExtensionRegistry` in `packages/schema/src/extension-registry.ts`, `buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`), and the studio reads theirs, which is the model extensions.md §3 specifies. The imports-scanning `buildFormatRegistry` in `packages/schema/src/format-registry.ts` is still exported but only tests call it; what still holds below is that a project with no extension enabled handles only `.json`, with no implicit format defaults, and that page-level imports take no part in dispatch.

Imports are also the registration mechanism for **format-extension classes** (see `specs/extensions.md`). Hosts (compiler, dev server, studio) scan the **project-level** `imports` map for `.class.json` files carrying a top-level `format` block and build a format registry from them:

```json
{
  "imports": {
    "Markdown": "@jxsuite/parser/Markdown.class.json",
    "Csv": "@jxsuite/parser/Csv.class.json"
  }
}
```

With these imports in place, `.md` files are discoverable as pages/components, content types can use `"format": "Markdown"` / `"format": "Csv"`, and the studio offers the formats' editing surfaces. Without them, only `.json` is handled — there are no implicit format defaults. Page-level imports continue to drive `$prototype` state resolution but do not participate in file-extension dispatch (they cannot be read before the page itself is parsed).

### 1.3 `$elements` - Component Registration

> **Status: Partial.** Both entry forms ship in the runtime (`registerElements` in `packages/runtime/src/runtime.ts`), and the site build honours bare strings from a page's and its layout's `$elements`. The build does not honour a `{ "$ref" }` entry: `buildSite` in `packages/compiler/src/site/site-build.ts` compiles only the files directly in `components/` and never reads a page's or layout's `$ref` entries, so a declared `../components/nested/deep-card.json` or `./_blog-card.json` ships as an empty custom-element tag with no module and no build error; only a component's own `$elements` dependencies compile wherever they live (`compileElement` in `packages/compiler/src/targets/compile-element.ts`).

`$elements` declares which custom elements a page uses. It accepts two formats:

```json
{
  "$elements": [
    { "$ref": "./components/task-item.json" },
    { "$ref": "./components/task-stats.json" },
    "@shoelace-style/shoelace"
  ]
}
```

- **`{ $ref }` objects**: JX custom element definitions. The runtime fetches the JSON, registers the custom element via `defineElement()`.
- **Bare strings**: npm package specifiers. The runtime calls `import(pkgName)` as a side-effect import, which registers the package's custom elements globally.

### 1.4 Cascading

> **Status: Partial.** The union and dedup ship in `injectContext` (`packages/site/src/context.ts`). `discoverElements` in `packages/site/src/compose.ts` meets the rule: it matches `components/<tag>.json`, walks transitively and dedups by resolved path. `injectComponentScripts` in `packages/compiler/src/site/site-build.ts` scans the rendered HTML for every component the build compiled, and that set is not a superset of the effective one: it is only the files directly in `components/` (any component format, any file name, keyed by `tagName`) plus their own `$elements` dependencies, because `buildSite` lists that directory non-recursively and never reads a page's or layout's `{ "$ref" }` entry, so a declared component anywhere else (`components/nested/deep-card.json`, a co-located `pages/blog/_blog-card.json`) ships as an empty tag with no module and no build error. The studio canvas (`packages/studio/src/canvas/canvas-live-render.ts`) does not meet it: it merges project-level `$elements` without rebasing their `$ref`s onto the document's directory (`getEffectiveElements` in `packages/studio/src/site-context.ts`), discovers only in content mode, for a layout-wrapped page or for a document under `layouts/`, never opens the components it finds, matches tags against the whole component registry rather than `components/<tag>.json`, and dedups declared entries by their raw `$ref` string.

`$elements` defined in `project.json` apply to every page. Page-level `$elements` merge with site-level via union (deduplicated by `$ref` value or string value). Page entries take precedence on conflict.

```
project.json $elements  +  page $elements  =  effective $elements (union, dedup)
```

**A component the project itself defines does not have to be declared.** Almost nothing writes `$elements` for its own components, and three surfaces each reach the same effective set a different way: a build scans the rendered HTML for tags it compiled and emits a module script per tag, the studio canvas walks the document against the project's component registry, and a host composing from the working tree walks the document against the tree. Every hyphenated tag a document names that `components/<tag>.json` defines joins the effective set, transitively through the components those definitions name, so a component that brings another registers both.

Declaration remains what a page needs for anything the project does not define — an npm specifier, or a component whose file name is not its tag — and a declared entry is deduplicated against a discovered one by the path it RESOLVES to, so a layout's `../components/nav.json` and a discovered `./components/nav.json` are one entry. Only `.json` components are discoverable: a `$ref` is fetched and parsed by the browser, which has no extension parser to hand.

## 2. npm Web Component Discovery

> **Status: Partial.** Only the dev server discovers CEM components: its `GET /__studio/components` handler (`packages/server/src/studio-api.ts`) reads each installed dependency's `customElements` manifest and lists its elements as `source: "npm"` entries. The desktop session's `discoverComponents` (`packages/desktop/src/project-session.ts`) and the cloud adapter's (`packages/studio/src/platforms/cloud.ts`) list only JSON project components, so in the desktop app no npm element reaches the property inspector, the Packages panel's cherry-pick or the Insert panel.

Packages that ship a [Custom Elements Manifest](https://custom-elements-manifest.open-wc.org/) (CEM) are auto-discovered. The server scans `package.json` dependencies for packages whose own `package.json` declares a `customElements` field pointing to their CEM JSON.

The CEM provides:

- Tag names (`declarations[].tagName`)
- Attributes and their types
- Slots, events, CSS custom properties
- Member properties with defaults

This metadata powers the Studio property inspector and enables drag-and-drop of npm web components onto the canvas.

## 3. Runtime Behavior

### 3.1 `$ref` entries

```js
// For each { $ref } in $elements:
const url = new URL(entry.$ref, base);
const doc = await fetch(url).then((r) => r.json());
defineElement(doc); // registers <tag-name> custom element
```

### 3.2 Bare string entries

```js
// For each string in $elements:
await import(entry); // side-effect import, registers custom elements globally
```

Failed imports log a warning but do not block page rendering.

## 4. Server API

### 4.1 `GET /__studio/components?dir=<path>`

Returns the component registry for a project. Each entry includes:

```json
{
  "tagName": "task-item",
  "path": "components/task-item.class.json",
  "source": "jx",
  "props": [{ "name": "title", "type": "string" }]
}
```

For npm packages with CEM:

```json
{
  "tagName": "sl-button",
  "source": "npm",
  "package": "@shoelace-style/shoelace",
  "props": [{ "name": "variant", "type": "string" }]
}
```

### 4.2 `GET /__studio/packages`

> **Status: Partial.** The route in `packages/server/src/studio-api.ts` lists every installed dependency and devDependency, CEM-bearing or not, as `{ name, version, dev, hasCem, customElementsPath }`, and the studio reads it as its general dependency list (`listPackages` in `packages/studio/src/platforms/devserver.ts`, typed `PackageInfo[]` in `packages/protocol/src/types.ts`). No client reads `hasCem`.

Lists CEM-bearing npm dependencies from `package.json`.

### 4.3 `GET /__studio/cem?pkg=<name>`

> **Status: Partial.** The route in `packages/server/src/studio-api.ts` returns the manifest wrapped as `{ cem }`, answers `{ cem: null }` when the package, its `customElements` field or the manifest file is missing, and takes an optional `dir`. No studio platform calls it: the inspector's CEM metadata arrives through `GET /__studio/components` (§4.1).

Returns the full Custom Elements Manifest JSON for a package.

### 4.4 `POST /__studio/packages/add`

Body: `{ "name": "<package-name>" }`. Runs `bun add <name>`.

### 4.5 `POST /__studio/packages/remove`

Body: `{ "name": "<package-name>" }`. Runs `bun remove <name>`.

## 5. Studio Imports Panel

> **Status: Partial.** There is no "Imports" tab with three sections. The Packages panel (`registerPackagesPanel` in `packages/studio/src/panels/imports-panel.ts`, markup `packages/studio/src/surfaces/panel-imports.json`) shows the imported modules, dependency add and remove and a cherry-pick checkbox per package element over `project.json`, and the document's `$ref` imports, a component picker and the same checkboxes over any other document. The checkboxes need the `source: "npm"` entries §2 describes, so they appear only under the dev server. Component cards with live preview and drag-drop are the Insert panel's (`registerInsertPanel` in `packages/studio/src/panels/elements-panel.ts`), as studio.md §5.1 and §5.3 describe.

The left sidebar "Imports" tab provides three sections:

1. **Imported Modules** - Name-to-path mappings from `project.json` `imports`. Add/remove with write-back.
2. **Components** - JX custom elements (`source: "jx"`) with live preview and drag-drop.
3. **Packages** - npm web components (`source: "npm"`) grouped by package, with drag-drop of individual tags and package add/remove.

### 5.1 Auto-Import on Drag-Drop

> **Status: Partial.** A dropped hyphenated tag gains its `$elements` entry through the one service studio.md §9.1.3 names (`enableElement` in `packages/studio/src/files/elements.ts`, called from `packages/studio/src/panels/dnd.ts`), deduplicated by resolved `$ref`. It differs from this section in two ways: the drag source is the Insert panel's component cards, and an npm component is written as its cherry-picked `package/modulePath` specifier (`npmSpecifier`) rather than the bare package name.

When a component is dragged from the imports panel onto the canvas:

- **JX component**: a `{ $ref: "./relative/path.json" }` entry is added to the page's `$elements`
- **npm component**: the package name string is added to the page's `$elements`

Duplicates are not added if the component is already imported.

## 6. Content Collection `$elements`

> **Status: Partial.** The `injectContext()` merge in the last paragraph ships (`packages/site/src/context.ts`), and `loadContentType` (`extensions/parser/src/content-loader.ts`) derives `allowedNames` from a content type's `$elements`, but nothing enforces it: `processMarkdown` (`extensions/parser/src/md.ts`) uses `directiveOptions` only to switch on an unconfigured `remark-directive` (so a collection that declares no `$elements` parses no directives at all), no `MarkdownDirective` plugin exists, and the values are raw specifiers and `$ref` paths rather than tag names. Collection `$elements` are never merged with site-level `$elements` for rendering (nothing outside tests reads `getContentTypeElements`), and the example is stale: the section is `content.<type>` (`extensions/parser/schemas/project.fragment.schema.json`), not `contentTypes` or `collections`, and `format` names a class such as `Markdown`, not `md`.

Content collections support `$elements` in their `project.json `collections``, controlling which custom element directives are available in that collection's markdown files:

```json
{
  "contentTypes": {
    "blog": {
      "source": "./content/blog/",
      "format": "md",
      "$elements": ["@shoelace-style/shoelace", { "$ref": "./components/callout.json" }]
    }
  }
}
```

Collection `$elements` merge with site-level `$elements` to determine the full set of available components for markdown rendering. The `$elements` entries are passed as `allowedNames` to the `MarkdownDirective` plugin, restricting which directive tag names are valid in that collection's markdown files.

The compiler's `injectContext()` also merges site-level `$elements` into page-level `$elements` during the build, using the same union-dedup strategy as the runtime.

## 7. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). The Custom Elements Manifest (§2) is a community format with no standards body, so it is described there rather than cited here. Subresource Integrity for a bare-specifier `$elements` script is tracked against `compiler.md` §3, where the emitted-script contract lives.

| Standard                                                                                  | Class        | Binds | Evidence                                 | Note                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------ | ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/) | **Adopted**  | §3    | packages/runtime/src/runtime.ts          | A bare-string `$elements` entry is loaded with a dynamic `import()` for its registration side effect — the standard's own module semantics, with no loader of Jx's own.                                                                                                                                                                                                                     |
| [WHATWG HTML](https://html.spec.whatwg.org/)                                              | **Borrowed** | §1    | packages/compiler/src/site/site-build.ts | The project-level `imports` map has an import map's shape — bare specifier to URL — but it is resolved by Jx at build and load time and is never emitted as a `<script type="importmap">`, so a browser never sees it. The import map the compiler _does_ emit is a separate, fixed two-entry object naming the client runtime, which the build serves from `/assets/` (`compiler.md` §12). |

## Changelog

- **0.1.10-draft** (2026-08-27) — Components a project defines are discovered from the tree rather than only declared.
- **0.1.9-draft** (2026-08-15) — Name where the emitted import map now points (§1).
- **0.1.8-draft** (2026-08-15) — Number the sections so they are addressable, and add §7 Standards Alignment.
- **0.1.7-draft** (2026-08-02) — Imports panel section renamed to Imported Modules in the UI.
- **0.1.6-draft** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.1.5-draft** (2026-07-22) — Machine-readable spec status vocabulary + generated status page (`79daba23`).
- **0.1.4-draft** (2026-06-10) — Consolidate markdown and csv handling to the parser package (`8b1ba6da`).
- **0.1.3-draft** (2026-06-01) — Remove old glob-based content type references (`6bcbfdaf`).
- **0.1.2-draft** (2026-05-19) — Reflect new content type transition (`6eb3d2b6`).
- **0.1.1-draft** (2026-04-22) — Consolidate project config schema and rename as such (`e3523dbf`).
- **0.1.0-draft** (2026-04-22) — External web component support (`a9d0fbe4`).
