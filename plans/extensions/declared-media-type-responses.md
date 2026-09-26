---
status: stub
disposition: implement
claims:
  - extensions.md#7
size: S
workspaces:
  - packages/server
  - packages/compiler
  - packages/schema
---

# Hosts serve a registered format's files with the media type its class declares

## Context

`specs/extensions.md` §7, line 259:

> **Status: Partial.** The block, `mediaType` validation (`mediaTypeProblem`, `packages/schema/src/media-type.ts`) and `(extension, capability)` exclusivity ship (`packages/schema/src/format-registry.ts`). The declared `mediaType` reaches only the studio's file-picker `accept` map and editor language id (`packages/studio/src/files/file-ops.ts`, `packages/studio/src/canvas/canvas-render.ts`): no icon or label reads it, and the dev server and `jx preview` set `Content-Type` from a fixed core table (`MEDIA_TYPE_BY_EXTENSION`) that knows only `.md`, `.markdown`, `.yaml` and `.yml`, so a format's declared type is never served.

The section was unmarked, and the census's first pass listed it as verified on validation and exclusivity alone. The `mediaType` row says the value is "Used for icons, labels and HTTP responses", and the paragraph after the table justifies validation by the value reaching "an HTTP header". Neither holds: the `.md` header is right only because the core table repeats what `Markdown` declares, and a third-party format's type (a `.toml` class declaring `application/toml`, §14) is served as whatever the host infers, or as `application/octet-stream` from `jx preview`. Disposition `implement` for the HTTP half, because the rationale for validating the value depends on it; the detail phase may instead `reconcile` the row to the real consumers if a registry lookup per static response proves the wrong trade.

**What exists**

- `FormatEntry.mediaType` and `mediaTypeEssence` (`packages/schema/src/format-registry.ts`), validated at registry build by `mediaTypeProblem`.
- `MEDIA_TYPE_BY_EXTENSION` and `mediaTypeForPath` (`packages/schema/src/media-type.ts`), the correction table both servers use: `fileResponse` in `packages/server/src/server.ts` and the `MIME_TYPES` map in `packages/compiler/src/site/preview-server.ts`, which falls back to `application/octet-stream`.
- The registry-backed readers: the file-picker `accept` map (`packages/studio/src/files/file-ops.ts`) and the editor language id (`packages/studio/src/canvas/canvas-render.ts`), fed by the formats payload (`packages/server/src/studio-api.ts`, `packages/desktop/src/project-session.ts`).

**What is missing**

- The dev server answering a registered format's extension with the declared `mediaType` (`fileResponse` has no registry today, but the same package builds one per project in `packages/server/src/resolve.ts` and `studio-api.ts`), with the core table kept for hosts that have no registry.
- `jx preview` doing the same for a build's export sidecars (§7 `exportTarget`), or a stated reason it cannot.
- Rides along, spec-only: the `mediaType` row's "icons, labels" struck (format icons come from `$studio.icon`, §10, and no label reads the type) and the consumers named as they stand once the HTTP half lands.

**Related**

- extensions.md §10 (the `icon` hint, which is what draws a format's glyph), extensions.md §14 (the TOML worked example).
- server.md §3 (the dev server's core endpoints and static fallback) and site-architecture.md §12.2 (the `jx preview` command).
