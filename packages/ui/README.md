# `@jxsuite/ui`

The Jx UI kit: interface elements authored as Jx documents, with the theme and the icons they draw on. Jx Studio's own chrome is built from it, and a site can register the same elements with `registerUi()`.

- `components/` — one document per element (`jx-icon.json`, …). Each is a custom-element definition the runtime interprets; nothing here is compiled.
- `project.json` — the kit as a Jx project. Its `style` block is the theme: every design token, on `:root`, in `light-dark()` pairs. Open this file in Studio to edit the kit on the canvas.
- `icons/` — `list.json` names the Phosphor glyphs the kit ships; `manifest.json` is generated from it by `bun run build:icons` and committed.
- `stylebook/` — one page per element showing every variant and state.
- `src/` — `registerUi()` (registers every element from bundled JSON, with no network), the theme builder, and the icon lookup.

Contract: [`specs/ui.md`](../../specs/ui.md). Embedding contract the kit relies on: [`specs/embedding.md`](../../specs/embedding.md).
