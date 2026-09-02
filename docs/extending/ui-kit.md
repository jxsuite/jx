---
title: "The Jx UI kit"
description: "Register the interface elements Jx Studio is built from, use its theme tokens and Phosphor icons in a site, and open the kit as a project."
spec:
  - ui.md#1 # what the kit is
  - ui.md#4 # theme and tokens
  - ui.md#5 # the element catalogue
  - ui.md#8 # icons
  - ui.md#9 # build and distribution
code:
  - packages/ui/src/index.ts
  - packages/ui/src/theme.ts
  - packages/ui/src/icons.ts
  - packages/ui/src/behaviors/menu.ts
---

# The Jx UI kit

`@jxsuite/ui` is the set of interface elements Jx Studio's chrome is built from. Each element is a Jx document, interpreted by the runtime. The kit also carries the theme those elements draw on and the icons they use. You can register the same elements in a site.

## Register the elements

```ts
import { registerUi } from "@jxsuite/ui";

await registerUi();
```

`registerUi()` defines every kit element in the current page and adopts the theme. It reads its documents from your bundle, so nothing is fetched. Calling it again does nothing.

Pass `{ theme: false }` to skip the theme, or `{ document }` to target another document.

## Use the theme

The theme is one stylesheet of custom properties on `:root`, inside the cascade layer `jx-ui`. Because your own rules are unlayered, they always win over a token.

```json
{
  "style": {
    "--jx-accent": "#7c3aed",
    "--jx-radius-sm": "6px"
  }
}
```

Every colour token is a `light-dark()` pair, so the theme follows the operating system. Set `data-theme="light"` or `data-theme="dark"` on the root element to force one. Set `data-density="compact"` to tighten control heights.

The tokens live in the kit's own `project.json`. Open that file in Studio to edit them on the canvas.

## Draw an icon

```json
{ "tagName": "jx-icon", "attributes": { "name": "plus", "label": "Add" } }
```

`name` is a Phosphor glyph the kit ships. `weight` is `regular`, `bold` or `fill`. `label` gives the icon an accessible name; leave it out when visible text already names the control, and the icon stays hidden from assistive technology. `mirror` flips the drawing for a right-to-left layout.

The list of shipped glyphs is `icons/list.json` in the package. Add a name there and run `bun run build:icons` to extend it.

## Buttons

`jx-button` wraps one native `<button>`, so everything the platform gives a button (a form submission, `popovertarget`, `command` and `commandfor`, focus, the keyboard) works through it. Its text is its label; `variant` says how much it asks for.

```json
{
  "tagName": "jx-button",
  "$props": { "variant": "accent", "command": "show-modal", "commandfor": "confirm-delete" },
  "children": [
    { "tagName": "jx-icon", "attributes": { "slot": "icon" }, "$props": { "name": "trash" } },
    { "tagName": "span", "textContent": "Delete…" }
  ]
}
```

`variant` is `accent`, `primary`, `secondary` (the default) or `negative`. `size` is `sm`, `md` or `lg`. `quiet` drops the fill and border until hovered. `disabled` disables the control. `loading` keeps the button's width, shows a spinner, says `aria-busy` and swallows the next activation. When the visible text is not the name, or there is none, give it a `label`; `labelledby` and `describedby` forward to the control too. `autofocus` forwards as well, so a button inside a dialog can claim the focus its `showModal()` would otherwise give to whichever control comes first.

`jx-action-button` is the icon-first tool button a toolbar is made of. `label` is required, because its name is not on screen; it is also the tooltip. `icon` names a glyph. `toggles` makes it a two-state button that carries `aria-pressed`, flips `selected` when activated and dispatches `change` with the new state. A host that owns the state sets `selected` itself, and the property wins.

```json
{ "tagName": "jx-action-button", "$props": { "label": "Bold", "icon": "text-b", "toggles": true } }
```

It is `quiet` by default. `emphasized` draws the selected state in the accent. `stacked` puts the icon above a visible label, the shape of a rail button. A button that opens a menu rather than running a command sets `haspopup` and `expanded`, which reach the control as `aria-haspopup` and `aria-expanded`. `badge` draws a count over the button's corner, and nothing when empty.

## Text fields

`jx-textfield` wraps one native `<input>`, or with `multiline` a `<textarea>`, so the platform's own editing, form participation and keyboard work through it. `label` is its accessible name and reaches the control as `aria-label`; give one unless a visible label points at the control. `value` is written by whoever types and by the host, and a write equal to what is already there never moves the caret.

```json
{
  "tagName": "jx-textfield",
  "$props": {
    "label": "Layout name",
    "placeholder": "Untitled",
    "value": { "$ref": "#/state/name" }
  }
}
```

The native `input` and `change` events bubble from the field as they always do. `invalid` marks a refused value and reaches the control as `aria-invalid`; `error` draws the sentence explaining it under the field and announces it as it changes; `help` draws a sentence of guidance. `type` is any text-like input type, `size` is `sm`, `md` or `lg`, and `mono` draws the value in the monospace face for a path, a selector or a colour. `name`, `autocomplete`, `disabled`, `readonly` and `required` forward to the control. To focus the field and select its value from a host, call `selectValue(host, "all" | "stem" | "none")` or `focusField(host)` from `@jxsuite/ui/behaviors/textfield`.

## Dialogs

`jx-dialog` is a native `<dialog>` opened modally, so the platform makes the rest of the page inert, answers Escape, and puts focus back where it was when the dialog closes. `headline` is its title and its accessible name; the body is whatever you put inside it. The buttons come from the labels: `confirm-label` (`OK` unless you say otherwise), `cancel-label` (`Cancel`), and `secondary-label` for a third answer such as Discard. An empty label removes that button.

```json
{
  "tagName": "jx-dialog",
  "attributes": { "id": "delete-page" },
  "$props": { "headline": "Delete this page?", "confirmLabel": "Delete", "destructive": true },
  "children": [{ "tagName": "p", "textContent": "The file is removed from the project." }]
}
```

Open it from a button with no script: `{ "tagName": "jx-button", "$props": { "command": "--show", "commandfor": "delete-page" } }`. A `--close` command closes it. From code, call `showModal(host)` and `close(host)` from `@jxsuite/ui/behaviors/dialog`. The dialog dispatches `confirm`, `secondary` and `cancel` for its buttons and `close` when it has closed for any reason; after `confirm` it stays open until the host closes it, so a value the host refuses can keep the dialog up with its message. `destructive` draws the primary button in the negative variant. `dismissible` lets a click outside the dialog close it; Escape always does. `size` is `sm`, `md` or `lg`.

**The dialog opens with its confirm button focused**, so a reader who answers the way people answer dialogs, with Enter, gets the primary action. A `destructive` dialog hands that focus to **cancel** instead, because the primary action there destroys something. Without this the browser focuses whichever button comes first in the markup, which for a Save, Discard and Cancel footer is Discard.

## Show a menu

A menu is a native popover. Give it a name and a viewport position, fill it with rows, and show it with the platform's own call:

```json
{
  "tagName": "jx-menu",
  "id": "actions",
  "$props": { "label": "Actions", "x": 120, "y": 80 },
  "children": [
    {
      "tagName": "jx-menu-item",
      "$props": { "value": "copy" },
      "children": [
        { "tagName": "span", "textContent": "Copy" },
        { "tagName": "kbd", "attributes": { "slot": "value" }, "textContent": "⌘C" }
      ]
    },
    {
      "tagName": "jx-menu-item",
      "$props": { "value": "paste", "disabled": true, "requires": "something on the clipboard" },
      "children": [{ "tagName": "span", "textContent": "Paste" }]
    }
  ]
}
```

```js
document.getElementById("actions").showPopover();
```

Each row dispatches a bubbling `select` event whose `detail` is its `value`. Listen for it on the menu. A disabled row stays in the list and shows its `requires` text as a tooltip. Set `destructive` on a row that deletes, and `checked` to `"true"` or `"false"` on one that toggles. A row with `haspopup` takes a child menu in its `submenu` slot, which opens on hover, on ArrowRight and on the chevron; the row itself still runs its own command.

Arrow keys, Home, End and typing a letter move between rows. Enter and Space activate. Escape closes one level, and a click outside closes the whole stack. Focus returns to whatever opened the menu when it closes, because the browser does that for every `auto` popover.

## Open the kit in Studio

The kit is a Jx project. Open `packages/ui/project.json` in Studio to see every element on the canvas, with one stylebook page per element showing its variants and states.

## Related

- [Embedding the runtime in your app](/docs/extending/embedding/runtime-host) for how a host mounts documents and passes state in.
- [Lists and iteration](/docs/framework/concepts/lists) for the keyed rows a surface is built from.
