# Jx UI Kit Specification

## Interface Elements Authored as Jx Documents

**Version:** 0.1.9-draft\
**Status:** Partial\
**Updated:** 2026-09-02\
**License:** MIT\
**Applies to:** `packages/ui/`, `packages/studio/src/surfaces/`

Companion to [spec.md](./spec.md) §4, §13 and §16, [embedding.md](./embedding.md), and [studio-ui-guidelines.md](./studio-ui-guidelines.md). Defines `@jxsuite/ui`: the set of interface elements Jx Studio's chrome is built from, the theme they draw on, the icons they carry, and the model by which a host composes them into a surface. Every element is a Jx document the runtime interprets; nothing in the kit is a hand-written class.

---

## 1. Overview

> **Status: Partial.** §4, §8 and §9 are partly built; §5, §6, §7 and §10 are pending. The catalogue in §5 is the plan of record for the elements, and each entry is marked as it lands.

Jx Studio's chrome was Adobe Spectrum Web Components rendered by lit-html templates. The kit replaces it with elements authored in Jx for three reasons that are stated here so the decision stays a decision: Studio's second design principle says Studio is itself a Jx application, and the chrome is the one part of it that was not; a visual website builder is the hardest interface the component model will be asked to express, and building it in Jx forces the runtime, compiler and schema to grow what any large application host needs; and one design system, authored as documents and aligned to the platform's own overlay, colour and cascade standards, replaces a library's private engine and token pipeline.

The kit is **interpreter-first**. Its elements register through `defineElement` from bundled JSON (embedding.md §6), so the canvas that edits a component and the shell that runs it read the same bytes. A compiled distribution is a later optimisation and never a correctness dependency.

## 2. Principles

> **Status: Pending.**

1. **The element is the unit of reuse; the document is the unit of composition.** A Studio surface is a document that projects host state into kit elements. The kit carries no knowledge of Studio's state; a surface carries no markup of its own beyond the kit's.
2. **Light DOM, one cascade.** Every relationship the kit is built on is an id reference — `aria-activedescendant`, `aria-controls`, `aria-labelledby`, `popovertarget`, `commandfor`, `anchor-name` — and id references do not cross a shadow boundary. No element declares `$shadow` in this version; `part` attributes are the only sanctioned style hooks (§3.2), and the kit's own sheet lives in a cascade layer so a host's rule always wins (§9).
3. **The platform owns what it can.** Modality, focus containment, light dismissal, anchoring and transitions are `<dialog>`, `popover`, invoker commands, CSS anchor positioning and `@starting-style`. The kit adds behaviour only where the platform has none: roving focus, typeahead, pointer math, measurement.
4. **One list of actions.** A surface renders projections of Studio's command records (studio-ui-guidelines.md §12). The kit prints what it is given — a title, a chord, a disabled reason — and never formats or invents one.
5. **No imperative DOM beyond the allowed set.** A behaviour sidecar may call `focus()`, measure, and call an element's own `showPopover()`, `hidePopover()`, `showModal()`, `close()`, `scrollIntoView()` and `setPointerCapture()`. A sidecar that writes attributes on another element is a defect.

## 3. Authoring Model

> **Status: Pending.** The contract below is followed by `jx-icon` (§8); it becomes normative for every element as §5 lands.

### 3.1 Element, recipe, surface

| Kind        | Where                                 | Registers as                         | Owns                                                                           |
| ----------- | ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| **Element** | `packages/ui/components/jx-*.json`    | a custom element via `defineElement` | local interaction state no store should hold, a keyboard contract, ARIA states |
| **Recipe**  | the theme sheet (§4)                  | CSS rules on native elements         | nothing — the platform owns the semantics and the state                        |
| **Surface** | `packages/studio/src/surfaces/*.json` | a document a host mounts             | the projection of host state into elements                                     |

An element earns its keep when it owns local state no store should hold, a keyboard or ARIA contract, or must be addressable by the Library pane and the canvas as one thing. A `<kbd>`, a divider, a field label and a help line own none of those and are recipes.

### 3.2 The element contract

Every element document declares, and its catalogue entry in §5 records:

- **`tagName`** with a hyphen, and **typed `state` entries** for its props: `type`, `default`, `attribute`, `description` (spec.md §5.2). The interpreter installs a property accessor per entry and reads an observed attribute into state when the element connects, before `$props` merge, so a property a parent set wins (spec.md §16.2, §16.5).
- **`part`** on every internal node. In light DOM a consumer addresses `jx-x > [part="control"]`; should an element ever opt into a shadow root the same names become `::part()` with no consumer change.
- **Slots** by the names the catalogue lists: `icon`, `value`, `description`, `submenu`, `prefix`, `suffix`, `end`. The interpreter's light-DOM slot distribution is real for named slots (spec.md §16.6).
- **ARIA forwarding.** A control observes `aria-label`, `aria-labelledby` and `aria-describedby` and forwards them to its inner native control, which is what names it until form association exists.
- **Events.** Native events bubble from inner native controls. A custom event is declared with `emits` on the function that dispatches it, and is dispatched with `bubbles: true, composed: true`.
- **Tokens.** An element's style references `--jx-*` tokens and never a raw colour. A conformance test refuses a hex in an element's style.
- **Declarative first.** State changes are `$expression` nodes or structured bodies; keyboard `$switch` on `event#/key`; a sidecar (`$prototype: "Function"` + `$src`) only for what the closed operator set cannot express (§2 principle 5).

### 3.3 Behaviours

A behaviour is a pure `(state, event)` function exported from a module under `packages/ui/src/behaviors/`, registered through `preloadModule` under the `$src` specifier the documents use (embedding.md §6). The kit ships roving focus, typeahead, menu navigation, the anchor-position fallback measurement, label scrubbing, split dragging, overflow measurement, tree drag and drop, and colour math. Each is named in the catalogue entry of the element that uses it.

### 3.4 Composition from a host

A host mounts a surface with `mount()` (embedding.md §2) and hands its records and functions in as scope. A surface `$map`s a host array with a `key` (spec.md §10.4), calls a host function through `call` with positional arguments, and reports back with `dispatchEvent`. Which records a surface receives, and what they are projections of, is the Studio half of the contract (studio-ui-guidelines.md §9).

## 4. Theme and Tokens

> **Status: Partial.** The token sheet is built and adopted (`packages/ui/project.json`, `src/theme.ts`); recipes and the density and forced-colour rules for individual elements land with those elements.

### 4.1 Three layers

1. **Ramp** — `--jx-gray-50…975`, `--jx-blue-*`, `--jx-red-*`, `--jx-green-*`, `--jx-amber-*`: luminance-ordered steps, theme-independent, with quarter steps at the dark end of the neutral ramp because a dark interface lives in a ten-luminance band. The neutral ramp carries a faint cool cast (OKLCH hue about 250, chroma about 0.006) so grey does not read brown beside the accent.
2. **Semantic** — `--jx-bg`, `--jx-bg-panel`, `--jx-bg-input`, `--jx-bg-overlay`, `--jx-border`, `--jx-border-strong`, `--jx-fg`, `--jx-fg-dim`, `--jx-fg-muted`, `--jx-accent`, `--jx-accent-solid`, `--jx-accent-hover`, `--jx-accent-fg`, `--jx-accent-8…50`, `--jx-hover-bg`, `--jx-danger`, `--jx-success`, `--jx-warning`, `--jx-tag`, `--jx-signal`, `--jx-handler`, `--jx-map`, `--jx-switch-c`. Every colour is a `light-dark()` pair over ramp steps or a mix of another token; none names a hex outside the ramp.
3. **Aliases** — Studio's own `--bg`, `--fg`, `--accent`, … resolve these (`--bg: var(--jx-bg, #111114)`), so the names its style gate checks keep their shape and the values change in one place. A site overrides a token by declaring `--jx-*` on `:root` in its own `style`.

### 4.2 Declaration

The tokens are the `style` block of the kit's `project.json`, which is where a site keeps its design tokens (site-architecture.md §10.2), so opening the kit in Studio shows the values the shell runs on. `themeCSS()` builds them into one `:root` rule with the runtime's own style builder and `installTheme(document)` adopts the result once per document, inside `@layer jx-ui` (§9).

`color-scheme: light dark` follows the operating system; `:root[data-theme="light"]` and `:root[data-theme="dark"]` force one, and `light-dark()` resolves against whichever applies. The attribute is deliberately not `data-color-scheme` (spec.md §9.5), which is the **document's** axis: a dark builder editing a light page is the ordinary case, and two axes need two attributes. `data-density="compact"` and `"comfortable"` re-declare the control height and body size.

### 4.3 Scales

| Family  | Tokens                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Type    | `--jx-text-xs/sm/md/lg` = 10/11/12/14px with `--jx-leading-*` = 14/16/18/20px, a four-step scale on a 4px line grid     |
| Space   | `--jx-space-1…7` = 2/4/8/12/16/24/32px                                                                                  |
| Control | `--jx-control-h` = 24px (20px compact, 28px comfortable); `--jx-icon-size` = 16px                                       |
| Radius  | `--jx-radius-xs/sm/md/lg` = 2/4/6/10px                                                                                  |
| Focus   | `--jx-focus-ring` = `2px solid var(--jx-accent)`, drawn on `:focus-visible` only, `Highlight` under forced colours      |
| Shadow  | `--jx-shadow-popover`, `--jx-shadow-dialog`: shadows are for surfaces that float; panels are separated by 1px hairlines |
| Fonts   | `--jx-font-sans` (Inter, then the system stack), `--jx-font-mono`                                                       |

### 4.4 Motion and preferences

`--jx-dur-1` (150ms) for state changes and exits, `--jx-dur-2` (200ms) for a surface entering, one `--jx-ease-out` and one `--jx-ease-in`. `prefers-reduced-motion: reduce` sets both durations to `0ms`, which zeroes every transition in the kit at once; `forced-colors: active` swaps the focus ring for the system `Highlight`.

### 4.5 Registered properties

`--jx-accent` is registered as a `<color>` and the two durations as `<time>` with `@property`, so an invalid override falls back to the initial value rather than unsetting the token, and a colour transition interpolates.

## 5. Element Catalogue

> **Status: Partial.** `jx-icon` (§8), `jx-menu` and `jx-menu-item` (§5.1) are built. Every other entry is the plan of record and gains an `Implemented` marker as it lands.

Each entry records: `tagName`; props (typed `state` entries); events (`emits`); parts; slots; the WAI-ARIA pattern and its keyboard contract, with any deviation from the ARIA Authoring Practices named; tokens consumed; and what lives in a sidecar.

### 5.1 Primitives

> **Status: Partial.** `jx-textfield` is built: one native `<input>` or, with `multiline`, `<textarea part="input">`, whose `value` the reader and the host both write (a write equal to what is there never moves the caret), with `label` forwarded as `aria-label`, `invalid` as `aria-invalid`, `error` and `help` sentences drawn under it (the error region is permanent and empty until it has something to say, so the first refusal is announced through `aria-live` rather than only a later one; a host that refuses the SAME sentence twice must clear `error` and set it again, because a live region announces a change and an equal write is not one, and both sentences carry ids the control names in `aria-describedby` so a reader who returns to the field hears the refusal before the guidance), `labelledby` and `describedby` forwarded (the host's own description last), `mono`, `size`, `type`, `name`, `autocomplete`, `disabled`, `readonly` and `required`; `selectValue(host, mode)` and `focusField(host)` in `@jxsuite/ui/behaviors/textfield` are its two imperative doors. The control carries the field's value as its DEFAULT value as well as its current one, so a form reset cannot leave the element and its control saying different things: the value is the element's own state, and a reset the element never hears leaves that state where it was, so restoring a default is a host write of `value` until form association (§3.2) exists. `jx-button` and `jx-action-button` are built: each wraps one native `<button part="control">` that carries the type, the accessible name (`label`, `labelledby`, `describedby` forwarded) and the invoker attributes (`popovertarget`, `popovertargetaction`, `command`, `commandfor` forwarded, because the platform reads them from the button itself); `variant`, `size` and `quiet` are host data attributes the sheet reads; a `loading` button keeps its width, says `aria-busy` and cancels the next activation with `preventDefault` in its own click handler; a toggling action button flips `selected`, carries `aria-pressed` and dispatches `change`; `stacked` puts the icon above a visible label (the rail's shape), `haspopup`/`expanded` reach the control as `aria-haspopup`/`aria-expanded` for a menu button, and `badge` draws a count over the corner. `jx-menu` and `jx-menu-item` are built as specified below, in `packages/ui/components/`, with the menu behaviour in `src/behaviors/menu.ts`; `jx-menu` is placed by explicit viewport coordinates until anchor positioning lands (§6), and `jx-menu-group` and the recipes are pending. A `jx-menu` is always an `auto` popover; `jx-menu-item` reads `value`, `disabled`, `destructive`, `requires`, `checked` and `haspopup`, dispatches a bubbling `select` whose `detail` is its value, and stops the click at itself so a row inside a submenu does not also activate the row that owns it. `jx-menu` takes a `floor`, the lowest edge it and its submenus may reach, and a submenu that would leave the viewport on the right flips to its parent's left. Both are exercised by `packages/ui/tests/menu.test.ts`, and Studio's context and settings menus are built on them.

| Element            | Owns                                                                                                                                                                                                                                                          | Replaces                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `jx-button`        | a native `<button part="control">`; `variant` (accent, primary, secondary, negative), `size`, `quiet`, `loading` (blocks activation, keeps width), invoker attributes forwarded                                                                               | `sp-button`                     |
| `jx-action-button` | an icon-first tool button; `toggles`/`selected` → `aria-pressed`; roving `tabindex` inside a toolbar; `hold` to open a menu                                                                                                                                   | `sp-action-button`              |
| `jx-textfield`     | an inner native `<input>`/`<textarea part="input">`; `type=search` with `clearable`; `mono`; `invalid` → `aria-invalid`; Escape in a search field clears it                                                                                                   | `sp-textfield`, `sp-search`     |
| `jx-select`        | a select-only combobox: `role="combobox"` trigger over a `jx-listbox` in a `jx-popover`                                                                                                                                                                       | `sp-picker`, `sp-picker-button` |
| `jx-menu`          | `role="menu"`, roving focus, typeahead, a submenu stack as child menus in `slot="submenu"`                                                                                                                                                                    | `sp-menu`                       |
| `jx-menu-item`     | `menuitem`/`menuitemcheckbox`/`menuitemradio`; `destructive`; `requires` (the disabled reason, as `title`); `slot="value"` for a chord; **a row that owns a submenu still runs its own command** — the deviation studio-ui-guidelines.md §8.4 makes normative | `sp-menu-item`                  |
| `jx-menu-group`    | `role="group"` labelled by its heading                                                                                                                                                                                                                        | `sp-menu-group`                 |
| recipes            | `hr.jx-divider` (`aria-orientation` for a toolbar), `kbd.jx-kbd`, `.jx-badge`, `.jx-dot`                                                                                                                                                                      | `sp-menu-divider`, `sp-divider` |

### 5.2 Overlays

> **Status: Partial.** `jx-dialog` is built: a native `<dialog part="dialog">` opened modally through `showModal(host)` in `@jxsuite/ui/behaviors/dialog` or a `--show` invoker command aimed at the element, with `headline`, `confirm-label`, `secondary-label`, `cancel-label`, `destructive`, `dismissible` (which maps to `closedby`) and `size`; it dispatches `confirm`, `secondary`, `cancel` and `close`, leaves closing after `confirm` to the host so a refused value can keep it open, and carries a `[part="overlay-slot"]`. Its `open` state is mirrored from the platform's `toggle`, never written. **Focus on open is claimed, not left to markup order**: the confirm button carries `autofocus`, and a `destructive` dialog gives it to cancel instead, because `showModal()` otherwise focuses the first focusable descendant — which for a Save, Discard and Cancel footer is Discard, so answering with Enter threw the reader's work away. `jx-button` forwards `autofocus` to its inner control for this. `jx-popover`, `jx-tooltip`, `jx-toast-host` and `jx-spinner` are pending.

| Element         | Owns                                                                                                                                                                                                                                 | Replaces                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `jx-popover`    | `popover="auto\|manual"`, `anchor`, `placement`, `position-try-fallbacks`, the mandatory `@supports not (position-area: block-end)` fallback, `@starting-style` and `allow-discrete` transitions, `data-jx-settling` while animating | `sp-popover`, `sp-overlay`, `overlay-trigger`   |
| `jx-tooltip`    | `popover="hint"`, `role="tooltip"`, show delay, never focusable                                                                                                                                                                      | `sp-tooltip`                                    |
| `jx-dialog`     | a native `<dialog part="dialog">`; `headline`, `confirm-label`, `secondary-label`, `cancel-label`, `destructive`, `dismissible`; a `[part="overlay-slot"]` for popovers opened from inside it                                        | `sp-dialog-wrapper`, `sp-dialog`, `sp-underlay` |
| `jx-toast-host` | `role="status"` for sites; `aria-live="off"` in Studio, where `notify()` already announces                                                                                                                                           | `sp-toast`                                      |
| `jx-spinner`    | `role="progressbar"`, `indeterminate`, a required `aria-label`                                                                                                                                                                       | `sp-progress-circle`                            |

### 5.3 Forms

> **Status: Pending.**

| Element                   | Owns                                                                                                                                               | Replaces                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `jx-checkbox`             | an inner native checkbox; `indeterminate` as a property                                                                                            | `sp-checkbox`                          |
| `jx-switch`               | an inner native checkbox with `role="switch"`                                                                                                      | `sp-switch`                            |
| `jx-number-field`         | `inputmode="decimal"`, a stepper, Arrow ±step and Shift ±10×                                                                                       | `sp-number-field`                      |
| `jx-combobox`             | an editable combobox over `jx-listbox` with `aria-activedescendant`; option rows may carry a style preview                                         | `sp-combobox`, Studio's value selector |
| `jx-listbox`, `jx-option` | the shared popup of select, combobox and the palette                                                                                               | —                                      |
| recipes                   | `label.jx-field-label` (a native `<label id>` the control forwards as `aria-labelledby`), `p.jx-help-text` (`role="alert"` only in the error tier) | `sp-field-label`, `sp-help-text`       |

### 5.4 Containers

> **Status: Pending.**

| Element                             | Owns                                                                                                                              | Replaces                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `jx-tabs`, `jx-tab`, `jx-tab-panel` | real `tablist`/`tab`/`tabpanel`, `aria-selected`, `aria-controls`, roving focus, `activation="auto\|manual"`, `closable`, `dirty` | `sp-tabs`, and Studio's hand-rolled strips |
| `jx-accordion`, `jx-accordion-item` | a native `<details>`/`<summary>`; `name` for an exclusive group; the native `toggle` event                                        | `sp-accordion`, `sp-accordion-item`        |
| `jx-action-group`                   | `selects="none\|single\|multiple"` → `toolbar`/`radiogroup`/`group`; `compact` with `single` is the segmented control             | `sp-action-group`                          |
| recipe                              | `table.jx-table`                                                                                                                  | `sp-table`                                 |

### 5.5 Builder

> **Status: Pending.**

| Element                   | Owns                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jx-toolbar`              | `role="toolbar"`, roving focus, `orientation`, overflow into a `⋮` menu measured by a sidecar                                                                                                                            |
| `jx-dimension-field`      | number, unit and keyword, with label scrubbing                                                                                                                                                                           |
| `jx-box-editor`           | four sides and a link toggle for margin, padding, border and inset; `role="group"` with a per-side name                                                                                                                  |
| `jx-token-field`          | a literal or a `var(--token)` chip, with a picker of the project's tokens                                                                                                                                                |
| `jx-breakpoint-bar`       | a `radiogroup` of breakpoints, add and remove, drag to resize                                                                                                                                                            |
| `jx-split`                | `role="separator"` with `aria-valuenow`, pointer drag and Arrow keys                                                                                                                                                     |
| `jx-tree`, `jx-tree-item` | `tree`/`treeitem`, `aria-level`, `aria-expanded`, roving focus, typeahead, multi-select with an anchor, a windowing sidecar, drag and drop with cut and paste as the non-drag alternative (studio-ui-guidelines.md §8.2) |
| `jx-inline-edit`          | text that becomes an input on double click, F2 or Enter; Escape cancels                                                                                                                                                  |

### 5.6 Colour

> **Status: Pending.**

| Element                            | Owns                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `jx-color-area`, `jx-color-slider` | two hidden native ranges for the keyboard, pointer math in a sidecar; a styled native range over a gradient track                     |
| `jx-swatch`, `jx-swatch-group`     | a named button; a `radiogroup`                                                                                                        |
| `jx-color-field`                   | swatch, text, and a popover of area, sliders, alpha and tokens; the native colour input and `EyeDropper` only as a system-picker door |

## 6. Overlay Model

> **Status: Partial.** The dialog half is built: `jx-dialog` (§5.2) is a native modal dialog, so the platform owns inertness, focus restoration, Escape and `closedby`, and the kit adds nothing of its own around them. The popover half is built for menus: `jx-menu` is a native `auto` popover, a submenu is a child popover slotted into its row, and light dismissal, Escape one level and Tab-hides-root are verified in `packages/ui/tests/menu.test.ts` over a test shim of the popover API. Anchor positioning, `<dialog>`, invoker commands and discrete transitions are pending.

Menus, popovers and tooltips are native `popover` panels positioned with CSS anchor positioning (`anchor-name`, `position-anchor`, `position-area`, `position-try-fallbacks`) behind the mandatory `@supports` fallback the popover lint already requires. Dialogs are `<dialog>` opened with `showModal()`; openers use invoker commands (`command="show-modal" commandfor="…"`, `command="close"`), and a `--jx-*` custom command dispatches a `CommandEvent` a surface may answer declaratively. Entry and exit are `@starting-style` and `transition-behavior: allow-discrete`.

The top layer replaces a z-index ladder: whatever was shown later paints above what showed it. A modal `<dialog>` makes everything outside it inert, so a popover opened from a control inside one renders inside its `[part="overlay-slot"]`. A submenu is a child popover of its row and therefore in its parent's hierarchy: light dismissal closes the whole stack, Escape closes one level, and Tab hides the root.

In Studio, `layers.ts` keeps its exports (`renderPopover`, `showDialog`, `openModal`, `getLayerSlot`, `isModalOpen`) as the façade over these primitives; how each maps is studio-ui-guidelines.md §8.7.

## 7. Keyboard and Focus

> **Status: Partial.** The menu's roving `tabindex`, typeahead and submenu keys are built; the other composites are pending.

Composite widgets use a roving `tabindex` (menu, toolbar, tabs, tree, action group) or `aria-activedescendant` where the ARIA Authoring Practices permit it (listbox, combobox). Focus moves are the one thing a behaviour sidecar is for; everything else about a key is a `$switch` on `event#/key`. Escape closes one level of an overlay stack; a hidden `auto` popover restores focus to what opened it, which is the platform's own behaviour. Every move a drag performs is also reachable without one, which for a tree is cut and paste.

## 8. Icons

> **Status: Partial.** `jx-icon` and the manifest are built; the Studio icon check that reads the manifest lands with the first surface.

The kit draws Phosphor (MIT). `packages/ui/icons/list.json` names the glyphs and weights the kit ships — an allow-list, so the bundle carries what the shell uses — and `bun run build:icons` lifts each glyph's path data out of `@phosphor-icons/core` into the committed `icons/manifest.json`, one `<path d>` per name and weight on a shared 256-unit viewBox. A name the package does not know fails the build.

`jx-icon` takes `name`, `weight` (`regular`, `bold`, or `fill` — the active drawing of the same glyph; a missing weight falls back to `regular`), `label` and `mirror`, and renders one `<svg part="svg" role="img">` whose `<path d>` is a computed over the manifest through a `$src` lookup, so the manifest is a plain import rather than reactive state. **A label is the accessible name; without one the icon is hidden from assistive technology.** A name the manifest lacks draws nothing and warns once. Size is `--jx-icon-size`; colour is `currentColor`.

The manifest is one key space: a `name` on `jx-icon`, an `icon` on a Studio command or panel record, and a name in a surface document all resolve through it, and a check over Studio's sources holds every literal to it.

## 9. Build and Distribution

> **Status: Partial.** `registerUi()` and the theme are built; the stylebook and the optional compiled distribution are pending.

`@jxsuite/ui` ships JSON sources and TypeScript, not compiled classes. `registerUi()` preloads every component document under `jx-ui:/components/<tag>.json` and every behaviour module under the `$src` specifier the documents spell, then defines each element through the runtime's `defineElement`, and adopts the theme (embedding.md §6). It is idempotent per realm and touches no network.

The theme sheet is wrapped in one cascade layer, `@layer jx-ui`. A site's or Studio's own rules are unlayered and therefore win over a kit token by cascade order, never by specificity; Jx's own style emitter stays unlayered (spec.md §9.6).

The kit is a Jx project (`packages/ui/project.json`): Studio opens it, the Library pane lists its components, and `stylebook/` holds one page per element showing every variant and state. A conformance test validates every document against the schema, runs the overlay lint over it, and refuses a raw colour or an internal node without a `part`.

## 10. Studio Integration

> **Status: Pending.**

Studio registers the kit at boot, aliases its own token names to the kit's (§4.1), and re-authors each surface as a document mounted by an adapter that passes host records and functions as scope. The order, the per-surface contract and the gates are `studio-ui-guidelines.md` §6 and §9; this section records only what the kit promises the shell: every element in §5, the overlay model in §6, and one icon key space (§8).

## 11. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). Three things it draws on are not standards and are prose rather than rows: the ARIA Authoring Practices Guide (a W3C note the keyboard contracts follow, with the deviation §5.1 names), Open UI's customizable select research (which `jx-select` follows), and the Design Tokens Community Group format (a community deliverable the tokens may be exported to later).

| Standard                                                                                | Class       | Binds      | Evidence                                                                            | Note                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ----------- | ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/)                                         | **Pending** | §5, §6, §7 | —                                                                                   | `gap:ui-aria` Target Subset: menu, toolbar, tablist, tree, both combobox kinds, listbox, dialog, switch, separator, progressbar and tooltip, with their full state and keyboard contracts. One deviation is normative: a menu row that owns a submenu still runs its own command (§5.1).             |
| [Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/)       | **Subset**  | §8         | packages/ui/components/jx-icon.json, packages/ui/tests/icon.test.ts                 | `gap:ui-accname` `jx-icon` carries exactly one name source: `label` becomes `aria-label` on an `img`, and without one the glyph is hidden. The rule for every control — one name, forwarded to the inner native control — lands with the controls.                                                   |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                               | **Pending** | §4, §5, §7 | —                                                                                   | `gap:ui-wcag` Target Subset: SC 1.4.3 and 1.4.11 contrast gated per scheme, 2.4.7 focus visible through one ring token, 2.1.1 keyboard for every element, 2.5.7 a non-drag alternative for every drag, 2.3.3 reduced motion. No level is claimed.                                                    |
| [WHATWG HTML](https://html.spec.whatwg.org/)                                            | **Pending** | §3, §6     | —                                                                                   | `gap:ui-html-overlays` Target Subset: `popover` in all three modes, `<dialog>` with `showModal()`, invoker `command`/`commandfor` including custom `--` commands, `inert`, `autofocus`, `ToggleEvent`. Form association through `ElementInternals` is not offered.                                   |
| [CSS Anchor Positioning](https://www.w3.org/TR/css-anchor-position-1/)                  | **Pending** | §6         | —                                                                                   | `gap:ui-anchor` Target Subset: `anchor-name`, `position-anchor`, `position-area`, `position-try-fallbacks` (`flip-block`, `flip-inline`), always behind an `@supports` fallback. `anchor-size()` and `@position-try` rules are not used.                                                             |
| [CSS Scoping](https://www.w3.org/TR/css-scoping-1/)                                     | **Pending** | §3         | —                                                                                   | `gap:ui-scoping` Target Subset, recorded so the light-DOM decision is a decision: `:host` is translated to the tag (spec.md §16.6) and `::slotted()` is never used because no element has a shadow root.                                                                                             |
| [CSS Shadow Parts](https://www.w3.org/TR/css-shadow-parts-1/)                           | **Subset**  | §8         | packages/ui/components/jx-icon.json, packages/ui/tests/icon.test.ts                 | `gap:ui-parts` The `part` attribute is emitted on every internal node, which is the half of the standard a light-DOM element can honour; addressing one with `::part()` from outside needs a shadow root and is not offered. Moved here from standards.md §11.                                       |
| [CSS Custom Properties for Cascading Variables](https://www.w3.org/TR/css-variables-1/) | **Adopted** | §4         | packages/ui/project.json, packages/ui/src/theme.ts, packages/ui/tests/theme.test.ts | Every token is a custom property declared on `:root`, referenced with `var()` and a fallback where a consumer may load without the sheet.                                                                                                                                                            |
| [CSS Properties and Values API](https://www.w3.org/TR/css-properties-values-api-1/)     | **Subset**  | §4         | packages/ui/project.json, packages/ui/tests/theme.test.ts                           | `@property` registers the accent as a `<color>` and the two durations as `<time>`, with `inherits` and `initial-value`. Nothing else is registered and `CSS.registerProperty` is never called.                                                                                                       |
| [CSS Color 5](https://www.w3.org/TR/css-color-5/)                                       | **Subset**  | §4         | packages/ui/project.json, packages/ui/tests/theme.test.ts                           | `light-dark()` for every semantic colour and `color-mix(in oklab, …)` for tints. Relative colour syntax and `color-contrast()` are not used.                                                                                                                                                         |
| [CSS Cascade Layers](https://www.w3.org/TR/css-cascade-5/)                              | **Subset**  | §9         | packages/ui/src/theme.ts, packages/ui/tests/theme.test.ts                           | One named layer, `jx-ui`, wrapping the kit's sheet so an unlayered author rule wins by order; no `layer()` imports and no nesting. Jx's own emitter stays unlayered (spec.md §9.6). Moved here from standards.md §11.                                                                                |
| [Media Queries 5](https://www.w3.org/TR/mediaqueries-5/)                                | **Subset**  | §4         | packages/ui/project.json, packages/ui/tests/theme.test.ts                           | The user-preference features `prefers-reduced-motion` and `forced-colors` are honoured at the token level, and `prefers-color-scheme` through `color-scheme` and `light-dark()`. `@custom-media` is still not claimed: `$media` resolves it itself (spec.md §9.4). Moved here from standards.md §11. |
| [CSS Transitions 2](https://www.w3.org/TR/css-transitions-2/)                           | **Pending** | §6         | —                                                                                   | `gap:ui-discrete-transitions` Target Subset: `@starting-style` and `transition-behavior: allow-discrete` on `display` and `overlay`, which is what lets an overlay's exit animate.                                                                                                                   |

## Changelog

- **0.1.9-draft** (2026-09-02) — jx-textfield gives its control a default value, so a form reset cannot desync it.
- **0.1.8-draft** (2026-09-02) — the textfield's error live region is permanent, so the first refusal is announced.
- **0.1.7-draft** (2026-09-02) — jx-textfield names its error and help sentences in aria-describedby, and forwards labelledby and describedby.
- **0.1.6-draft** (2026-09-02) — jx-dialog claims focus on open (confirm, or cancel when destructive) and jx-button forwards autofocus (§5.1, §5.2).
- **0.1.5-draft** (2026-09-02) — jx-dialog and jx-textfield are built (§5.1, §5.2, §6).
- **0.1.4-draft** (2026-09-02) — jx-action-button gains stacked, haspopup/expanded and badge (§5.1).
- **0.1.3-draft** (2026-09-02) — jx-button and jx-action-button are built: one native button each, invoker attributes forwarded, loading and toggling states (§5.1).
- **0.1.2-draft** (2026-09-02) — jx-menu takes a floor and a submenu flips to its parent's left when it would overflow (§5.1).
- **0.1.1-draft** (2026-09-02) — jx-menu and jx-menu-item are built (§5.1), with the popover half of the overlay model (§6) and the menu keyboard contract (§7).
- **0.1.0-draft** (2026-09-02) — Initial release: principles, authoring model, theme and tokens, element catalogue, overlay and keyboard models, icons, build and distribution, Studio integration.

---

_Jx UI Kit Specification v0.1.9-draft_
