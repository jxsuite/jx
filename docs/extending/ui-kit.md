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
