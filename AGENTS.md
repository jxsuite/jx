We're crafting a comprehensive web-based application suite that aims to encompass all available web platform APIs within a JSON Schema and provides a runtime, compiler, visual builder, and extension layer (content collections, search, authentication, database connectors) to facilitate website and full-application builds with this schema. Jx targets apps with accounts and data, not only brochure sites: pages are always prerendered at build time and hydrate as islands, while sessions and application data come from extension server mounts which — together with any `timing: "server"` state entries — compile into one generated Hono worker serving `/_jx/*` next to the static output whenever `build.adapter` is set. A project with an active mount (a non-empty `data` or `auth` section) must set one, or the build fails; with no adapter, `timing: "server"` entries fall back to a standalone per-page `_server.js` handler.

- Prefer WHATWG and ECMA standard alignment (current or emerging) for all nomenclature and architectural paradigms.
- Code in strongly typed Typescript. Ensure all linting, typechecking, and tests pass following all changes.
- Implement tests in parallel with features—use native Bun + Happy DOM and other mock API providers, as appropriate.
- Reference the general and package-specific specs (./specs) prior to planning and implementing features, update specs to reflect user requests prior to adding new features. Edit spec sections in place — never renumber headings (user docs anchor them).
- Every substantive spec edit is a release: run `bun run spec:bump <spec.md> <major|minor|patch> -m "<what changed>"` to advance the version, restamp `**Updated:**`, and add a `## Changelog` entry, then `bun run docs:generate`. CI blocks a changed spec body that wasn't released (`bun run docs:spec-release`). See ./specs/README.md.
- User documentation (./docs, published at jxsuite.com/docs) must track shipped behavior: behavior-changing work updates the affected docs pages in the same change set. Run `bun run docs:sync` to map your diff to affected pages/specs, and `bun run docs:check` before finishing. Plans must include a "Specs & docs" step.
- Do not wrap Markdown source: write one paragraph per line, and make a line break that carries meaning an explicit `\` hard break. `bun run format:md` fixes a file. Much of the tree is still wrapped from before the rule and the sweep is pending, so match the rule in what you write rather than reflowing what you touch. See ./CLAUDE.md.
- Use Chrome MCP to test new UI/UX changes prior to finishing the task.

## Studio UI Rules

- **A surface is a Jx document**: Studio's chrome is `src/surfaces/*.json`, mounted by an adapter through `mountSurface()`. Never add a new `lit-html` template for a surface, and never use `document.createElement`, `element.style.cssText`, or other imperative DOM construction for UI. `lit-html` renders the four overlay layers, the canvas realm and the grid's cell editors, and nothing else.
- **The Jx UI kit is the only element family**: use `@jxsuite/ui` elements (`jx-button`, `jx-dialog`, `jx-textfield`, `jx-menu`, …) for every control, and never build a custom DOM equivalent of one the kit provides. Adobe Spectrum Web Components are **removed**: an `sp-*` tag or a `--spectrum-*` token anywhere in `packages/studio` fails `scripts/check-styles.ts`, and importing `@spectrum-web-components/*` fails lint. A control the kit lacks is a new component document in `packages/ui/components/`, not a second element family.
- **No inline styles**: a surface's look is its own `style` block keyed on `part`; shared chrome is `styles/*.css`, which is GENERATED from the `.json` beside it (`bun run styles:sync`). Do not set `style` attributes or `style.cssText`, and never hand-edit a generated stylesheet.
- **Dialog pattern**: call `showConfirmDialog` / `showSaveDiscardDialog` / `showPromptDialog` from `src/ui/layers.ts`, or mount a `jx-dialog` surface document into the dialog layer. Never create manual backdrops or modal overlays: a modal `<dialog>` opened with `showModal()` owns modality, focus restoration and Escape.

## NixOS Development Environment Considerations

If running on NixOS:

- A development server is already running on port 3000
- The studio interface can be accessed via: http://localhost:3000/packages/studio/index.html
- The jxsuite.com project can be accessed via: http://localhost:3000/packages/studio/index.html?project=~/Development/jx/sites/jxsuite.com/project.json
- Tests and validations are run at the project root level via `bun run all-the-things`
- Tests must be run with `--isolate`
