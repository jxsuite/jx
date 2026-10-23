---
title: "Working in the monorepo"
description: "Repo layout, running Studio from source, tests, and the conventions the Jx monorepo enforces in CI."
code:
  - scripts/ci/affected.ts
  - scripts/docs/check-plans.ts
  - scripts/ci/approve-held-runs.ts
  - scripts/check-schema-freshness.ts
  - packages/test-support/src/preload.ts
  - packages/test-support/src/dom-equality.ts
  - packages/test-support/src/bun-pin.ts
---

# Working in the monorepo

The Jx monorepo ([github.com/jxsuite/jx](https://github.com/jxsuite/jx)) is a Bun workspace.

## Layout

- `packages/` holds the `@jxsuite/*` core packages: runtime, compiler, schema, server, studio, desktop, protocol, formulas, collab, ai, markup, import, starters, create.
- `extensions/` holds the extension packages built on the public hooks: parser (Markdown/CSV formats and content), connector (databases), auth, search, feed.
- `specs/`: the numbered specifications. These are the living source of truth: consult and update them **before** implementing a feature.
- `plans/`: transient implementation plans, one per open item in a draft spec. A plan claims the spec sections it closes, names the plans it requires, and is deleted in the pull request that lands it. `plans/README.md` is the contract; `bun run plans:status` prints what is ready to work on, and `bun run plans:check` gates the lot in CI.
- `sites/`: real sites built with Jx, including jxsuite.com.
- `docs/`: this documentation (see [Contributing to these docs](/docs/extending/contributing/docs)).

## Everyday commands

- `bun install`: set up the workspace.
- `bun run dev`: start the dev server and open Studio in a browser.
- `bun test --isolate` (per package): the supported test mode; plain `bun test` has known order-dependent failures.
- `bun run typecheck`, `bun run lint`, `bun run format`: tsgo, oxlint (all categories at error), oxfmt.
- `bun run lint` also runs the [ai-deslop](https://github.com/maharshi365/deslop) rules, which reject unchecked type assertions, `unknown` parameters and returns, runtime `typeof` branching outside type guards, and duplicate constants and types. `bun run lint:typecheck` is the type-aware pass (deprecated APIs, unnecessary conditions, floating promises, unsafe `any` flow). Both run at error in CI, and neither is turned off for tests or scripts; `.oxlintrc.json` explains each choice.

## Testing policy

Every package keeps full unit-test coverage, enforced per file by each package's `bunfig.toml` thresholds plus a manifest check that fails CI when a source file is never imported by any test. New source files ship with tests in the same PR.

**One Bun version.** CI installs exactly the version in `.bun-version` at the repository root, in every workflow, through `.github/actions/setup-bun`. Coverage figures and test output can move between Bun patch releases, so a different local Bun can disagree with CI. When yours differs, the test run prints one warning line naming both versions and carries on. It never fails the run: where the temporary directory cannot be written, the line repeats per test file instead.

**The shared test preload.** Every package whose tests use happy-dom preloads `@jxsuite/test-support/preload` from its `bunfig.toml`. It prints a DOM node as one line in a failure message, and it refuses deep equality on a DOM node: `toEqual`, `toStrictEqual`, `toMatchObject` and `toContainEqual` throw at once when either side is a node or holds one, inside class instances (an event, a mutation record) as well as plain objects and arrays. So do `toHaveProperty(path, value)` when the compared value holds a node, and `toHaveBeenCalledWith` and its last-call and nth-call forms when an argument or a call their failure would print holds one. Bun's diff printer can hang for minutes on a live UI-kit element, so the refusal is what keeps one bad assertion from stalling a CI job. Compare nodes with `toBe` (a recorded argument as `mock.calls[0][0]`), or a list of nodes with `identities()`:

```ts
import { identities } from "@jxsuite/test-support/inspect-dom";

expect(identities(seen)).toEqual(identities([first, second]));
```

## What CI runs, and when

A pull request runs the checks its diff can actually fail. The test matrix is **derived** from the workspace dependency graph, with no hand-written list behind it, so adding a package cannot leave it untested.

To see what your working diff would trigger, before pushing:

```bash
git diff --name-only origin/main... | bun scripts/ci/affected.ts --stdin
```

Three rules decide the scope:

- **A changed package retests its dependents.** Every `@jxsuite/*` package resolves to its `src/` and CI never builds first, so a change to `schema` is observable in every suite downstream of it.
- **Some suites read files outside their own workspace.** Those edges cannot be seen in a `package.json`, so they are declared in `scripts/ci/affected.ts`, each one naming the test file that proves it. Such an edge retests only that one suite, not everything downstream of it. The ones that exist today are listed in that file.
- **An unrecognised path runs everything.** A new top-level directory costs one full run until someone classifies it, which is the safe direction to be wrong in.

Pushes to `main`, the nightly cron, and manual dispatch are never gated: they always run the full matrix. That is the safety net if a rule above has gone stale, and it keeps each package's coverage baseline current.

`lint`, both typechecks and all the docs and schema gates run **unconditionally**, in one `checks` job. Each is a few seconds and a fresh CI job costs longer than that to start, so gating them would spend more time than it saves.

**Interaction-performance gate**: `.github/workflows/studio-perf.yml` traces Studio headless with `bun run perf:studio`. On PRs touching Studio, the UI kit or the runtime it is a same-runner A/B: the job builds the PR's merge base beside the PR, serves both, and interleaves five repetitions of every scenario between the two builds. Each scenario gets a fresh browser on each side. The gate fails on wall time or main-thread work (scripting, style and layout together), and only when the PR's median is more than 20 % and 25 ms above the base's and the repetitions separate (a one-sided Mann-Whitney test, p < 0.05). The three components are reported beside them as diagnostics. A scenario the base does not have yet is held to the ceilings in `scripts/perf/budgets.json` instead. A scenario that throws on either build, or whose command the PR no longer declares, fails the gate rather than leaving it. The A/B table is the job summary, and the failure names the scenario, the metric and the hottest source files. Nightly on `main`, the job compares against the tracked `scripts/perf/baseline.json` to watch for drift and uploads a fresh baseline captured on the runner. The comparison only fails the run when the baseline was captured under the current analyzer version; an older one is report-only. That `baseline.json` is only ever replaced from such a CI artifact, never from your machine; `scripts/perf/REPORT.md` has the adoption steps.

**Function benchmarks**: `.github/workflows/codspeed.yml` runs `bun run bench` on every pull request and on `main`, and CodSpeed comments on the pull request with a per-benchmark comparison against `main`. The benchmarks live in `bench/*.bench.ts` and cover hot paths in the runtime (expressions, CSS, pointers), the compiler's static output, collab diffing and markup conversion. CodSpeed's CPU simulation counts instructions rather than timing them, so results stay stable on shared runners. It is the one place the repository runs under Node: CodSpeed's JavaScript integration depends on V8 internals, so the benchmarks use `vitest bench`, and Bun still does the install and every test. A benchmark is a plain `bench()` call inside a `describe()`; add one to the file for its package, or start a new `bench/<area>.bench.ts`. Run the set locally with `bun run bench` (it needs Node on your path); outside CI the plugin reports timings only.

:::doc-note
`ci` is the aggregate job. It passes when every other job either succeeded or was skipped, and fails if any failed or was cancelled. A job your diff never reached leaves the run green.
:::

## Generated files are fixed for you, not failed at you

Two things in this repository are build outputs that happen to be committed: the screenshots under `docs/images/`, and every `*schema.json` (the core schemas under `packages/schema/`, plus the `project.schema.json` / `document.schema.json` pair in each project root). They are committed because editors, `jx validate` and published npm packages read them off disk. Nobody writes them by hand.

Both have a CI lane that **regenerates and pushes the result to your branch** rather than turning red and waiting for you:

- **Screenshots**: `.github/workflows/screenshots.yml` re-captures and comments with before/after thumbnails and the docs pages each changed image appears on.
- **Schemas**: `.github/workflows/schemas.yml` runs the generators and comments with the JSON Pointers that moved, naming `+ /$defs/ClassMethodDef/properties/role/enum/mount` instead of leaving 500 KB of diff to read.

:::doc-note
A lane's commit is authored by `github-actions[bot]`, and the repository holds every workflow run on a bot-authored commit until it is approved, `ci` included. The screenshots, schemas and spec-release lanes approve the runs their own push queues (`scripts/ci/approve-held-runs.ts`), so the pull request keeps reporting. If it reads BLOCKED with nothing red after a re-capture, look at the lane's comment: when the approval was refused, the comment names the held runs and the one-line `gh api` command that releases each of them.
:::

Locally the same two commands do the same work:

```bash
bun run schema:verify   # is every committed schema what its generator produces?
bun run schema:sync     # regenerate the stale ones
```

:::doc-warning
Never hand-edit a committed schema or a committed screenshot. The next run of either generator overwrites it, and CI will notice. If a pointer in the comment is not a change you meant to make, the fix belongs in the generator or in the source it reads.
:::

Three things make a schema go stale, and only one of them is forgetting to run the generator. The commonest is a **dependency bump**: the core schema injects web-standards data read at generation time from `@webref/css`, `@webref/elements` and `@webref/idl`, so bumping one rewrites the committed core by construction. That is why this lane, unlike the screenshot one, runs on Dependabot's branches too. The third is a **merge race**: two branches can each be green alone and stale together when one moves the core and the other regenerates a project root before it lands. Git merges that without a conflict and no per-branch check can see it, so the lane also watches `main` and opens a pull request when it finds drift there.

`bun run schema:verify` still blocks in CI. The lane cannot push to a fork, and a required check is what keeps a stale schema off `main` when it cannot.

A third committed build output follows the same shape: `packages/catalog/catalog.json`, the list of first-party extensions Studio offers, generated from every `extensions/*/jx-extension.json` and the class descriptors it names.

```bash
bun run catalog:verify  # is the catalogue what the extensions tree produces?
bun run catalog:sync    # regenerate it
```

It is its own gate rather than part of `schema:verify`, which derives its file set from tracked `*schema.json` and would never see this artifact. It also refuses to build at all when a package's `exports` map omits `./jx-extension.json`, or when the first-party docs page does not document an extension: both are conditions that would ship a catalogue entry nobody could act on.

## Releases, branches, and template versions

Versions are release-please's job. Every publishable workspace is a component in `release-please-config.json` with a matching `.release-please-manifest.json` entry, and both lists are **derived-checked** by `scripts/release-config.test.ts`. A package that is publishable but unlisted is never versioned, tagged or published, and nothing else in the pipeline can notice. Two extensions sat in exactly that state before the check existed.

A new package enters the manifest at `0.0.0`, which release-please reads as "no release yet", and names its first version with `initial-version` in its config entry (`0.1.0` for a pre-1.0 package; release-please's default is `1.0.0`). The integrity gate (`bun run release:integrity`) skips a `0.0.0` entry for the same reason: it claims nothing until the first release pull request lands. Seeding the manifest with a version that was never released is the other way round, and it is how `packages/catalog` came to claim a `0.1.0` no release ever shipped.

Two branches:

- **`main`** is the trunk. Every PR targets it, and it is the tip of development.
- **`release`** holds only released code. CI fast-forwards it to each `desktop-v*` release commit, but only after that release's installers are attached and `nix build` succeeds at the tag. It is what a NixOS user pins (`nix run github:jxsuite/jx/release`), so it must never point at a tree that does not build. Nothing pushes to it by hand.

  The release builds the flake on **two** architectures. Only the x86_64 leg gates the branch; the aarch64 leg is advisory, because it had never been built before and a failure there must not strand the users who do have a working architecture. Promoting it is a one-line change to `advance-release-branch`'s `needs`, and it should happen once arm has been green for a few releases.

  **`release` is also what jxsuite.com serves.** The site deploys from the released tree, so the documentation a visitor reads always describes the app they can actually download. The trade is deliberate and worth knowing before you write docs: a page merged to `main` is not public until the desktop component next releases. Pull requests and `main` still build the site; they just publish nothing. Breakage surfaces when you cause it, not on release day. To ship documentation ahead of a release, dispatch **Deploy jxsuite.com** manually with `ref: main`.

  Neither the release deploy nor the `release` push is triggered by watching the branch. CI moves `release` with a plain `GITHUB_TOKEN` push, and pushes made with that token do not start workflows. So `deploy-site.yml` is a `workflow_call` that release-please invokes, exactly like the npm publish and the desktop bundlers. An `on: push: branches: [release]` trigger would look correct and never fire once.

### Template dependency ranges are generated

Two places ship `@jxsuite/*` version ranges to people outside this repo, and neither is a workspace, so `bun install` never resolves them:

- `packages/starters/sites/*/package.json`: `@jxsuite/starters` publishes `sites/`, so these are the ranges a scaffolded project installs, and the ones Studio installs when it iterates a starter.
- `packages/create/template-versions.json`: the ranges `create` stamps into every project it generates, including starter clones, whose `package.json` it rebuilds from scratch.

Both are **generated**. `bun run templates:check` blocks in CI; `bun run templates:sync` is the fixer. Never hand-edit `template-versions.json`.

Keeping them current at release time is release-please's `extra-files`, which rewrites both surfaces **inside the release commit**, so the tree that gets published already carries the right ranges. A jsonpath addressing a scoped key must use the `[?(@property === '@jxsuite/x')]` filter form. The bracket form throws when a section exists without that key, which aborts the run and produces no release PR for any package. A test pins the spelling.

Left to drift, these ranges do more than annoy: a starter naming a version that was never published is one a user cannot install at all, and opening it in Studio raises a dependency-update dialog whose underlay covers the canvas, which is how that dialog ended up baked into 33 committed screenshots.
