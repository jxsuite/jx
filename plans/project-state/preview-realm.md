---
status: drafted
disposition: implement
claims:
  - project-state.md#11.2
requires: []
workspaces:
  - packages/studio
size: M
---

# Library and Site previews render in one isolated realm fed from the content store

## Context

`specs/project-state.md` §11.2 is `Pending`. The Library's and the Site panel's document previews render in Studio's own realm, so a project component's definition lands in Studio's custom-element registry, which cannot redefine a tag, and a changed component keeps its first definition until reload.

## Outcome

§11.2 → Implemented: one same-origin `<iframe>` hosts every out-of-canvas preview, receives documents from the store by message, and is replaced when a definition it already registered changes.

## Decisions

- **Decided:** one realm shared by every preview surface, not one per card, because the cost is the runtime and the project's components, loaded once.
- **Open:** whether previews are rendered as images (an `OffscreenCanvas` snapshot) passed back to the shell, or the cards themselves live inside the realm. Recommendation: the cards live in the realm, positioned by the shell, so text stays selectable and accessible.

## Implementation

`packages/studio/src/preview-realm/` (host page, message protocol, replacement on `componentsChanged` or `dependentsInvalidated` with tags), and the Library and Site panel surfaces mounting through it.

**Integration contract.** Surfaces ask the realm for a preview by `DocId`; they never import a project module themselves.

## Tests

`packages/studio/tests/preview-realm.test.ts` (message protocol, replacement on a changed tag) and the existing Library tests. Coverage in `packages/studio`; verified in a browser.

## Specs & docs

§11.2 → Implemented; `studio.md` §9.1.2 names the realm. Fragments for both specs (minor). No user-facing behaviour changes beyond previews updating.

## Acceptance

Edit a component and see its Library preview update without reload; `bun run plans:check`.
