# Studio styling conventions

Studio's chrome is drawn by the **Jx UI kit** (`@jxsuite/ui`, [`specs/ui.md`](../../specs/ui.md)) and styled from its design tokens. All chrome styling is driven from a token — never from a hard-coded value — so the interface stays consistent and follows the theme in both directions.

**This document used to describe a Spectrum app**, and every claim in it was true until §C8: three token layers with `--spectrum-*` at the bottom, a semantic layer that had to live on the `sp-theme` element because `:root` was its ancestor, and a section ending "Do not move it to `:root`." The kit inverts that constraint rather than working around it — its tokens are declared at `:root` — and the whole of `styles/spectrum.css` is gone with the element it hung off. What follows describes the app that exists.

## Token layers

There are two now, not three. Reach for the **most semantic** one that fits.

1.  **Kit tokens — `--jx-*`** Declared on `:root` by the kit's adopted theme (`packages/ui/project.json`, `packages/ui/src/theme.ts`), inside `@layer jx-ui` so any unlayered rule of Studio's wins over one by cascade order rather than by specificity. They are the source of truth for colour, spacing, radius and typography: `--jx-accent`, `--jx-gray-300`, `--jx-space-3`, `--jx-radius-sm`, `--jx-text-md`, `--jx-font-sans`.

    **Every colour is a `light-dark()` pair**, so one token carries both themes and a stop cannot be overridden in one and forgotten in the other. The shell picks a side by stamping `data-theme` on `<html>` (`applyChromeTheme()`), and the kit's theme block declares a `color-scheme` per declared name. A `data-theme` value the kit has no rule for inherits `light dark` and lets the OS choose — which is the surviving shape of the bug that once shipped Preferences → Appearance → Light as a setting that changed nothing, and `tests/chrome-theme.test.ts` is what stands in front of it.

    Change brand colours in the kit's `project.json`, never in chrome CSS.

2.  **Studio semantic layer — `--bg`, `--accent`, `--radius`, …** A small set of Studio aliases declared on `:root` in `styles/tokens.css`. Each names a kit token with a hex fallback:

    ```css
    --accent: var(--jx-accent, #3b82f6);
    ```

    Use these for everyday chrome (`var(--bg)`, `var(--fg)`, `var(--accent)`, `var(--border)`, `var(--danger)`, `var(--radius)`, `var(--font-mono)`, …). The fallbacks are the kit's **dark** values, because the app boots dark, and `check-styles.ts` holds them to the table in `studio-ui-guidelines.md` §1.1.

    **The alias is the seam, and a typo in one is silent.** `--bg: var(--jx-bgg, #111114)` is not an error: it resolves to the fallback, which is a real colour, so the chrome keeps painting and simply stops following the theme. `tests/kit-tokens.test.ts` asserts every `--jx-*` name `tokens.css` defers to is one the kit declares, and that the chrome colours among them are `light-dark()` pairs.

The third layer is gone with its subject: `--mod-*` was Spectrum's per-component override channel, a way to reach into a shadow root and re-value one component's internals from a stylesheet. A kit element renders into **light DOM** and exposes `part` attributes, so a surface styles it by writing a rule, and `--mod-*` appears nowhere in the package.

## Where styles live

Three places, and which one a rule belongs in is decided by **when it has to paint** and **who it belongs to**.

- **A surface's own `style` block**, in `src/surfaces/*.json`, keyed on `part`. This is where a rule belongs when it is one surface's. A surface takes its rules with it.
- **`styles/*.css`** — the shared chrome: the frame, the panels, the inspector, the overlays, the canvas. Three of these are **generated** and must never be hand-edited (below).
- **`index.html`** is generated too, from `STUDIO_STYLESHEETS` in `src/hosting/layout.ts`. A stylesheet added to `styles/` and not added to that list is simply never loaded.

## Rules

### Colour — required

Never write a raw hex or `rgb()` for chrome. Use a token, with an optional hex fallback:

```css
/* ✅ */
color: var(--fg);
/* ✅ */
background: var(--jx-gray-300, #3c3c3c);
/* ❌ */
color: #cccccc;
```

Translucent tints derive from a token with `color-mix`:

```css
/* ✅ */
background: color-mix(in srgb, var(--success) 15%, transparent);
```

### Typography

- Sans chrome inherits `--jx-font-sans` from `:root`.
- Monospace uses `var(--font-mono)`: JetBrains Mono (the Jx brand mono, vendored as woff2 in `fonts/` with `@font-face` in `styles/tokens.json`), then SF Mono / Fira Code. The Monaco editor keeps literal font strings — those are JS API values, not CSS — and `src/services/monaco-setup.ts` remeasures fonts once webfonts finish loading.
- `font-size`: use `--jx-text-xs` (10px), `-sm` (11px), `-md` (12px), `-lg` (14px). Off-grid sizes (9px, 13px) have no kit step; keep them as literals.

### Corner radius

Use `var(--radius)` (= `--jx-radius-sm`, 4px), or `--jx-radius-xs` (2px) / `-md` (6px) / `-lg` (10px).

### Spacing, structure, elevation — pragmatic

The scale is coarse, so structural px are acceptable and **not** policed:

- Prefer `--jx-space-*` for new padding, gap and margin where a step fits (1=2, 2=4, 3=8, 4=12, 5=16, 6=24, 7=32px).
- Off-grid spacing (6px, 10px), grid track sizes, fixed widths and heights, 1–2px borders, and `z-index` may stay as literals.
- Drop shadows and modal scrims use `rgba(0 0 0 / …)` — neutral and theme-agnostic.

### Intentional exceptions

- macOS traffic-light window controls (`#ff5f57` / `#febc2e` / `#28c840`) are brand colours — allow-listed.
- Colour _values_ the user edits (the CSS-var editor, an `<input type="color">` default) are data, not chrome.

### The light canvas

Document and preview surfaces (the canvas viewport, the stylebook, the element-card previews, an empty slot's placeholder) always render light, in **either** chrome theme — a document is a document, and does not follow the chrome.

Four `--canvas-*` steps serve them, declared at `:root` in `styles/tokens.json` and mixed from the `black` and `white` **keywords**:

```css
--canvas-fg-2: color-mix(in srgb, black 80%, white);
--canvas-dim: color-mix(in srgb, black 47%, white);
--canvas-muted: color-mix(in srgb, black 40%, white);
--canvas-rule: color-mix(in srgb, black 7%, white);
```

They are the one deliberate exception to "every token follows the theme", and the keywords are the honest spelling of that: theme-independence is the requirement, so a `light-dark()` pair here would be the defect. They were `color-mix(… var(--spectrum-black) … var(--spectrum-white))`, which resolved to exactly this and only inside `<sp-theme>`. Seven more steps were declared beside them and no rule ever read one, so they did not survive the move. Those surfaces also set `color-scheme: light`.

## Guard

`scripts/check-styles.ts` (run via `bun run lint:styles`, and as part of `bun test`) is the gate. It reads the stylesheets, the TypeScript, and a surface document's `style` object — in either spelling, `"fontSize"` and `"font-size"` alike. Only style VALUES are read: a hex in a `textContent` or a `$description` is content, not chrome.

- **Fails** on a hard-coded hex colour. Add a genuinely intentional one to `ALLOWED_HEX` in that script, with a comment.
- **Fails** on a class emitted from `src/**` that no stylesheet defines, and on an `ALLOWED_ORPHANS` entry that has since been styled — the list only ratchets down.
- **Fails** on an `sp-` tag or a `--spectrum-*` token anywhere in the package, with an allow-list that is empty on purpose. Neither name fails loudly on its own: an `sp-` tag parses as an `HTMLUnknownElement` that paints nothing and swallows every event, and a `--spectrum-*` read silently takes its hex fallback. `.oxlintrc.json` refuses the module specifier beside it, because that is the door the family would come back through.
- **Fails** on an overlay layer with no `z-index`, or one that does not clear the layer below it. The four layers in `styles/shell-frame.json` are the one piece of ordering the whole overlay system depends on, and a tie is resolved silently by document order. This rule replaced one that failed on a modal card opened beside an `<sp-underlay>` with no `z-index` — which is how the blocking progress modal shipped with its only exit button unpressable. That element cannot be constructed any more, every modal is a `jx-dialog` whose top layer is not `z-index` ordered, and the palette that still draws its own scrim puts the panel inside it rather than beside it.
- **Fails** on a bare `outline: none` with no `:focus-visible` restore, on a `@keyframes` name defined twice, on a token pair below the contrast WCAG 2.2 asks of it, and on a row of `studio-ui-guidelines.md` §1.1 that disagrees with `tokens.css`.
- **Warns** on a `font-size` or `border-radius` px literal that has an exact kit token.

`styles/tokens.css`, `styles/shell-frame.css` and `styles/forced-colors.css` are **generated** from the `.json` files beside them by `scripts/build-styles.ts`, and each is excluded from `bun run format` so the generator is their only author. Edit the JSON and run `bun run styles:sync`; `bun run styles:check` is the gate. A rule's `$description` becomes the comment above it. They remain linked stylesheets because everything in them must paint before the kit's theme is adopted from JavaScript. There is no hand-written stylesheet in `styles/` any more: `styles/spectrum.css` was the last, and it went with `<sp-theme>`.
