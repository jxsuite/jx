# Jx Monorepo — CI, Dependencies and Releases

Subsystem notes for `.github/**` and the release machinery. The root `AGENTS.md` holds the rest of the agent notes, and everything in it applies here too. The desktop release lanes (Electrobun vendoring, Microsoft Store, Snap) are covered in `packages/desktop/AGENTS.md`.

## Dependency Autopilot

Dependencies update themselves and merge themselves. `.github/dependabot.yml` opens the pull requests, `.github/workflows/dependabot-auto-merge.yml` hands each one to GitHub's auto-merge, and the `ci` required status check on `main` is the only thing that decides. Nothing in the chain relaxes a check — the design is "let the suite be the reviewer", so a broken update is a red X and a stalled pull request, and the answer to one is more test coverage rather than a carve-out.

Three ecosystems, deliberately NOT consolidated into one pull request. `multi-ecosystem-groups` exists and is the wrong trade here: `.github/**` reaches no test workspace while `bun.lock` is in `affected.ts`'s GLOBAL list, so merging them would make every action version bump pay for a full run of the test suite.

| Ecosystem        | Cadence          | Grouping                   | What one pull request costs       |
| ---------------- | ---------------- | -------------------------- | --------------------------------- |
| `github-actions` | daily (weekdays) | one group, everything      | `checks` only                     |
| `bun`            | daily (weekdays) | minor+patch / major, split | the full ~22-job matrix, plus Nix |
| `nix`            | weekly           | one group, all four inputs | the Nix build only                |

The `bun` entry is a SINGLE root entry and covers all 21 workspace manifests — Dependabot expands the root `workspaces` globs itself and rewrites every member's `package.json`. `directories: ["/packages/*"]` would be wrong: a sub-directory bun job resolves the same root `bun.lock` upward, which is the "overlap in directories" the documentation forbids, and produces duplicate pull requests.

### bun.nix lags between releases, on purpose

`bun.nix` is a pure function of `bun.lock`, so every bun update makes it stale by construction — and **no bot can fix it on the Dependabot branch**. A push made with `GITHUB_TOKEN` raises no `pull_request` event, so the new head gets zero check runs and could never satisfy a required check. That is measured, not assumed: PR #131 carries a `github-actions[bot]` commit whose head still reports `state=pending` with no checks at all.

So the invariant moved. `bun.nix` matches `bun.lock` **at every release**, not at every commit:

- `bun run nix:check` / `bun run nix:sync` (`scripts/check-bun-nix.ts`) is the ONE definition of "regenerate bun.nix" — shared by the devShell's `update-nix-hashes`, both workflows below, and the root `postinstall`. It names the packages that moved instead of leaving a 289 KB diff to read.
- `nix.yml` regenerates it **in the working tree** before every build, so the Nix check on a dependency pull request answers _does this dependency set build?_ rather than going red on a generator nobody could have run.
- `.github/workflows/release-bun-nix.yml` commits the regenerated file to the **release pull request** — the branch that becomes the tag, and one a human is already watching.
- `nix.yml`'s release leg (`publish: true`) runs the check BARE. A drift there is a failure, not a fixup: if the sync ever fails to land, the release build fails, `release` does not advance, and release-please opens an issue. A stale `bun.nix` cannot reach a user.

### The Nix build runs on the release pull request, and nowhere else in `ci`

`nix.yml` has no `on: pull_request` trigger. A path-filtered workflow can never be a required check — it leaves the check pending forever when it does not fire — so test.yml (which has no `paths:` filter, and must never grow one) owns the pull-request leg via `workflow_call`, and the `ci` aggregate requires it.

**It is gated on the branch, not on the diff**: `startsWith(github.head_ref, 'release-please--')`. It was gated on the derivation's inputs (`bun.lock`, `package.json`, `packages/desktop/**`), which is most Dependabot pull requests, and it is by far the slowest job in the workflow.

The cost of that is explicit and was accepted: **a dependency bump which breaks packaging no longer blocks its own auto-merge.** It surfaces one step later, on the release pull request, where `ci` still requires the job and a human is already reading the diff — and behind that, `nix.yml`'s release leg runs BARE, so a broken derivation still cannot reach a `nix run github:jxsuite/jx/release` user. `skipped` is green and `failure` is not, which is what makes a branch gate enough.

Consequences for agents:

- **`affected.ts` no longer decides anything about Nix.** `NIX_INPUTS`, `Decision.nixBuild` and the `gate_nix` output are gone; do not reintroduce a path list for it. The only path list left is `nix.yml`'s own `push: main` filter, and that one is a **cache** trigger, not a check — it keeps `main`'s cache warm for every PR to inherit.
- `flake.nix`, `flake.lock` and `bun.nix` stay in `affected.ts`'s `NO_TESTS`: no test suite reads them, so they must not fail open into the whole matrix either.

### Settings, not code

Two things live in repository settings and cannot be asserted from the tree:

1.  **Allow auto-merge** (Settings → General → Pull requests). Without it the mutation errors out.
2.  **A ruleset on `main`** requiring a pull request and the `ci` status check, enforced for everyone. This is load-bearing, not hygiene: `gh pr merge --auto` FAILS OPEN — with no required check it performs an ordinary merge instead, and it treats `UNSTABLE` (non-required checks red) as immediately mergeable. That is why the workflow calls the `enablePullRequestAutoMerge` mutation, which errors rather than merging, and asserts the ruleset exists before delegating to it.

No secret is involved. On a Dependabot event `secrets.*` resolves against the separate Dependabot store, so a secret referenced in that workflow would arrive as an empty string — a failure that reads like a malformed value rather than a missing one.

### Traps that are quiet rather than loud

- **`bun.lock` must stay at `lockfileVersion: 1`.** Dependabot's updater image pins Bun 1.3.14, which refuses version 2 — Bun 1.4's default for a lockfile written from scratch. The failure is `DependencyFileNotSupported`, i.e. bun updates simply stop arriving. `scripts/dependabot-config.test.ts` asserts this, along with everything else in this section that can be asserted from the tree.
- **A `GITHUB_TOKEN` merge starts no `push` workflows.** release-please and the Nix cache-warming build are both `push: main`, and auto-merge merges as `GITHUB_TOKEN` — so both now also run on a schedule. Without that the release pull request would silently stop picking up commits and the Actions cache on `main` would go cold.
- **A three-day cooldown applies to every version update** whether or not it is configured, and the days keys cannot be set to zero. `cooldown: { exclude: ["*"] }` is the documented lever for zero delay; it trades away the supply-chain quarantine, so it is not the default here.
- **Release-only workflows are unexercised.** `bundle-desktop-*`, `build-msix` and `publish` are `workflow_call`-only, so an action bump inside them is first executed during a real release. Accepted deliberately — that pipeline already fails loudly and opens issues — but it is the one place where a green `ci` does not mean "tested".
- **`@jxsuite/*` is ignored** for the bun ecosystem. release-please owns those ranges (it rewrites them inside the release commit via `extra-files`, and `bun run templates:check` gates them), so a Dependabot bump would be a second writer on the same line.

## Releases, and the two ways one silently does not happen

release-please owns every version, tag, changelog and npm publish (`release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`). Both of its failure modes exit 0, which is why each now has a gate.

### A raw `<tag>` in a commit subject deletes that package from its own release

release-please writes the release pull request body with changelog text HTML-escaped, then on merge parses that body and **re-serialises it** (`PullRequestBody.parse(...).toString()`) before parsing it a second time in `buildRelease()`. The round trip DECODES the entities, so `&lt;picture&gt;` comes back as a live `<picture>` element; node-html-parser then swallows the `</details>` that should have closed the section, the component is no longer found in the parsed release data, and release-please logs `Pull request contains releases, but not for component: <name>` and skips it — no tag, no GitHub release, no npm publish, green run.

`feat(compiler): responsive images — <picture> per format…` did exactly that: `schema` and `starters` fell out of three consecutive releases, and `@jxsuite/starters` sat at 1.2.2 on npm while `@jxsuite/create@1.3.2` shipped depending on `^1.5.0`, so `npm install @jxsuite/create` was unresolvable. The bug is upstream and still present in release-please 17.11.1, so the defence is to keep the text out of the changelog. **Backticks do not help** — the escaping happens on raw text.

- The rule and the full write-up live in `commitlint.config.ts` (`changelog-safe-angle-brackets`).
- `.husky/commit-msg` applies it as you commit; `checks` runs `bun scripts/check-changelog-safety.ts` over the pull request's commits, because a hook is skippable with `--no-verify` and that is how the subject landed.
- Only the **subject** and `BREAKING CHANGE:` notes are judged — nothing else reaches a changelog, so a commit body may still contain markup.

### A crashed `release-please` job disables the whole pipeline on the re-run

The job creates the GitHub releases first and builds the next pull request second. If it dies in between — a GitHub 5xx during its commit-history walk, which an un-tagged component provokes by forcing a 500-commit backfill — the releases exist but the run failed. **Re-running it is not idempotent in the way that matters**: the pull request is already labelled `autorelease: tagged`, so `releases_created` comes back `false` and `publish`, all four desktop bundlers, `nix-build` and `deploy-site` all skip. That is how `desktop-v2.2.0` shipped with no installers.

`verify-release-integrity` is the answer: `if: always()`, gated on nothing, it asserts every version in `.release-please-manifest.json` has a GitHub release at its tag (`bun run release:integrity`). It fails the run and opens ONE `release-incomplete` issue. Nothing `needs:` it, so a red X there blocks nothing else. The daily schedule on the workflow makes it a standing sweep.

To backfill npm after a skip, `publish.yml` has a `workflow_dispatch` entry point and is idempotent: `gh workflow run publish.yml -f paths_released='["packages/ai"]' -f sha=$(git rev-parse origin/main)`. Already-published versions are skipped, so running it when nothing was missing is a no-op.

### The gate does not ask npm, and that is a decision with evidence behind it

It used to, and the registry half was **removed rather than made more patient**. `npm publish` printing `+ @jxsuite/ai@0.37.0` does not mean `npm view @jxsuite/ai@0.37.0` will find it: the version's `time` entry in the packument is stamped when the registry finishes writing, and that trails acceptance by up to three minutes, for a package or two per release, unpredictably. On the 2026-08-30 release, `connector` was readable 76s after acceptance, `site` 96s, `ai` 187s — and the other sixteen packages in the same run were readable within a second.

So the probe filed an issue every time it raced a slow write. Every "Released versions that never shipped" issue this repository has ever had, measured against when npm actually became readable:

| Issue | Version                    | Readable                          |
| ----- | -------------------------- | --------------------------------- |
| #177  | `@jxsuite/ai@0.36.2`       | 39s **after** the issue was filed |
| #199  | `@jxsuite/connector@0.5.3` | 36s **after** the issue was filed |
| #264  | `@jxsuite/ai@0.37.0`       | 82s **after** the issue was filed |
| #264  | `@jxsuite/site@1.1.0`      | 1s **after** the issue was filed  |

Nought for three: not one real catch, and three rounds of someone investigating a release that was already fine. A detector whose every firing is noise teaches people to ignore the firing that is not, which costs more than the check was ever worth. **Do not add it back with a longer retry** — the lag is a property of the registry, unbounded from here, so any budget is a guess that turns a false red into a slower false red.

The release check is the half that had the value anyway. The six-week `starters` incident had **no tag and no release**, not merely a missing publish, so the surviving check catches it — and it cannot fail the way the npm probe did, because `gh release view` is read-after-write consistent: a 404 means the release is genuinely absent rather than not replicated yet.

What is no longer watched, and where it would surface instead: a run where release-please created the tags but `publish` skipped or failed. `publish` failing is a red job on its own; `publish` **skipping** (the `releases_created == false` re-run case) is now caught only by the missing GitHub release, which that same failure mode also produces.
