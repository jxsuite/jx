# Jx Specifications

These specs are the source of truth for Jx behavior. User documentation ([`docs/`](../docs/README.md), published at jxsuite.com/docs) tracks what actually ships; the specs define what the contract is. Each top-level `*.md` here is one spec; files under `design-notes/` are working notes, not specs, and are exempt from everything below.

## Anatomy of a spec

```markdown
# `@jxsuite/server` Specification

## Development Server with Live Reload, Proxy Resolution, and Studio API

**Version:** 0.1.8
**Status:** Implemented
**Updated:** 2026-07-22
**License:** MIT

---

## 1. Overview

> **Status: Implemented.** …

… numbered sections …

## Changelog

- **0.1.8** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.1.7** (2026-07-22) — Fix failing tests (`56e073f8`).

---

_`@jxsuite/server` Specification v0.1.8_
```

| Field        | Rule                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **Version:** | MAJOR.MINOR.PATCH, plus -draft while the spec is not Implemented                               |
| **Status:**  | One of Implemented, Partial, Pending, Future, Removed                                          |
| **Updated:** | ISO YYYY-MM-DD; equals the newest changelog entry's date                                       |
| footer       | Specification v<version> — must equal the header version (optional, but enforced when present) |

Numbered headings (`## 5`, `### 5.1`, `#### 19.4a`) are anchors: docs pages reference them from `spec:` frontmatter. **Edit sections in place — never renumber or remove a numbered heading**, or `bun run docs:check` fails. Per-section state is a blockquote directly under the heading: `> **Status: Partial.** …`.

### What counts as an open item

A section's **leading** marker (the first blockquote under its heading) is its status on the implementation-status page and in the standards tiers. It is not the only thing the parser reads. A section is **open** when anything credited to it says Partial or Pending:

- its leading marker, or a later `> **Status: X.**` blockquote in the same section (an unnumbered heading ends the numbered section at its depth, and a deeper one stays inside it);
- a second status on a marker line (`> **Status: Implemented** for X. **Partial** for Y.`);
- a table cell that opens with a bold status word (`| **Pending** — stub returns null |`), except in a Standards Alignment or Adoption Backlog table, where `**Pending**` is a conformance class.

A marker above the first numbered heading is a **whole-spec** claim. Fenced code is an example and says nothing. `> **Status:** X`, with the colon inside the bold, is rejected: it was never read as a marker, so three sections carrying it looked unmarked. So is a marker after the first numbered heading that sits under no numbered section. A spec whose header is `Implemented` may have no open item at all; a `Future` remainder is deferred, not unbuilt, and is allowed.

## Releasing a spec

Every substantive edit is a release. Do not hand-edit the version, the date, or the changelog — record the release, in one of two forms:

```sh
bun run spec:change <spec.md> <major|minor|patch|stable> -m "<what changed>"   # a fragment, minted on the release branch (preferred)
bun run spec:bump   <spec.md> <major|minor|patch|stable> -m "<what changed>"   # in place, now
bun run docs:generate   # preview the derived reference pages locally (build outputs; never committed)
```

`spec:change` writes one small file under `specs/changes/` naming the spec, the level and the changelog sentence, and touches nothing else. It exists because the in-place form is where two pull requests releasing the same spec collide: both rewrite the `**Version:**` line and both prepend at the top of `## Changelog`, so whichever merges second conflicts on lines that carry nothing of its own. Two fragments never conflict. `.github/workflows/release-specs.yml` mints every fragment on the release pull request, in the order each landed on `main` (`bun run spec:release` does the same locally, `--dry` to preview), so the version a change gets is decided by when it merged, and the spec changelog page shows a recorded-but-unminted release as **unreleased** until then. The gate (`docs:spec-release`) accepts either form.

`spec:bump` advances the header **and** footer version, restamps `**Updated:**` to today, and prepends a `## Changelog` entry, in the pull request. Use it when you know no other open pull request releases the same spec, or when the number must be visible in the pull request itself.

| Level  | Use when                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| major  | A breaking change to a documented contract — renamed, removed, or redefined behavior that authors depend on |
| minor  | Additive — a new section, newly documented behavior, a contract that gains capability                       |
| patch  | Editorial — wording, examples, non-normative clarification                                                  |
| stable | Graduate a 0.x spec to 1.0.0 — a deliberate declaration that its contract is settled                        |

### Concurrent releases

The next version is computed from the **higher** of the working file and the same file on the base branch (`origin/main`, then `main`; `--base <ref>` overrides). That matters on a branch: fork before a release lands on main, and the local file still shows the old version, so bumping from it would mint a number main has already published. Two branches then claim the same version, and nothing says so until the merge — where `bun run docs:status` reports it as an ordering fault ("0.9.31-draft is not older than 0.9.31-draft") and the fix is renumbering the header, the footer and every entry above the collision by hand.

`spec:bump` prints the ref and the version whenever the base moved the answer. The floor is read from the base's **tip**, not from the merge base — the question is "is this number taken", which only the tip can answer. A ref that is unfetched, shallow, or does not carry the spec yet simply means no floor, so a stale `origin/main` under-reports rather than blocking; fetch if the printed version looks behind.

**Every spec is pre-1.0 today**, and while a spec is at `0.x` the release-please `bump-minor-pre-major` policy applies: `major` moves the **minor** digit, and `minor` and `patch` both move the **patch** digit. So a structural break reads `0.2.7 → 0.3.0`, and everything else reads `0.2.7 → 0.2.8`. Past `1.0.0` the levels mean exactly what they say.

These version numbers were not chosen by hand — they were **reconstructed from git history**. Every commit that touched a spec was classified by what it did to that spec's numbered-section anchor space (removed an anchor → structural break; added one → additive; neither → editorial) and the versions walked forward from `0.1.0` at the commit that introduced each spec. That is why each changelog entry carries the short SHA of the commit it describes.

The `-draft` suffix is derived from `**Status:**`, not chosen: specs that are not `Implemented` carry it, `Implemented` specs do not. To graduate a spec, set `**Status:** Implemented` first, then bump — the suffix drops automatically.

Changelog entries are one line each, newest first:

```markdown
- **<version>** (<YYYY-MM-DD>) — <what changed>
```

They are deliberately bullets rather than headings so changelog versions never collide with the numbered-section anchor space.

## Gates

| Command                   | Enforces                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| bun run docs:status       | Header fields, status vocabulary and marker forms, footer/header version agreement, changelog ordering, and no open item under an Implemented header |
| bun run docs:spec-release | A spec whose body changed also released it, in place or as a fragment under `specs/changes/` (keeps versions meaningful)                             |
| bun run docs:standards    | The `## N. Standards Alignment` tables: vocabulary, canonical citations, resolvable bindings, committed evidence, and the tracked gap list           |
| bun run docs:check        | Docs spec: anchors resolve to real numbered headings                                                                                                 |
| bun run docs:verify       | `docs:check` over a freshly generated page set, plus the screenshot image lock                                                                       |

A spec's "body" is everything except the release metadata — the `**Version:**` and `**Updated:**` lines, the `## Changelog` section, and the footer version. Header `**Status:**` and the per-section `> **Status: …**` markers _are_ body: changing what is built is a change worth releasing.

Three pages are generated from the metadata here and are never hand-edited, because they are never committed: [implementation status](https://jxsuite.com/docs/extending/reference/implementation-status) from the `**Status:**` markers, [spec changelog](https://jxsuite.com/docs/extending/reference/spec-changelog) from the `## Changelog` sections, and [standards](https://jxsuite.com/docs/extending/reference/standards) from the `## N. Standards Alignment` tables. They are build outputs of the site (`scripts/docs/generators/pages.ts`), gitignored, and written by `bun run docs:generate`; a release here reaches them at the next build, with nothing to regenerate in the pull request.
