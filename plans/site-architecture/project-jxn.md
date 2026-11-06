---
status: drafted
disposition: implement
claims:
  - site-architecture.md#2.3
requires:
  - _shared/project-file-access
  - spec/jxn-format
workspaces:
  - packages/schema
  - packages/compiler
  - packages/server
  - packages/desktop
  - packages/site
  - packages/studio
  - packages/create
  - packages/import
  - packages/ai
  - examples
  - sites/jxsuite.com
  - sites/test-blank
  - scripts
  - specs
  - docs
size: L
---

# A project can be declared by a commented `project.jxn`, which every host reads and every writer keeps intact

## Context

`specs/site-architecture.md` §2.3 is Pending. `plan:spec/jxn-format` originally decided `project.json` would stay JSON, and the owner has reversed that. This plan makes `project.jxn` work everywhere, and `plan:site-architecture/provision-project-jxn` then makes it the default. KDL suits the project file better than almost any other file:

- It is the file people edit by hand most, and the one where a comment is worth most: why a redirect exists, why a breakpoint has that value, what a `permissions` rule protects. JSON cannot hold one.
- It is the only `.jxn` file a new user needs to read first.
- `project.json` is also Nx's name. `platforms/cloud.ts:1828` records that the cloud host's scan has to drop those. A `project.jxn` declares itself.

**Measured.** A prototype of the grammar below, run over all 30 tracked `project.json` files on 2026-11-06:

| Result                                                                                                                                         | Value                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Round trip, deep-equal                                                                                                                         | 30 of 30                                                         |
| Key order in `style`, `$media` and `$head` preserved                                                                                           | 30 of 30                                                         |
| All key order preserved                                                                                                                        | 29 of 30. One has `name` out of place, and its `name` is hoisted |
| Lines, against formatted JSON                                                                                                                  | 2,897 to 2,196 (-24%)                                            |
| Bytes                                                                                                                                          | 78,455 to 62,643 (-20%)                                          |
| 25 adversarial values (keywords as strings, `-0`, U+2028, one-item and nested arrays, `$ref` with siblings, raw-string breakers, a key of `-`) | All correct, with `__proto__` refused on purpose                 |

These are prototype numbers and need committed evidence before anyone quotes them. The prototype has no span map, no reconcile, and only `$head` rows with attributes and text.

**Where the reader and writers go.** `plan:_shared/project-file-access` is required first, because it reduces 61 spellings of the name, 23 reads and 8 writers to one module. Nothing in this plan should then touch those call sites except to pass new data through.

## Outcome

- site-architecture.md §2.3 → Implemented.
- `project.jxn` is read by every host, and written by Studio's settings, renames and the AI tools without losing a comment.
- `project.json` keeps working with no deprecation, and `jx convert` moves a project either way.
- New projects are still `project.json` until `plan:site-architecture/provision-project-jxn`.

## Decisions

- **Decided:** one grammar, not a second language. A project file is the `spec.md` §22 grammar with a different top level: no root element, and every node a member. `$head` uses element rows, `style` and `$media` use style rows, and everything else is §22's JSON block. So the reader reuses `$ref`, duplicate-key, NFC and rejection rules without restating them, and a person who can write one can write the other.
- **Decided:** the file declares itself with a `project` node, whose optional value is `name`. It comes first after any `$` metadata. Filename alone cannot decide, because a page at `pages/project.jxn` is legal and routes to `/project`, and the shape cannot decide, because `name "x"` alone has one non-`$` node and reads as an element. Wrapping the file in `project { … }` would also work, and indents the entire file for nothing.
- **Decided:** both the name and the node are required, and `classifyJxn` (`plan:spec/jxn-format`) decides from a prescan that tolerates later syntax errors, because `@bgotink/kdl` throws on the whole of `project "x"\ndefaults {` and the walker must still know what it is looking at. So a hand-edit typo leaves the folder a project, reported at its line and column. `project.jxn` without the node is a document, so `pages/project.jxn` stays a page; at a project root, `jx validate` says so and names the fix. A `project` node in any other filename is an error naming the rename, because a repository scan selects candidates by name before it reads them. An `unreadable` file named `project.jxn` is believed and reported, as `plan:desktop/open-from-os` decides for `project.json`.
- **Decided:** `project` is reserved at the top level of a `.jxn` document, and `$element project` is the escape. No tracked document uses that tag. `plan:spec/jxn-format` reserves it in JDF.1 along with `script`, so no `.jxn` file written before this lands can break.
- **Decided:** a folder with both files is refused, naming both. Silently preferring one would make the other a file that looks live and is not. Git makes the merge case loud on its own: one branch converting while another edits gives a modify/delete conflict.
- **Decided:** `project.json` stays supported indefinitely, as `.json` documents do. There is no reason to break a project that works, and `jx convert` is the only migration anyone needs.
- **Decided:** canonical form favours reading. `$media` and `style` always take one declaration per line, because `--="1280px"` reads badly. A one-item array is `key { - a }`, never `(array)key a`, since people copy what they see. Two or more scalars stay on one line. `(array)key` is only for empty. Sections are separated by a blank line.
- **Decided:** the common hand-writing mistake gets a real message. `extensions "@jxsuite/parser"` reads as a string, and schema validation fails. `jx validate` and Studio's Problem say: expected a list, written as `extensions { - "@jxsuite/parser" }`. Coercing from the schema instead would mean the reader needs the schema, and a composed one at that.
- **Decided:** every save goes through reconcile from JDF.3, with the project grammar. That covers all four whole-file writers: Studio's commit, Cmd-S, the rename pass and the starter re-stamp. Fresh emits use canonical form once `plan:site-architecture/provision-project-jxn` switches them.
- **Decided:** the AI `write_file` path keeps its model-authored text, and its gates at `ai-project-tools.ts:302`, `:348` key on `isProjectConfigPath`. Otherwise a `project.jxn` would skip validation entirely and go to `reloadTab` rather than `onProjectConfigWritten`, which would fail silently.
- **Decided:** a file that does not parse is never overwritten. Settings surfaces go read-only with a Problem at line and column, and the file opens in Code view. `commitProjectConfig` refuses, because a commit from an empty seed would replace the file.
- **Decided:** the project file stays out of collaboration, by the existing gate's reasoning (`collab/collab-session.ts:664`), through `isProjectConfigPath`. So `plan:spec/jxn-format`'s open question about `style` order in the CRDT does not touch this file. The check also has to cover `rekeyCollab` (`:729`), which does not re-test the path, since converting a project in a session is a rename onto that path.
- **Decided:** it is not a document anywhere. `FormatRegistry`'s built-in entry answers `.jxn`, so every glob that uses it (component discovery, the refactor scan, the Files tree's open path, conversion) would read the project file with the element grammar. Each goes through `isProjectConfigPath` first. The refactor scan must still include it, because a rename repairs `defaults.layout` there, with reconcile keeping the comments.
- **Decided:** exposure matches `.json`. `NEVER_SERVABLE` lists `project.jxn`. Today `public/project.jxn` would be served at `/project.jxn` as `application/octet-stream`, where `/project.json` is refused. `pages/project.jxn` remains a page. Nothing else changes, since root files are outside `SERVABLE_ROOTS` and the build's copy lanes.
- **Decided:** `packages/ui/project.json` and `packages/studio/project.json` stay JSON, with the kit and surfaces. `ui/src/theme.ts:15` imports the former statically. `sites/jxsuite.com`, `sites/test-blank` and `examples` convert in PJX.2 and run on the workspace, so the first real user is this repository. They are not starters, so they do not wait for a release. One fixture stays `.json` permanently to hold back-compatibility.

## Implementation

### The grammar

```kdl
/- kdl-version 2
$schema "./project.schema.json"
project "Bistro & Café"

url "https://bistro-cafe.pages.dev"

// The base layout every page inherits unless it names another.
defaults layout="./layouts/base.json" lang=en

// `connections` and `data` below come from the connector.
extensions "@jxsuite/parser" "@jxsuite/connector"

images {
    optimize #true
    widths 320 640 960 1280 1920
    formats webp avif
    quality webp=80 avif=65 jpeg=80 png=80
}

$head {
    meta name=viewport content="width=device-width, initial-scale=1"
    link rel=icon href="/favicon.svg"
}

$media {
    --md "(max-width: 768px)"
    --dark "(prefers-color-scheme: dark)"
}

style {
    --color-primary "#9a2f1a"
    "@--dark" {
        --color-primary "#e06a50"
    }
}

connections {
    main provider=sqlite file="./data/main.sqlite"
}

data {
    comments {
        connection main
        schema {
            type object
            properties {
                author type=string title=Author
                body type=string title=Comment
            }
            required author body
        }
        // Guests may comment, and only staff may edit or remove one.
        permissions read=public insert=public update=role:staff delete=role:staff
    }
}
```

| Written                                     | Means                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `project [name]`                            | The file's kind, and `name`. Required, once, first after `$` metadata |
| Top-level `$x` nodes                        | Those members, as in §22                                              |
| `$head { … }`                               | Element rows, as in §22. `- (ref)"…"` is a `$ref` entry               |
| `style`, `$media`                           | Style rows, as in §22, with source order significant                  |
| `key value`                                 | A scalar member                                                       |
| `key a b c`, `key { - a }`, `(array)key`    | An array of many, of one, and empty                                   |
| `key a=1 b=2`, `key { a 1; b 2 }`, `key {}` | An object. Both forms are the same data                               |
| `(ref)"pointer"`                            | `{ "$ref": "pointer" }`                                               |

### Where it lands

- **`packages/schema/src/jxn/project.ts`**: `parseProject`, `serializeProject`, and the span map from JDF.1, built on its JSON block and rows.
- **`packages/schema/src/project-file.ts`**: the name list, `findProjectFile` preferring neither and refusing both, and `findEnclosingProject` asking `classifyJxn`. It imports the parser statically and exposes it synchronously, because `@bgotink/kdl` is synchronous and several readers are too. A lazy import would save nothing, since `bundleBackend` and wrangler both inline it, the same reason `plan:spec/jxn-format` gives for the runtime. So a host carries the 10.3 KB whether or not a project uses `.jxn`. The compiled site and the runtime core do not.
- **Hosts** need no new call sites after `plan:_shared/project-file-access`, with these exceptions: the mtime caches pick up whichever file exists, `site/paths.ts` as above, `schema-command.ts`, and the native picker. `main/app.ts:232` filters to `["json"]`, and `:356` and `backend/window-hub.ts:301` say `Open project.json`, so without this a project on `project.jxn` cannot be picked. It belongs in PJX.2, because this repository's own sites convert there.
- **`jx convert`** gains the project file, including the case where the rename is `project.json` to `project.jxn` in place, and refuses if the target exists.
- **Studio**: `projectConfigPath()` reads the real name; `tabs/project-config.ts` seeds through `parseProject`; `services/monaco-setup.ts:208`; JDF.3's Monarch grammar; Problems through the span map; the visible labels in `surfaces/*.json` (19 surfaces mention the file, some only in `$description`) and the message strings.
- **`packages/ai`**, **`services/ai-system-prompt.ts:150`, `:461`, `:1017`**, the tool descriptions, `.claude/commands/jx.md` and `packages/studio/evals/tasks/*`: tell the model which file it has. The prompt must not teach `project.json` to a model looking at `project.jxn`.
- **Tooling**: `scripts/lib/workspaces.ts`'s `projectRootsIn`, `check-schema-freshness.ts:263`, `ci/affected.ts:112`, `perf/trace-studio.ts:25`, `studio-perf.yml:146`, `screenshots/manifest.json:539`, `screenshots/thumbnails.ts:65`, `desktop/scripts/smoke-backend.ts:291`, `:414`.

**Related, no edge.** `plan:_shared/jx-typechecking`'s generator must treat a project file as having no code, or `tsc` reports the element grammar's errors on every project. `plan:desktop/jxn-file-association` and `plan:site-architecture/provision-project-jxn` require this.

**Integration contract.** Once this lands: `findEnclosingProject` answers for `.jxn`, every writer keeps comments, and `jx convert` converts a project file in place.

## Tests

- `packages/schema`: the corpus test over every tracked project file, deep-equal plus order in `style`, `$media` and `$head`. A golden file per grammar row. `classifyJxn` on a page named `project.jxn`. The adversarial set above, as a table. Refusals: both files, a `project` node in another filename, duplicate keys after NFC, `__proto__`. Reconcile: a settings commit, an extension added, and a redirect removed, each a confined diff that keeps every comment.
- `packages/compiler`: every starter, converted in a temporary copy, builds byte-identically from either file. `jx validate` reports line and column and the one-item-array message. `jx convert` both ways.
- `packages/server`, `packages/desktop`, `packages/site`: discovery and each mtime cache with only `project.jxn`; `/project.jxn` refused on a site origin; `pages/project.jxn` routing while its folder is not a project.
- `packages/studio`: open, edit a setting and save with a one-line diff; a parse failure leaves the file untouched and shows a Problem; `ensureCollab` and `rekeyCollab` attach nothing; an AI write of invalid KDL is refused. Chrome MCP pass over Settings, Styles and Code view.
- `packages/create`: the starter re-stamp keeps comments through reconcile.
- Coverage thresholds ratchet in each workspace. `bun test --isolate` throughout.

## Specs & docs

- `site-architecture.md` §2.3: delete the marker. §2 and §2.1 name the file. `spec.md` §22 gains the project rows and reserves `project`. `desktop.md` §4.1 is retitled in place, with its anchor kept, per the heading rule. `compiler.md` §12: `jx convert`. `extensions.md`: `project.json#/extensions` becomes "the project file's". Each with a fragment: `bun run spec:change site-architecture.md minor -m "A project may be declared by project.jxn, and new projects are"`.
- Docs land per slice. PJX.2: `docs/framework/concepts/jxn-files.md` covers project files, `docs/framework/build/cli.md` covers `jx convert`. Pages that show a project file change when provisioning flips, not here.
- `bun run schema:sync` should have no effect, because the schema describes the data. If it does, something is wrong.

## Acceptance

- A project converted with `jx convert` keeps a comment through changing a setting in Studio, renaming the layout it references, and an AI edit.
- That project builds, previews and deploys, and a starter converted this way builds byte-identically to its `project.json`.
- `pages/project.jxn` is a page. A folder with both files gets a refusal naming both, in the CLI and in Studio.
- `bun run all-the-things`, `plans:check`, `docs:check` and `schema:verify` are green.

## Slices

| Slice | Scope                                                                                                         | Claims                   | State |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------ | ----- |
| PJX.1 | Grammar rows, `parseProject`, canonical `serializeProject`, corpus test                                       | site-architecture.md#2.3 | open  |
| PJX.2 | Every host reads it, refusals, exposure, the picker, `jx validate`, `jx convert`, this repository's own sites | site-architecture.md#2.3 | open  |
| PJX.3 | Every writer through reconcile, Studio, AI tools, the parse-failure rule; closes the marker                   | site-architecture.md#2.3 | open  |
