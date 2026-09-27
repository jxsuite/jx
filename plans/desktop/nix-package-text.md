---
status: drafted
disposition: reconcile
claims:
  - desktop.md#9.3
requires: []
workspaces:
  - specs
  - docs
  - .github/workflows
size: S
---

# desktop.md §9.3 describes the Nix build, its source filter and the workflows that run it as they ship

## Context

`specs/desktop.md` §9.3, line 906:

> **Status: Partial.** The package, its desktop entry, the cache and the release gate ship (`packages/desktop/package.nix`, `packages/desktop/jx-studio.desktop`, `.github/workflows/nix.yml`), but three statements below are stale. The build phase runs `scripts/pre-build-rpc.ts`, not `pre-build.ts`; `src` is `lib.cleanSourceWith` over `lib.cleanSource` with `vendor` filtered out, not a plain `lib.cleanSource ../..`; and `nix.yml` has no pull-request trigger: `test.yml` calls it only on `release-please--` branches, and the path list survives only on its push-to-`main` cache trigger.

The section was unmarked before the census. All three marker facts hold at the audited commit, each change was deliberate, and each is already pinned by a test:

- **Build phase.** `package.nix` runs `bun run build`, then `bun run --cwd packages/desktop scripts/pre-build-rpc.ts`. That script builds Studio, bundles `src/chromium/init.ts` to `assets/studio/dist/init.js`, refuses a bundle that would not boot (`initBundleProblems(…, { electrobun: false })` from `scripts/init-bundle.ts`), and stages assets (`scripts/stage-studio-assets.ts`). Its own comment says why it skips `check-electrobun-vendor.ts --init`: no Electrobun import, and a sandbox with no network or git. The spec's `bun run build` gloss "(compiler, runtime, studio, schema)" also omits parser and search (root `package.json` `build`).
- **`src`.** `root = ../..; src = lib.cleanSourceWith { src = lib.cleanSource root; filter = path: _type: path != "${toString root}/vendor"; }`, with the #250 story in the comment above it. `packages/desktop/tests/electrobun-config.test.ts` ("the vendored SDK stays out of the Nix build sysroot") asserts the filter names exactly the directory the tsconfig `paths` resolve through, and fails on the bare form.
- **Triggers.** `nix.yml` has `push: main` (path-filtered, for the cache), `schedule` (nightly, because auto-merges raise no `push`), `workflow_call` and `workflow_dispatch` (`measure`, and `publish` as a backfill); no `pull_request`. `test.yml`'s `nix` job is `if: startsWith(github.head_ref, 'release-please--')` and sits in `ci`'s `needs`. `scripts/ci/affected.test.ts` asserts both ("nix is gated on the release branch, not on a diff", "nix.yml must not ALSO carry its own pull_request trigger").

Verification found four more stale statements in the same section, none in the marker:

- **The `bun.nix` auto-refresh bullet** (the stub's optional rider). The root `postinstall` runs `bun2nix -o bun.nix` only when `CI` is unset. The invariant CI holds is weaker and deliberate: `bun.nix` matches `bun.lock` at every release. `nix.yml` runs `scripts/check-bun-nix.ts --fix` in the working tree on every non-`publish` build, `.github/workflows/release-bun-nix.yml` commits the result to the release pull request, and the `publish` leg runs the check bare.
- **The build-dependencies bullet** omits the loopback registry shim (`packages/desktop/scripts/registry-shim.ts`) that `bun install` actually reads from, and the `forThisHost` filter. §9.3 names the filter only later, in the architectures paragraph.
- **"once that tag has both produced its installers and passed a real `nix build`".** `advance-release-branch` in `.github/workflows/release-please.yml` lists the four installer jobs and `verify-desktop-assets` in `needs`, but it runs under `if: always()` and reads only `needs.nix-build.result`. So it waits for the installers and is not gated on them. That was deliberate: 7c61c34c added `verify-desktop-assets`, which marks a release with a missing asset pre-release and opens an issue, with "Desktop bundlers stay non-blocking". `docs/extending/contributing/monorepo.md` line 128 repeats the stronger claim ("only after that release's installers are attached"). Its next paragraph says promoting the arm leg "is a one-line change to `advance-release-branch`'s `needs`". It is not, since that job reads no result but `nix-build`'s.
- **"The second question is also the only check anywhere…".** `nix.yml`'s "Publish the release closure to Cachix" step now evaluates `github:${GITHUB_REPOSITORY}/${PUBLISH_REF}#packages.<system>.default.outPath` and refuses to push when it differs from `./result`. `release-please.yml`'s `verify-cache` comment repeats the stale "only thing that proves".

The same stale `lib.cleanSource ../..` survives in three comments: `nix.yml` lines 2 and 126, and `scripts/check-bun-nix.ts`'s `generatorCommand` doc. So does `test.yml`'s "The gate is scripts/ci/affected.ts's NIX_INPUTS".

No docs page cites `desktop.md#9` or lists a Nix file in `code:`. `docs/start/install.md` (the NixOS section) describes only the consumer commands and the cache, and holds.

## Outcome

- `desktop.md` §9.3 → Implemented. It says what the build runs, why `src` filters `vendor`, what `bun.nix` promises and when, where the flake is built before a tag and why only there, and what `release` actually waits for.
- `docs/extending/contributing/monorepo.md` states the same gate.
- `desktop.md` stays Partial (§3.1, §3.3, §3.6, §4.3, §5.3, §6.1 to §6.5, §7.4 and §10.2 remain open), so nothing graduates.

## Decisions

- **Decided:** `reconcile`, because each of the three marker facts was a deliberate change that is documented where it was made and pinned by an existing test. The spec is what lags.
- **Decided:** take the `bun.nix` rider, and correct the build-dependencies bullet and the "only check anywhere" sentence too. The section loses its marker in this change, and a stale sentence under `Implemented` has no marker left to carry it.
- **Open:** should `release` wait on the installers' success, as §9.3 and the monorepo page say, or only on the Nix build, as `advance-release-branch` does? Recommendation: reconcile the text to the code. The branch serves NixOS users, who never receive an installer. §9.3 already makes the same argument for keeping the aarch64 leg advisory. And `verify-desktop-assets` already covers an installer gap, by marking the release pre-release and filing an issue. If the maintainers choose the gate instead, this item becomes a one-line code change in `advance-release-branch` (fail the advance unless every installer job and `verify-desktop-assets` succeeded), and the monorepo sentence stays.
- **Decided:** fix the stale comments in `nix.yml` (lines 2 and 126) and `release-please.yml` (`verify-cache`'s "(2) is also the only thing that proves"). Leave `test.yml` and `scripts/check-bun-nix.ts` alone. `.github/**` other than `test.yml` is in `NO_TESTS` in `scripts/ci/affected.ts`, but `test.yml` is `GLOBAL` and `scripts/check-bun-nix.ts` matches no rule, so it fails open. Either edit would run the full ~22-job matrix for a comment. The next change to those files fixes them.
- **Decided:** no new test. Every fact the rewrite states is already asserted by `electrobun-config.test.ts`, `affected.test.ts`, `nix-bundle-completeness.test.ts` and `chromium-app-id.test.ts`, or by `nix.yml`'s own publish step. A `packages/desktop` test reading `specs/desktop.md` would need an `EXTRA_EDGES` entry, and every spec edit would then run the desktop leg.

## Implementation

1. **`specs/desktop.md` §9.3**, in place, as given in Specs & docs: the marker; the first and second bullets and the build-phase bullet (install phase and wrapper stay); the "Which ref a consumer gets" paragraph plus one new paragraph after "Locally, …"; the last two sentences of "The push is best-effort by design"; the last sentence of "`release` never advances", which becomes a paragraph of its own; and the lead of "The workflow also runs on pushes to `main`". The desktop-entry, icon, cache and `nixConfig` paragraphs and "Both architectures" stay as they are.
2. **`.github/workflows/nix.yml`**, comments only. Lines 1 to 2: "because packages/desktop/package.nix builds `src = lib.cleanSource ../..`, i.e. whatever tree was fetched" becomes "because packages/desktop/package.nix builds whatever tree was fetched (`lib.cleanSource` of the repository root, minus `vendor`)". Line 126: "builds `src = lib.cleanSource ../..`, and `lib.cleanSource` filters" becomes "builds `src` from `lib.cleanSource` of the repository root, which filters", and gets ", and its own filter drops only `vendor`" after "but NOT `node_modules`".
3. **`.github/workflows/release-please.yml`**, comment only, above `verify-cache`: "(2) is also the only thing that proves the store path CI published is the one a `github:` flake fetch evaluates to." becomes "(2) is the check after the push that the store path CI published is the one a `github:` flake fetch evaluates to; nix.yml's publish step makes the same comparison before it pushes."
4. **`docs/extending/contributing/monorepo.md`**, as given in Specs & docs.
5. **Fragment**, as given in Specs & docs.
6. **Plan housekeeping in the landing pull request.** Delete this file. In `plans/desktop/app-structure-tree.md`, if it has not landed, cut "§9.3's `pre-build.ts` statement is `plan:desktop/nix-package-text`'s; " from its "Not this plan's" line, or `plans:check` reports a dangling citation.

**Integration contract.** No plan requires this one. Once it lands, §9.3 names every caller of `nix.yml` and what its build job asserts. So a plan that adds a caller or an assertion updates the "`release` never advances" or the pull-request paragraph in the same change. `plan:desktop/packaged-window-boot-ci` is not one: its chromium leg runs from the source tree in its own workflow and leaves `nix.yml` and §9.3 alone. A plan that changes `package.nix`'s build phase updates the build-phase bullet. A plan that makes the installers gate `release` rewrites the "Which ref" sentence.

## Tests

No test changes, and no workspace suite runs. Everything this plan touches (`specs/**`, `docs/**`, `plans/**`, `.github/workflows/nix.yml`, `.github/workflows/release-please.yml`) is `NO_TESTS` in `scripts/ci/affected.ts`, so the pull request runs `checks` and no per-workspace coverage threshold moves. After merge, `nix.yml`'s own path filter fires one cache build on `main`, which is harmless.

The gates in `checks` prove it: `bun run docs:status` (the marker form), `bun run plans:check` (no `claim-not-open`, no dangling citation), `bun run docs:spec-release` (the body change carries its fragment), `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` (no em dash in the monorepo edit), and `bun run docs:markdown`.

## Specs & docs

**Marker** (line 906) becomes:

> **Status: Implemented.** `packages/desktop/package.nix` (the derivation), `packages/desktop/jx-studio.desktop` (the entry), and `.github/workflows/nix.yml` (the build), which `test.yml` calls on the release pull request and `release-please.yml` calls at the tag.

**The first three bullets** become:

- **Build dependencies** are the tarballs `bun.nix` pins, each a fixed-output derivation that [bun2nix](https://github.com/nix-community/bun2nix) generates from `bun.lock`, trimmed to the host's `os` and `cpu` (`forThisHost`). `bun install --frozen-lockfile` reads them from a registry shim on loopback (`packages/desktop/scripts/registry-shim.ts`) that answers manifest requests from `bun.lock` and serves those tarballs. That is needed because Bun re-resolves a workspace's directly declared dependencies against a registry even with a full cache. The build needs no network access.
- **`bun.nix` matches `bun.lock` at every release, not at every commit.** It is a pure function of the lockfile. Locally, the root `postinstall` regenerates it after every `bun install` (not under `CI`), and `bun run nix:sync` does it on demand. A Dependabot update cannot, so `main` may carry a stale `bun.nix` between releases. `nix.yml` regenerates it in the working tree before every build that is not a release, `.github/workflows/release-bun-nix.yml` commits the regenerated file to the release pull request, and the release leg runs the same check bare (`scripts/check-bun-nix.ts`, `bun run nix:check`), so a drift that reaches the tag fails the build and `release` does not advance.
- **Build phase** runs `bun run build` (parser, search, compiler, runtime and studio, then the schema artifacts), then `packages/desktop/scripts/pre-build-rpc.ts`, the chromium launcher's pre-build. That script bundles `src/chromium/init.ts` to `assets/studio/dist/init.js`, refuses a bundle whose content would not boot the launcher (`scripts/init-bundle.ts`, §3.3), and stages Studio's assets (`scripts/stage-studio-assets.ts`). The build does not run `pre-build.ts`, the ElectroBun hook (§7.4), whose first step checks out the vendored SDK. This launcher imports no Electrobun, and the sandbox has neither the network nor the git that checkout needs.

**"Which ref a consumer gets."** Its first two sentences become: "`packages/desktop/package.nix` builds whatever tree was fetched, so the ref names the release. `main` is the development trunk and gives the tip; **`release` holds only released code**, advanced by CI to each `desktop-v*` tag once a real `nix build` at that tag has succeeded. The tag's installer builds finish first but do not hold the branch back: a missing installer marks that GitHub release a pre-release and opens an issue instead. A NixOS user therefore pins the branch, not the trunk:". The fence and "Locally, …" stay. After "Locally, …", insert:

> **One commit, one store path, however it was fetched.** `src` is `lib.cleanSource` of the repository root, narrowed by `lib.cleanSourceWith` to drop `vendor`, and that filter is what makes `$out` a function of the tree's content rather than of the fetcher. `vendor/electrobun` is a git submodule (§7.4) that no build phase reads and nothing in the derivation initialises, so its content is absent either way; its directory is not. GitHub's tarball, which `github:jxsuite/jx/release` fetches, materialises the gitlink as an empty directory, while Nix's git source for a checkout, which CI builds, omits it. Two empty directories are two NAR entries, so before the filter one commit had two store paths, and `desktop-v5.0.0` published the one no consumer asks for. With `vendor` filtered, the two sources hash identically. `packages/desktop/tests/electrobun-config.test.ts` asserts the filter drops exactly the directory `packages/desktop/tsconfig.json` resolves `electrobun/*` through, and the release checks the published path against the consumer's (below).

**"The push is best-effort by design."** Its last two sentences ("Either answering no opens an issue. The second question is also the only check anywhere …") become: "Either answering no opens an issue, and dispatching `nix.yml` on `release` with `publish` set backfills the cache. CI builds a git checkout and a user builds a GitHub tarball, so the path CI publishes can differ from the one a consumer's flake fetch evaluates to. That is checked twice: before the push, the publish step evaluates the tag's `github:` reference and refuses to push any other path, and after it, `verify-cache`'s second question asks again of the ref a consumer actually names."

**"`release` never advances."** The first two sentences stay, with "`.github/workflows/nix.yml` builds" becoming "`.github/workflows/nix.yml`, called by `release-please.yml` at the tag, builds". The last sentence ("The same workflow runs on any pull request touching …") is replaced by a paragraph:

> **Of all pull requests, only the release pull request builds the flake.** `nix.yml` has no `pull_request` trigger. A path-filtered workflow that does not fire leaves a required check pending forever, so it could never be one. The pull-request leg is instead the `nix` job of `.github/workflows/test.yml`, which has no path filter. It calls `nix.yml` only when the head branch starts with `release-please--`, and it reports into the `ci` aggregate that `main` requires. On every other pull request the job is skipped, and a skipped job leaves `ci` green. The cost is accepted: a dependency update that breaks packaging no longer blocks its own auto-merge. It surfaces on the release pull request, where `ci` still requires the build and a maintainer is reading the diff, and behind that the release leg still refuses to advance `release`.

**"The workflow also runs on pushes to `main`."** The bold lead becomes "**The workflow also runs on pushes to `main` and nightly, and those triggers are about the cache rather than the check.**" After "…because those derivations exist only here.", insert: "The `push` trigger carries the Nix build's one remaining path list (`flake.nix`, `flake.lock`, `bun.nix`, `bun.lock`, `packages/desktop/**` and the workflow itself). It decides when `main` refreshes the cache, not whether anything is checked. The nightly `schedule` exists because an auto-merged dependency update merges as `GITHUB_TOKEN`, which raises no `push` event, and without it the cache would go cold on the branch every pull request reads." The paragraph's last sentence (a release-PR merge builds twice) stays.

**Fragment:** `bun run spec:change desktop.md minor -m "§9.3 describes the Nix build as it ships: the chromium pre-build it runs, the vendor filter that gives a fetched tarball and a checkout one store path, bun.nix matching bun.lock at every release, the flake built on the release pull request only, and a release branch gated on the Nix build alone"`. Level: minor, a reconcile that redefines nothing an author builds on. If the installer decision goes the other way, drop the last clause.

**Docs** (no em dashes). No page's `spec:` cites `desktop.md#9`, and no page's `code:` lists a file this plan changes, so `docs:sync` names none. One page states the same gate and changes anyway:

- `docs/extending/contributing/monorepo.md`, the `release` bullet: "CI fast-forwards it to each `desktop-v*` release commit, but only after that release's installers are attached and `nix build` succeeds at the tag." becomes "CI fast-forwards it to each `desktop-v*` release commit once `nix build` succeeds at the tag. The installer builds finish first but do not hold it back: a missing installer marks that GitHub release a pre-release and opens an issue instead." In the next paragraph, "Promoting it is a one-line change to `advance-release-branch`'s `needs`" becomes "Promoting it means adding `nix-build-arm` to `advance-release-branch`'s `needs` and to the result that job checks before it pushes".
- `docs/start/install.md`: no change. Its NixOS section describes the consumer commands and the cache, which hold.

No spec graduates.

## Acceptance

- `bun run plans:status --spec desktop` no longer lists `desktop.md#9.3`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `sed -n '/^### 9.3/,/^### 9.4/p' specs/desktop.md | grep -nE 'cleanSource \.\./\.\.|any pull request touching|produced its installers|only check anywhere|auto-refresh|\(compiler, runtime, studio, schema\)'` prints nothing.
- The section's claims match the tree: `grep -n 'pre-build-rpc.ts' packages/desktop/package.nix` and `grep -n 'path != "${toString root}/vendor"' packages/desktop/package.nix` each print one line. `grep -nE '^  pull_request:' .github/workflows/nix.yml` prints nothing. `grep -n "startsWith(github.head_ref, 'release-please--')" .github/workflows/test.yml` prints the `nix` job's `if`.
- The gate reads one result: `sed -n '/^  advance-release-branch:/,/^  verify-cache:/p' .github/workflows/release-please.yml | grep -n 'RESULT:'` prints only `NIX_RESULT: ${{ needs.nix-build.result }}`.
- `grep -n 'cleanSource \.\./\.\.' .github/workflows/nix.yml`, `grep -n 'only thing that proves' .github/workflows/release-please.yml` and `grep -nE 'installers are attached|one-line change' docs/extending/contributing/monorepo.md` print nothing.
