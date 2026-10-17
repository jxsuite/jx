---
status: drafted
disposition: implement
claims:
  - site-architecture.md#9.4
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# Media with no context lands in public/media/, and the Media workspace is the fourth upload surface

## Context

`specs/site-architecture.md` §9.4 was Implemented until the workspace redesign rewrote its destination bullet in place. Its marker now reads:

> **Status: Partial.** Upload, browsing, metadata, the referenced-file warning and browsable usage (the Media view, `packages/studio/src/media/media-pane.ts`) all ship. The default destination does not: an upload with no context still lands in `public/` rather than `public/media/` (`uploadDirFor` in `packages/studio/src/files/media-upload.ts`), and the fourth surface is still the Library's drop zone, whose All category asks for a folder, rather than the Media workspace (`studio.md` §22.6).

The Studio side of the same change is studio.md §9.3 and §22.6, claimed by `plan:studio/workspaces` and built by its Media slice (`plan:studio/workspaces#WKS1.5`). This plan owns the site-architecture anchor because a plan lives under one spec, and it lands in the pull request that carries that slice.

## Outcome

- `site-architecture.md` §9.4 → Implemented: the marker's "does not" sentence goes.

## Decisions

- **Decided:** `public/media/` is a default and not a rule. A file under any other `public/` path is published and listed the same, and the reference rule (§9.3) is unchanged: a `public/` file is referenced from the site root, so `public/media/hero.jpg` is `/media/hero.jpg`.
- **Decided:** collection documents keep `content/<collection>/images/`; only the no-context default moves.

## Implementation

Built by the workspace plan's Media slice: `uploadDirFor` in `packages/studio/src/files/media-upload.ts` answers `public/media` with no collection context, the library model's media directory follows, and the Library's folder prompt (`resolveUploadDir` in `browse/library-pane.ts`) is deleted with the Library. No compiler change: `public/` is copied verbatim whatever its subdirectories.

## Tests

`packages/studio/tests/media-upload.test.ts`: the no-context default is `public/media`, a collection entry still co-locates, and the written reference is `/media/<name>`. Run with `bun test --isolate --coverage` from `packages/studio`.

## Specs & docs

- §9.4: set the marker to `> **Status: Implemented.**` with its evidence, in place.
- Fragment: `bun run spec:change site-architecture.md minor -m "§9.4: an upload with no collection context lands in public/media/, and the Media workspace is the fourth upload surface"`.
- Docs: `docs/studio/projects/media.md` (its `spec:` cites §9.4), in the workspace plan's docs slice; no em dashes.

## Acceptance

- `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#9.4`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release` pass.
