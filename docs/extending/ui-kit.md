---
title: "The Jx UI kit"
description: "Register the interface elements Jx Studio is built from, use its theme tokens and Phosphor icons in a site, and open the kit as a project."
spec:
  - ui.md#1 # what the kit is
  - ui.md#3.1 # element, part, surface
  - ui.md#4 # theme and tokens
  - ui.md#5 # the element catalogue
  - ui.md#5.2 # overlays
  - ui.md#5.1 # primitives
  - ui.md#5.3 # forms
  - ui.md#5.4 # containers
  - ui.md#5.5 # builder: trees, toolbars, splitters
  - ui.md#5.6 # colour
  - ui.md#8 # icons
  - ui.md#9 # build and distribution
code:
  - packages/ui/src/index.ts
  - packages/ui/src/theme.ts
  - packages/ui/src/icons.ts
  - packages/ui/src/behaviors/menu.ts
  - packages/ui/src/behaviors/textfield.ts
  - packages/ui/src/behaviors/number-field.ts
  - packages/ui/src/behaviors/select.ts
  - packages/ui/src/behaviors/listbox.ts
  - packages/ui/src/behaviors/combobox.ts
  - packages/ui/src/behaviors/popover.ts
  - packages/ui/src/behaviors/dialog.ts
  - packages/ui/src/behaviors/tooltip.ts
  - packages/ui/src/behaviors/toast.ts
  - packages/ui/src/behaviors/toast-host.ts
  - packages/ui/src/behaviors/tabs.ts
  - packages/ui/src/behaviors/action-group.ts
  - packages/ui/src/behaviors/toolbar.ts
  - packages/ui/src/behaviors/split.ts
  - packages/ui/src/behaviors/tree.ts
  - packages/ui/src/behaviors/color-area.ts
  - packages/ui/src/behaviors/color-slider.ts
  - packages/ui/src/behaviors/swatch-group.ts
  - packages/ui/src/behaviors/color-field.ts
  - packages/ui/src/color.ts
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

## Style a part

The kit ships no CSS class. Every node inside an element carries a `part`, and the element's own `style` object is where its drawing lives. Because the elements are light DOM, a part is an ordinary descendant you can address from where you use the element:

```json
{
  "tagName": "jx-button",
  "style": {
    "& > [part=\"control\"]": { "minWidth": "8rem" }
  },
  "children": [{ "tagName": "span", "textContent": "Publish" }]
}
```

A `style` object written where the element is used merges with the element's own and wins, so one instance can be drawn differently without a rule reaching into the kit. A rule on an ancestor works the same way: `"& jx-button > [part=\"control\"]"`. Each section below names an element's parts. A part whose name ends in `-slot` is the box around something that may not be there: a named slot, or a branch the element draws only in some states. It is what the element asks `:empty` of, since a slot itself leaves no node.

## Draw an icon

```json
{ "tagName": "jx-icon", "attributes": { "name": "plus", "label": "Add" } }
```

`jx-icon` draws one glyph. `name` is a Phosphor glyph the kit ships. `weight` is `regular`, `bold` or `fill`. `label` gives the icon an accessible name; leave it out when visible text already names the control, and the icon stays hidden from assistive technology. `mirror` flips the drawing for a right-to-left layout.

The list of shipped glyphs is `icons/list.json` in the package. Add a name there and run `bun run build:icons` to extend it. A weight the manifest lacks falls back to `regular`. The parts are `svg` and `path`.

## Dividers, key caps and dots

Three elements own a box and nothing else. They are elements because two or more definitions draw the same box, and a definition's `style` object is the only place a declaration may live.

`jx-divider` is a hairline: one `<hr part="rule">` the platform already announces as a separator. `orientation` is `horizontal`, the default, or `vertical`. The vertical branch makes the host a flex box exactly as wide as the rule it holds, so it stretches to a toolbar's height and takes no width beyond the hairline. The host still has a box, one client rect coincident with the rule, which is what the canvas selects and drops onto. `hidden` removes the hairline and its advance in either orientation.

```json
{ "tagName": "jx-divider", "$props": { "orientation": "vertical" } }
```

`jx-kbd` is a key cap in running text. Its content is the key. It is an atomic inline box, so it sits on the text baseline and a line break falls between caps rather than through one.

```json
{ "tagName": "jx-kbd", "textContent": "Ctrl" }
```

`jx-dot` is a six-pixel status disc. `tone` is `danger`, `success` or `warning`; anything else, the empty default included, is the neutral disc. It recolours the disc and nothing else: the dot carries no name of its own, so a row that means something by it says so in its own text or names the dot where it is used.

```json
{ "tagName": "jx-dot", "$props": { "tone": "success" } }
```

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

`variant` is `accent`, `primary`, `secondary` (the default) or `negative`. `size` is `sm`, `md` or `lg`. `quiet` drops the fill and border until hovered. `disabled` disables the control. `loading` keeps the button's width, shows a spinner, says `aria-busy` and swallows the next activation. `type` is `button`, the default, `submit` or `reset`. When the visible text is not the name, or there is none, give it a `label`; `labelledby` and `describedby` forward to the control too. `autofocus` forwards as well, so a button inside a dialog can claim the focus its `showModal()` would otherwise give to whichever control comes first. The `icon` slot draws a glyph before the text. The parts are `control`, `icon`, `label` and `spinner`.

A click reaches you on the element, and a `loading` button stops it at the control inside, so your own listener never runs for an activation the button refused. That is why the swallow is on the inner control rather than the host: `stopPropagation` halts an event at the node it is called on and every node after it, never the other listeners on that same node.

`tabindex` is a property, not an attribute, on every kit control that wraps a native one: `jx-button`, `jx-action-button`, `jx-textfield`, `jx-checkbox`, `jx-switch`, `jx-swatch` and `jx-color-field`. Write `el.tabindex = "0"` and it reaches the control inside, which is the node that takes focus. Write it as an attribute and it lands on the host as well, and a host carrying `tabindex` is itself focusable, so one control becomes two tab stops. A container that roves a caret, such as `jx-toolbar`, writes the property.

`jx-action-button` is the icon-first tool button a toolbar is made of. `label` is required, because its name is not on screen. It is the accessible name only: set `hint` as well if you want a tooltip, which an icon-only button usually should. They were one prop, and a button whose text is already readable does not need its own label repeated on hover. `icon` names a glyph, `weight` is its weight, and `mirror` flips it so one shipped glyph serves both sides of a pair. `toggles` makes it a two-state button that carries `aria-pressed`, flips `selected` when activated and dispatches `change` with the new state. A host that owns the state sets `selected` itself, and the property wins.

```json
{ "tagName": "jx-action-button", "$props": { "label": "Bold", "icon": "text-b", "toggles": true } }
```

It is `quiet` by default. `emphasized` draws the selected state in the accent. `stacked` puts the icon above a visible label, the shape of a rail button. A button that opens a menu rather than running a command sets `haspopup` and `expanded`, which reach the control as `aria-haspopup` and `aria-expanded`. `badge` draws a count over the button's corner, and nothing when empty. `size`, `disabled`, `loading`, `label`, `labelledby`, `describedby` and the invoker attributes work as they do on `jx-button`; `loading` here puts the spinner where the glyph was, since an action button has no icon slot to put one in. `checked`, `"true"` or `"false"`, makes the button one segment of a radio group instead of a toggle, and the two are alternatives rather than companions: a button that is one of several choices is a radio, a button that is independently on or off is a toggle, and where both are set `checked` wins and the button neither says `aria-pressed` nor flips itself. The parts are `control`, `icon`, `icon-glyph`, `spinner`, `label`, `badge-slot` and `badge`.

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

The native `input` and `change` events bubble from the field as they always do. `invalid` marks a refused value and reaches the control as `aria-invalid`; `error` draws the sentence explaining it under the field and announces it as it changes; `help` draws a sentence of guidance. Each sentence carries an id the control names in `aria-describedby`, the error first, so a reader who tabs away and back hears why the value was refused rather than only catching the announcement once. `labelledby` and `describedby` forward to the control as well, and your own `describedby` is read after the field's own two sentences. `type` is any text-like input type, `size` is `sm`, `md` or `lg`, and `mono` draws the value in the monospace face for a path, a selector or a colour. `name`, `autocomplete`, `disabled`, `readonly` and `required` forward to the control. The control carries the field's value as its default value too, so resetting a form the field sits in leaves the control saying what the field says rather than emptying it: the value is the field's own state, and putting a different value back is a write of `value` from the host. To focus the field and select its value from a host, call `selectValue(host, "all" | "stem" | "none")` or `focusField(host)` from `@jxsuite/ui/behaviors/textfield`.

`clearable` adds a clear button inside the field, shown only while there is something to clear. Clicking it empties the value, puts focus back in the control and fires `input` and `change` from the field. Escape does the same from the keyboard. Both are keyed on `clearable` rather than on `type="search"`, because Firefox draws no clear button for a search field, and both go away on a `disabled` or `readonly` field so the reader is never handed a live control that empties a field they were refused permission to edit. On a single-line search field the element also cancels Enter, which would otherwise submit the form around it; on a textarea Enter still inserts a line.

`grows` hands a multiline field's height to the content in it. Give `rows` as well to set a floor. On a browser without `field-sizing`, the field falls back to the height its `rows` asks for, or to the same three-row box a fixed field gets, so turning growth on never makes a field shorter.

The parts are `input`, `clear` and `clear-icon`, `error` and `help`, and the boxes `control-slot`, `clear-slot` and `help-slot` around them.

## Checkboxes and switches

`jx-checkbox` and `jx-switch` each wrap one native checkbox inside the `<label>` that names it, so a click anywhere on the label toggles it and Space works with no code. Use a checkbox for "this item is included" and a switch for "this setting is on". The switch carries `role="switch"`, which is what makes a screen reader say on and off instead of checked and unchecked.

```json
{
  "tagName": "jx-checkbox",
  "$props": { "label": "Include drafts", "checked": { "$ref": "#/state/drafts" } }
}
```

Put the visible text inside the element instead of in `label` when it carries markup, and leave `label` unset: the slotted text names the box on its own, and setting both would name it twice.

`indeterminate` is the checkbox's third state, for a box that stands for a set where some members are on. It is the reason this is an element at all: HTML has no `indeterminate` attribute, so a mixed box cannot be expressed in markup. Clicking a mixed box clears it and turns the box on, the way the platform does.

`jx-switch` takes a `hint`, which becomes the title on the control. Both take `label`, `labelledby`, `describedby`, `name`, `disabled` and `size`. The native `change` and `input` bubble from the control, so `event.target.checked` reads as it would from a bare input. Both have the parts `control`, `input` and `label`, and on these two `control` is the `<label>` wrapping the input rather than the input itself.

:::doc-note
Resetting a form these controls sit in leaves them where the reader left them, rather than snapping back. They are not form-associated yet, so a reset never reaches them; the control's default is kept in step with its live value so the two can never say different things. Putting a value back is a write from the host.
:::

## Number fields

`jx-number-field` wraps a native number input, so the platform supplies the spinbutton role, the announced value, arrow-key stepping and the numeric keypad on a phone. `stepper` adds a pair of buttons. Holding Shift with an arrow key moves ten steps.

```json
{
  "tagName": "jx-number-field",
  "$props": { "label": "Opacity", "min": "0", "max": "1", "step": "0.1", "stepper": true }
}
```

`value`, `min`, `max` and `step` are strings, not numbers. That is deliberate: an empty string is a value a number cannot express, and a numeric prop would turn a cleared field into a zero. Read the number back with `event.target.valueAsNumber`, which is `NaN` when the field is empty. `label`, `labelledby`, `describedby`, `placeholder`, `name`, `disabled` and `size` work as they do on a text field. The two stepping buttons are named `Increase` and `Decrease`; `step-up-label` and `step-down-label` rename them for another language.

Stepping goes through the control's own `stepUp` and `stepDown`, so a value sits on the step grid measured from `min`. Adding the step yourself does not: with `min` 0 and `step` 0.3, stepping up from 0.5 gives 0.6, and 0.5 plus 0.3 gives 0.8.

The events are the platform's two names and nothing else. When the reader types, the native `input` and `change` bubble from the control untouched, so `event.target` is the live input with its `validity` and `form`; when the element writes the value itself, from a stepping button or a Shift-arrow, the same two names come from the element. The parts are `field`, `input`, `stepper`, `step-up`, `step-up-icon`, `step-down`, `step-down-icon` and the `stepper-slot` box around the buttons.

:::doc-warning
A number input throws away what it cannot parse, so a half-typed `1e` and a cleared field both read as an empty string. Before deleting a value because the field is empty, check `badInput` on the element, or its `data-bad-input` attribute. It is true while the reader is mid-way through typing something the control cannot represent yet.
:::

## Selects

`jx-select` is a native `<select>`, not a rebuilt dropdown, so typeahead, scrolling the list to the current row, form participation and the accessibility tree all come from the platform. What the element adds is drawing: a row can carry its own font face, a colour swatch or a sample of a border style, and rows can sit under headings you can see.

```json
{
  "tagName": "jx-select",
  "$props": {
    "label": "Font",
    "value": "Georgia, serif",
    "groups": [
      {
        "id": "project",
        "label": "This project",
        "rows": [{ "value": "Georgia, serif", "label": "Georgia", "face": "Georgia, serif" }]
      },
      {
        "id": "generic",
        "label": "Generic",
        "rows": [{ "value": "system-ui", "label": "system-ui", "description": "system" }]
      }
    ]
  }
}
```

A row is a `value` and a `label`, plus any of `description`, `disabled`, `face`, `swatch` and `line`. `face` sets that row's font, `swatch` fills a small block of colour beside it, and `line` draws a sample of a border style such as `dashed`. Give `options` instead of `groups` for a flat list, or give both: the ungrouped rows are drawn first.

`value` is a string, and the empty string is one of its values rather than the absence of one, so a blank row can mean "inherit". Set `value` to something no row holds and the element adds a row for it instead of quietly selecting the first one.

Read the answer from `change`, the way you would from any select. The event comes from the inner control, so `event.target.value` is the row the reader picked. `label`, `labelledby`, `describedby`, `name`, `disabled`, `required` and `size` forward to the control as they do on a text field, and `invalid`, `error` and `help` draw and announce the same way. Give a `name`: it is also what satisfies the one HTML validity rule a page carrying this element otherwise trips, that a form field should have an id or a name.

You can also write rows yourself, as children: native `option` and `optgroup` elements, and an `<hr>` between them for a separator. Children are placed once, when the element is set up, so use them for rows that never change and `options` or `groups` for rows that do.

The parts are `control`, the `<select>` itself; `trigger` and `preview`, the closed face; `option`, `swatch`, `line`, `text` and `description` on each row; `group` and `group-heading`; `unlisted`, the stand-in row; and `error`, `help` and `help-slot`.

:::doc-note
The drawing needs a browser with customizable select: Chrome or Edge 135 and later. In an older engine the control still works, still submits and still reads correctly, but the browser draws the list and the faces, swatches and group headings do not show.
:::

## Comboboxes and lists

`jx-combobox` is a text field you can also pick from. It is one native `<input>` carrying `role="combobox"` over a `jx-listbox` of rows, and it reaches that list only by id, through `aria-controls` and `aria-activedescendant`. Use it where a select would be wrong because the answer is not always on the list.

```json
{
  "tagName": "jx-combobox",
  "$props": {
    "label": "Model",
    "allowsCustomValue": true,
    "value": "claude-sonnet",
    "options": [
      { "value": "claude-sonnet", "description": "anthropic" },
      { "value": "gpt-4o", "description": "openai" }
    ]
  }
}
```

A row is a `value` plus any of `label`, `description`, `disabled`, `face`, `swatch` and `line`, the same drawing channels a `jx-select` row carries. `value` is the text in the field, so a row's label is normally the same string it commits: a picker whose rows carry a hidden key is a `jx-select`.

**The element does not filter.** `options` is the list it will draw, not a corpus it searches. You already know how to rank your own rows, so re-answer `options` when you hear the `input` event and the list redraws.

A list opened by a gesture, the chevron or `Alt` with the down arrow, lands on the row whose value the field already holds, so a catalogue that arrived after the reader typed an id shows it as their row rather than as a list with nothing chosen. A plain arrow still enters at an end.

**Typing highlights nothing.** After a keystroke nothing is selected, so Enter commits what the reader typed. Arrow onto a row first and Enter takes the row. That is what makes `allows-custom-value` mean something: with it set, anything the reader types stands, and the rows are suggestions. Without it the list is closed, and a value no row holds is put back to the last accepted one when the reader leaves the field. Either way the element says `change` exactly once per edit, and `event.target.value` is the value that stands.

The arrows open the list and move through it, wrapping and stepping over disabled rows. The chevron, and `Alt` with the down arrow, open the list on the row the field already holds, or on nothing when no row holds its value; `Alt` with the up arrow closes. Tab takes whatever row is highlighted on the way out, and closes the list either way. Escape closes the list and stops there, so a combobox inside a dialog does not close the dialog with it. Home and End stay with the text cursor, where the reader is typing.

**An empty list is not shown.** With no rows the chevron is not drawn and neither typing nor an arrow opens anything, so a field whose suggestions have not arrived yet is a text field until they do, and Escape reaches the dialog around it rather than a panel nobody could see. That is the shape of a catalogue you fetch: draw the field at once, hand it `options` when the listing lands, and whatever the reader typed while waiting stands. Studio's provider form is that field, with `allowsCustomValue` because a self-hosted model id is the normal case. Because the element's own `input` handler runs before yours, a host whose previous answer was empty sees the list on the keystroke after the one that produced rows; call `openList(host)` from `@jxsuite/ui/behaviors/combobox` once you have answered if you want it sooner.

`label`, `labelledby`, `describedby`, `placeholder`, `name`, `required`, `disabled` and `size` work as they do on a text field, and so do `invalid`, `error` and `help`. `readonly` can be focused and selected but never opens the list, because every row is an edit. `autocomplete` defaults to `off` rather than to nothing, since the browser's own dropdown over a list the element is already drawing is two panels answering one question. `open` reports whether the list is showing and is not a way to show it. The parts are `field`, `input`, `toggle` and `toggle-icon`, `popup`, `list`, `option`, `error`, `help` and `help-slot`.

### A list of your own

`jx-listbox` and `jx-option` are the same list on their own, for a panel you are building yourself: a command palette, a slash menu, a picker with a search field above it. The listbox never takes focus. Something else owns the keyboard, and you say which row is current by giving the listbox the `active` id:

```json
{
  "tagName": "jx-listbox",
  "attributes": { "id": "results" },
  "$props": { "label": "Results", "active": "results-o1" },
  "children": [
    {
      "tagName": "jx-option",
      "attributes": { "id": "results-o0" },
      "$props": { "value": "open", "label": "Open file", "description": "workspace" }
    },
    {
      "tagName": "jx-option",
      "attributes": { "id": "results-o1" },
      "$props": { "value": "save", "label": "Save" }
    }
  ]
}
```

That one id is the whole contract. Write it into the listbox's `active` and into your field's `aria-activedescendant`, and the listbox marks the row, clears the one before it, and scrolls the new one back into view. It keeps doing so when the rows themselves change, so a filter that rebuilds the list does not lose the highlight.

A row's words are its `label`, and `description` is a muted note at the end of it. `slot="icon"` takes a glyph and `slot="end"` takes one mark or chord. Each channel you leave out draws nothing. `jx-option` sends a bubbling `select` event whose detail is its `value`, so one listener on the panel hears every row. There is no default slot, on purpose: an option names itself from its contents, so a badge beside the words would join the row's name, and `label` is the only thing that does. The empty string is a legal `value`, a row meaning inherit or none, and never absence. A `disabled` row stays in the list and announced and dispatches nothing when clicked. `face`, `swatch` and `line` draw the row as its own preview, as on a `jx-select` row. A press on a row keeps the caret where it was, so a click never blurs the field that owns the keyboard. Its parts are `swatch`, `line`, `icon`, `label`, `description` and `end`; `jx-listbox` has none, because it is only the box the rows stand in.

Two parts are yours to write and the listbox draws them: a node carrying `part="group-heading"` above a run of rows, and a node carrying `part="empty"` for the sentence you show when nothing matched. What that sentence says is yours, because only you know what the reader was looking for.

:::doc-warning
A `jx-option` belongs in a `jx-listbox` and nowhere else. Put one inside a `<select>` or a `jx-select` and it renders, and the accessibility tree reads as though it worked, but the browser never counts it: it cannot be picked, the arrow keys skip it, and no `change` fires. The `custom-element-in-select` rule fails the document rather than letting it look right.
:::

## Field rows

`jx-field` is a label, a control and a help line as one thing. It positions them and it names the control for you:

```json
{
  "tagName": "jx-field",
  "$props": { "label": "Title", "description": "Shown in search results." },
  "children": [{ "tagName": "jx-textfield" }]
}
```

Nothing here writes an id, and nothing writes `labelledby`. The field mints one and hands it to whatever you put inside it, which is the reason it is an element rather than three things you assemble each time.

`required` draws a mark beside the label, drawn rather than added to the text so it stays out of the control's name. Marking the row does not make the control required: say so on the control as well, which is the element that validates. `invalid` turns the label and the help line red, and `warning` colours the label amber and leaves the sentence alone. Neither says anything to assistive technology; `aria-invalid` belongs on the control that holds the value. `span` gives the control the whole width instead of the two-column row, with the label above it.

`description` is the sentence under the row, and the `help` slot is the richer version of it: anything slotted into `help` replaces the description rather than stacking with it. The control is pointed at the sentence only when there is one at mount, so a sentence that starts empty and fills later should be slotted rather than passed as `description`. The parts are `label`, `control` and `help`.

The naming happens once, over whatever is slotted when the row mounts. A control appended to the row afterwards lands outside the control part, unplaced and unnamed, so keep the control in the document and switch its state rather than adding it later.

A control the kit does not ship cannot be named this way, because the field hands the label's id to a property and a plain `<input>` has none. Name it yourself in that case, with `aria-labelledby` pointing at the field's label.

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

`open` reports what the platform did, mirrored from the dialog's own `toggle`, and is not a way to open one. The parts are `dialog`, `header`, `headline`, `body` and `footer`; `confirm`, `secondary` and `cancel`, each with a `-label` part inside it and a `-slot` box around it; and `overlay-slot`, the box a popover opened from a control inside the dialog renders into, since a modal makes everything outside itself inert.

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
import { openAt } from "@jxsuite/ui/behaviors/popover";

openAt(document.getElementById("actions"), triggerButton);
```

Each row is a `jx-menu-item`, and it dispatches a bubbling `select` event whose `detail` is its `value`. Listen for it on the menu. A disabled row stays in the list and shows its `requires` text as a tooltip. Set `destructive` on a row that deletes, and `checked` to `"true"` or `"false"` on one that toggles. A row with `haspopup` takes a child menu in its `submenu` slot, which opens on hover, on ArrowRight and on the chevron; the row itself still runs its own command. A row's other slots are `icon` before the words, `description` for one secondary line and `value` for a chord at the end; its parts are `icon`, `text`, `label`, `description`, `value`, `chevron` and `chevron-icon`. The click stops at the row, because a row inside a submenu is a descendant of the row that owns it and would otherwise activate both.

Arrow keys, Home, End and typing a letter move between rows. Enter and Space activate. Escape closes one level, and a click outside closes the whole stack.

`x` and `y` place the panel in viewport pixels, and `floor` is the lowest edge it and its submenus may reach, `0` meaning the viewport: a menu opened from a rail that abuts a status bar sets it to the rail's bottom, so a tall submenu never runs down over the bar. A submenu that would leave the viewport on the right flips to its parent's left. `open` follows the platform and is not a way to show the menu. The menu has no parts: it is the panel, and its rows are its children.

Focus goes back to the button that opened the menu, but only if you say which button that was. The browser restores focus relative to a popover's invoker, and it learns the invoker from a `popovertarget` attribute or from the argument `openAt` passes for you. A bare `showPopover()` names none, so the reader who closes the menu starts again from the top of the page.

## Panels, tips and spinners

`jx-popover` is a panel in the top layer. Give it an id, put anything inside it, and open it with a button:

```json
{
  "tagName": "jx-popover",
  "attributes": { "id": "filters" },
  "$props": { "label": "Filters" },
  "children": [{ "tagName": "p", "textContent": "Anything at all." }]
}
```

```json
{
  "tagName": "button",
  "attributes": { "popovertarget": "filters" },
  "textContent": "Filters"
}
```

`popovertarget` is one of a small set of attributes HTML gives to `<button>` and `<input>` and to nothing else, so a checker refuses it on any other tag. A kit button forwards it to the button inside itself, and Studio knows that, but a checker reading your project alone only knows the components your project defines. Write it on a `<button>`, or pass it to a kit button through `$props` rather than `attributes`, and it is correct everywhere.

The platform does the work: Escape closes it, a click outside closes it, Tab walks it in document order, and focus goes back to the button that opened it. Set `label` on any panel that holds controls, because a panel with no name announces no boundary when a reader enters it.

To open one from code, call `openAt(panel, trigger)` from `@jxsuite/ui/behaviors/popover` rather than `showPopover()`. Passing the trigger is what tells the browser where to send focus when the panel closes; without it a reader lands back at the top of the page. `close(panel)` closes it. The `open` prop reports what the platform did and is not a way to open one: writing it shows nothing.

Place it with `x` and `y` in viewport coordinates, and `floor` for the lowest edge it may reach. There is no `anchor` prop. Anchor positioning needs the anchor element to declare `anchor-name`, and the kit will not write a style on an element it does not own, so a panel over your own button could never establish it. The gap between the panel and its trigger is the `--jx-popover-offset` token rather than a prop.

`match-width` makes the panel at least as wide as whatever opened it, the way a select's list matches its trigger, measured once per toggle from the trigger the platform or `openAt` names. `arrow` draws a pointer at the panel's top edge; it is off by default because a panel placed by measured coordinates cannot promise the arrow lands on its anchor. The parts are `content` and `arrow`, and `content` is the scroll box: the panel itself never scrolls, because a scroll container clips whatever hangs outside its padding box and the arrow hangs above it. While an open or close transition is still running the host carries `data-jx-settling`, so measure a panel after that attribute goes rather than on the toggle.

`jx-tooltip` is a tip for a control whose meaning is not written on it. It uses the `hint` mode, which is the only one that does not close an open menu, so a tip can explain a row of one:

```json
{
  "tagName": "jx-tooltip",
  "attributes": { "id": "tip-save" },
  "children": [{ "tagName": "span", "textContent": "Save this page" }]
}
```

Name it onto its control from the control's side, with `interestfor` where the browser supports it and `aria-describedby` either way. It is never focusable, it stays up while you hover it or hold focus, and Escape dismisses it. Those three together are what WCAG 1.4.13 asks of anything that appears on hover.

Both wirings work on every engine. Where the browser has no interest invokers the tip binds the pointer and focus of the control that declares `interestfor` at it itself, and `for`, the id of a control, is the other way round: the tip names its control. Either is read once, at mount; a tip wired up later is bound with `bindTooltip` from `@jxsuite/ui/behaviors/tooltip`. `delay` is how long the pointer must rest before the tip appears, in milliseconds, and keyboard focus never waits; on an engine with interest invokers the wait is the platform's own `interest-delay-start`, and this number is not consulted. The tip places itself under its control, or above it when there is no room below, and never over it; `x`, `y` and `flipped` are what it writes when it does, and what a host that places a tip itself sets instead. `arrow` draws a pointer on the edge facing the control, and `arrow` is its one part.

`jx-spinner` says work is happening. Leave `value` empty for the usual case, where nothing knows how far along it is; give it a percentage to draw a ring instead. It is a string, not a number, because an empty string is a value a number cannot express and a numeric prop would read "unset" as zero:

```json
{ "tagName": "jx-spinner", "$props": { "label": "Loading pages" } }
```

Give it a `label` when it stands alone, and leave the label off when it sits inside a button that is already named: without one the spinner hides itself from screen readers, so the button is not announced twice. A reader who asks for reduced motion gets a slower spin rather than a stopped one, because a stopped spinner reads as a hang.

It draws in the colour of the text around it, so a spinner inside a button is visible on every variant without being told. Override `--jx-spin-color` and `--jx-spin-track-color` on the element or an ancestor to change that. `size` is `sm`, `md` or `lg`, and `md` matches the kit's icon size so a spinner swapped in for a glyph does not move the row. The parts are `glyph` and `glyph-icon`.

## Toasts

A toast reports one outcome beside the reader's work: a glyph, a line of text, at most one control that undoes or retries it, and a dismiss button that is always there. `jx-toast` is the message and `jx-toast-host` is the stack it lives in.

```json
{
  "tagName": "jx-toast-host",
  "children": [
    {
      "tagName": "jx-toast",
      "$props": { "open": true, "variant": "negative", "timeout": 8000 },
      "children": [
        { "tagName": "span", "textContent": "Could not reach the deploy service." },
        {
          "tagName": "jx-button",
          "attributes": { "slot": "action" },
          "$props": { "size": "sm", "quiet": true },
          "children": [{ "tagName": "span", "textContent": "Retry" }]
        }
      ]
    }
  ]
}
```

`variant` is `info`, `positive`, `negative` or `warning`. It picks both the accent along the leading edge and the glyph, so the severity survives greyscale and a forced-colours theme. It is not announced, so write the message so that it says what happened on its own.

`open` is yours to write: a toast appended without it draws nothing, so arriving and appearing stay two decisions. `timeout` is milliseconds and `0` is sticky, which is the default. The element writes `open` back to false when it retires itself and dispatches `close`, whose `detail.reason` is `timeout`, `dismissed` or `action`. Closing a toast from your own code with `open = false` dispatches nothing, because you already know.

Anything in the `action` slot is the one thing a reader may do about the message. Using it closes the toast and reports `action`. The click is not stopped, so your own handler runs first and a listener above the toast hears it too. The dismiss button is always drawn and takes its name from `dismiss-label`.

**A toast never takes the keyboard, and its clock stops the moment you reach it.** While the pointer is over a toast, while focus is inside it, or while anything in the same stack is being read, no toast in that stack is counting down, and the clock then resumes with the time that was left rather than starting over. So a control the reader has reached cannot expire under their hand, and an older message cannot vanish out from under someone answering a newer one.

**Press `F8` to put the keyboard in the stack.** The stack sits at the end of the document, where Tab reaches it last, so the host offers a key instead. Focus goes to the first control in the first open toast, and Escape gives it back to wherever it came from. Dismissing the toast you are standing in gives it back the same way. Set `hotkey` to another key, or to the empty string if your application has a command of its own for this.

`jx-toast-host` is the live region: the toasts inside it carry no role of their own, so a message is announced once. `live` is `polite` by default, `assertive` for the rare message that cannot wait, and `off` for an application that already announces outcomes somewhere else. Role and attribute move together: `polite` writes `role="status"`, `assertive` writes `role="alert"`, and `off` writes neither. `label` names the region, and `placement` pins the stack to `bottom-end`, `bottom-start`, `top-end` or `top-start`. The order is the order you write, in every corner, so what a reader hears, what they tab through and what they see agree. Off a host, a toast is an ordinary box in the flow, drawn and not announced.

A toast's parts are `icon` and `glyph`, `message`, `dismiss`, and the `action-slot` box around the control. The host has none.

## Tabs

`jx-tabs` is a real tab strip: the platform's roles, the arrow keys, and one stop in the tab order for the whole strip.

```json
{
  "tagName": "jx-tabs",
  "$props": { "label": "Inspector", "selected": "style" },
  "children": [
    {
      "tagName": "jx-tab",
      "$props": { "value": "content", "label": "Content", "panel": "p-content" }
    },
    { "tagName": "jx-tab", "$props": { "value": "style", "label": "Style", "panel": "p-style" } }
  ]
}
```

Give it a `label`. A tab strip with no name is announced as a bare group, and nothing will tell you: the naming rules stand down for an element that carries its role from a binding, so no checker sees the omission.

Each `jx-tab` names its panel with `panel`, and each `jx-tab-panel` points back with `labelledby`. Nothing checks that pairing, so mint both ids from one key. A panel takes `active` to say it is the showing one; the others are hidden rather than removed, so the ids their tabs name stay resolvable. A showing panel takes one tab stop, the price of a panel whose whole content may be static text. Arrow keys move along the strip and wrap, Home and End jump to the ends, and Tab enters and leaves in one press. `activation` decides whether moving the caret selects as it goes, which is the usual behaviour, or waits for Enter or Space, which is right when selecting a tab is expensive. `orientation` is `horizontal` or `vertical`; it chooses which arrow pair moves the caret and which edge carries the strip's rule and the selected mark. The strip fires `change` with the new value, and `selected` is already written when it does. The strip is the one writer of every tab's `selected`, so move the selection by writing the strip's, never a tab's.

`closable` adds a close button and Delete closes the focused tab; both dispatch `close` with the tab's value. Enter and Space on the close button close it too, rather than selecting the tab it sits in. `dirty` draws the unsaved dot, which is hidden from assistive technology: a reader is told about unsaved work by the page. Write a tab's `label` as an attribute: a property write does not reflect, and a strip's selectors read the attribute.

A tab takes three named slots, so you can decorate one without rebuilding the strip. `icon` draws before the label; `status` and `actions` draw after it and before the tab's own dirty dot and close button.

```json
{
  "tagName": "jx-tab",
  "attributes": { "value": "post", "label": "hello.md", "closable": "" },
  "children": [
    { "tagName": "span", "attributes": { "slot": "status" }, "textContent": "Draft" },
    {
      "tagName": "jx-action-button",
      "attributes": { "slot": "actions" },
      "$props": { "icon": "eye", "size": "sm", "label": "Preview hello.md", "tabindex": "0" }
    }
  ]
}
```

Pick between the two by what a click should do. `status` is for a mark about the document, such as a pill, a count or a sync state, and a click on a mark selects the tab like a click anywhere else on it. `actions` is for a control, such as a pin or a lock, and a click inside it stops there, so pressing the control never also moves the selection. There is no default slot: a tab's words are its `label`.

Always give a tab a `label` once you slot anything into it. The label is the tab's accessible name, so nothing you slot in can join it and each control you add keeps announcing its own name. Leave the label off and the tab falls back to naming itself from its content, which means a tab holding only a pin button is announced as "Pin".

Two things stay yours. A control in `actions` should be in the tab order only while its tab is the current one, the way the close button is: bind its `tabindex` to the selection, which is what `jx-action-button` takes a `tabindex` property for. And a mark that says nothing useful to a screen reader is yours to hide with `aria-hidden`, because only you know whether it is decoration.

A tab's parts are `icon`, `label`, `status`, `actions`, `dirty` and `close` with `close-icon`, plus the `dirty-slot` and `close-slot` boxes. The strip and the panel have none.

## Sections

`jx-accordion-item` is a native `<details>` with a heading you can style:

```json
{
  "tagName": "jx-accordion-item",
  "$props": { "label": "Advanced", "open": true },
  "children": [{ "tagName": "p", "textContent": "Anything." }]
}
```

Give several of them the same `name` to make the group exclusive, so opening one closes the rest. That is the platform's own behaviour and needs no script.

`label` is required. It is written as the summary's accessible name rather than left to name-from-content, because the actions row sits inside the summary and would otherwise be read as part of the section's name. Two slots decorate the summary: `heading` for a mark beside the label, and `actions` for a control that stays visible while the section is shut. A click on a control in `actions` runs the control and does not toggle the section; a click on the row's own empty space toggles nothing either. An inert mark belongs in `heading`, because a non-interactive element slotted into `actions` still toggles the section. `level`, a number, opts the label into heading semantics so a long panel can be skimmed by heading navigation. The cost is that the label is announced twice when reading linearly, once as the heading and once as the disclosure, which is why it is opt-in.

`open` is two-way: the platform writes it when the reader opens the section and you may write it to open or close one. Written as a property it does not reflect onto the host's attribute, so read it as a property or from `toggle` rather than with `getAttribute`.

Put them in a `jx-accordion` to draw them as one stack, with a hairline between sections and none above the first visible one. Its `multiple` prop, `true` by default, is advisory: it writes down whether more than one section may stand open, and the platform's own switch for exclusivity is `name` on each section, which only the section may carry. Set `multiple` to `false` and make it true by giving every item the same `name`.

The element fires `toggle` when a section opens or closes, and that event stops at the element. A native `toggle` does not travel up the page, so a section inside a menu or a panel cannot close the thing around it by opening. The parts are `details`, `summary`, `marker` and `marker-icon`, `label`, `heading`, `actions` and `body`; the stack has none.

## Button groups

`jx-action-group` gives a row of `jx-action-button`s the right role and one tab stop:

```json
{
  "tagName": "jx-action-group",
  "$props": { "selects": "single", "label": "Text alignment", "compact": true },
  "children": [
    {
      "tagName": "jx-action-button",
      "$props": { "icon": "text-align-left", "label": "Left", "checked": "true" }
    },
    {
      "tagName": "jx-action-button",
      "$props": { "icon": "text-align-center", "label": "Centre", "checked": "false" }
    }
  ]
}
```

`selects` decides what the row is: `"none"` is a toolbar of separate actions, `"single"` is a set of choices where one wins, and `"multiple"` is a set of independent switches. Arrow keys move within the row and Tab leaves it, so a toolbar of ten buttons costs one tab stop rather than ten. `compact` joins the buttons into one segmented control, and it reaches only the buttons that are the group's own children, so a nested group keeps its own seam. `label` names the group, and a reader entering it hears the name; `orientation` is `horizontal` or `vertical`, and it picks the arrow pair and turns the row. The group has no parts.

The group chooses the pattern and the keyboard and does not own the selection. In `"single"` it clicks the button the caret lands on and lets you decide what that means, so the value stays in your state.

For a single-choice row, set `checked` to `"true"` or `"false"` on each button rather than `selected`, and do not set `toggles`. A button that both announces a chosen state and flips itself would fight the host that owns the value, so the element refuses the combination.

## Toolbars

`jx-toolbar` is a row of controls with one tab stop. Reach for it when the row holds more than buttons: a text field, a divider, a plain `jx-button`, a count at the far end.

```json
{
  "tagName": "jx-toolbar",
  "$props": { "label": "Grid actions" },
  "children": [
    { "tagName": "jx-button", "$props": { "label": "Save", "variant": "accent" } },
    { "tagName": "jx-action-button", "$props": { "icon": "arrows-clockwise", "label": "Refresh" } },
    { "tagName": "jx-divider", "$props": { "orientation": "vertical" } },
    { "tagName": "jx-textfield", "$props": { "type": "search", "label": "Filter rows" } }
  ]
}
```

`label` is what a screen reader announces when the reader enters the row, so give every toolbar one. `orientation` chooses which arrow pair moves between the controls, and turns the row through a quarter turn.

Arrow keys move along the row and wrap at both ends, :kbd[Home] and :kbd[End] reach the ends, and :kbd[Tab] leaves the whole toolbar. A row of any length costs one tab stop.

A text field in the row keeps the arrow keys while its caret still has text to move through. Press the same arrow again at the end of the text and the caret leaves the field for the next control, so you arrow in, type, and arrow out with one key. :kbd[Home] and :kbd[End] inside a text field always belong to the field.

A `jx-color-field` in the row is one stop, and the stop is its swatch. Arrow onto it and :kbd[Enter] opens the picker, which holds everything a colour needs. The text box, the eyedropper and the system colour well beside it leave the tab order while the field sits in a toolbar, so there they are reached with a pointer; in a form each has its own stop again.

Two kinds of control are not moved between by the toolbar's arrows, and each keeps a tab stop of its own instead. Anything that runs its own arrow keys is left alone, such as a `jx-action-group` or a `jx-tabs`: two roving carets over one row would disagree about which control is current. So is anything whose arrow keys are already spoken for, such as a `jx-select`, a range, a spin button or a `jx-combobox`, because walking the caret past one would rewrite what somebody had chosen or open a list they had not asked for.

There is no overflow menu, by decision. A row that will not fit is a row to shorten. Where a list of what is out of view is genuinely needed, the host measures it and opens a `jx-menu` of its own commands, which is what the editor's tab strips do.

Which of the two to use: `jx-action-group` for a row of `jx-action-button`s that share one look, and `jx-toolbar` for a row of mixed controls. A group may stand beside a toolbar, never inside one.

## Trees

`jx-tree` is a `role="tree"` over a FLAT list of `jx-tree-item` children. Each row carries its own `level`, `posinset` and `setsize` rather than sitting inside a nested structure, because a long tree draws a window onto its model and a windowed row has no ancestors in the page to count.

```json
{
  "tagName": "jx-tree",
  "$props": { "label": "Project files", "current": "src/index.json" },
  "children": [
    {
      "tagName": "jx-tree-item",
      "$props": {
        "value": "src",
        "label": "src",
        "level": 1,
        "posinset": 1,
        "setsize": 2,
        "expanded": "true"
      }
    },
    {
      "tagName": "jx-tree-item",
      "$props": {
        "value": "src/index.json",
        "label": "index.json",
        "level": 2,
        "posinset": 1,
        "setsize": 1
      }
    }
  ]
}
```

`current` is the caret: the one row that holds the tree's tab stop, so :kbd[Tab] enters and leaves the whole tree in one press. Write the tree's `current` to move it; never a row's own caret. `expanded` is `"true"` or `"false"` for a row with children and `""` for a leaf, which is how the keyboard tells "closed" from "cannot open". `posinset` and `setsize` describe the FULL set, not the drawn one, and zero writes neither, which asks a reader's software to count the page instead.

The arrows walk the rows and deliberately do not wrap, which is where a tree differs from a menu or a tab strip: losing your place in an outline is worse than one extra key. :kbd[Home] and :kbd[End] reach the ends, :kbd[ArrowRight] opens a closed row and steps into an open one, :kbd[ArrowLeft] closes an open one and otherwise steps out to its parent, :kbd[Enter] activates and a printable character moves to the next row starting with it. Every other key reaches you untouched, which is what keeps cut, paste, rename and delete reachable from a focused row.

The tree reports what the reader meant and never resolves it. `select` carries `{ value, mode, anchor }`, where `mode` is `replace`, `toggle` or `range`, and the selection set is yours to hold: a range names every row between two of them, and under windowing those are the rows the page does not have. `expand` carries `{ value, expanded }` and says the state a row should be PUT INTO, so the twisty and the arrow keys arrive by one route. `activate` is :kbd[Enter] or a double click.

`multiple` on the tree says more than one row may be selected, as `aria-multiselectable`, and it gates the modifiers: with it off every `select` is `replace` however many keys the reader holds, so a host that never asked for multi-select is never handed a `toggle`. `anchor` is the row a :kbd[Shift] range extends from; the tree writes it on every `replace` and `toggle`, and you may seed it to restore a session. Write `selected` on each row yourself, since a selection is a set and a windowed tree draws part of it. A row writes `aria-selected` only when it is selected, because a `false` on every row is what tells assistive technology a tree is multi-select, and that answer belongs on the tree.

A row is all a `jx-tree-item` is: it draws itself and knows nothing about its neighbours. `disabled` keeps the row drawn and counted, so its siblings do not renumber, but the caret steps over it and a click on it does nothing. `cut` draws a row already lifted to the clipboard, faded and invisible to assistive technology, because cut and paste is the keyboard alternative to dragging and the page announces the move. `grip` draws the drag handle, a plain hidden span rather than a control: it is the grab affordance for a pointer drag and never a second way to move the row. A row's three slots are the tab's: `icon` before the name, `status` for a mark, and `actions` for a control whose click stops there. Give every row a `label` once anything is slotted, for the reason a tab needs one. The tree's parts are `pad-top` and `pad-bottom`, the two spacers; a row's are `twisty` and `twisty-icon`, `icon`, `label`, `status`, `grip` with its `grip-slot` box, and `actions`. Each row also carries `data-value`, which is what a drag-and-drop library attaches to.

### A tree that draws a window

Set `padtop` and `padbottom` to the pixels of scroll you are reserving above and below the drawn rows, and the tree knows it is showing part of a model. Two things then change, and both become messages to you.

A caret move that runs off either end has no row to land on, so the tree raises `move` with `{ from, key }` and performs nothing. A letter raises `typeahead` with `{ from, char }` for every printable character, not only for the ones no drawn row answers: a search over a slice always finds something, and what it finds is whichever of the dozen painted rows happened to start with that letter. Answer both against your own model, then scroll, repaint, and write the tree's `current`.

:::doc-note
Answering means moving the caret, and it does not mean moving the keyboard. The tree keeps that half. It focuses the revealed row once the roving `tabindex` has reached it, which is a moment only the tree can see: the row you draw is in the page, answering to its `value`, before its own `tabindex` is written, and focusing it any earlier does nothing at all and says nothing about it.
:::

Write `current` for your own reasons and the caret moves alone, which is what a canvas selection or a jump from a search result should do. A reader who clicks or types somewhere else while you are scrolling keeps the keyboard too: the tree gives up the move rather than pulling focus back out of wherever they went.

With both pads at zero the drawn rows ARE the model. The ends of the slice are the ends of the tree, the arrows clamp there, letters are resolved in the tree itself, and neither event is raised.

## Splitters

`jx-split` is the divider between two panes, and it is a control rather than a drag handle: it takes a tab stop, announces where it sits, and moves with the arrow keys.

```json
{
  "tagName": "div",
  "style": {
    "display": "grid",
    "gridTemplateColumns": "minmax(0, ${state.share}fr) auto minmax(0, ${1 - state.share}fr)"
  },
  "children": [
    { "tagName": "div", "textContent": "Navigator" },
    {
      "tagName": "jx-split",
      "$props": {
        "label": "Navigator and editor",
        "value": { "$ref": "#/state/share" },
        "gap": 120
      },
      "oninput": { "$ref": "#/state/onShare" }
    },
    { "tagName": "div", "textContent": "Editor" }
  ]
}
```

`value` is the share of the box that goes to the side before the splitter, from 0 to 1, so it is a ratio and not a pixel count. That is what lets the same layout survive a window resize: the two sides keep their proportions instead of one of them keeping a width. Listen for `input` while the reader is moving it and for `change` when they let go, and save on the second one.

`gap` is the one number you give in pixels: the smallest either side may become. The element measures the box it divides at the start of every gesture and converts the gap against that measurement, so nothing on your side has to watch for a resize. `min` and `max` are ratios, and both are honoured: the tighter of the two wins at each end.

Arrow keys move the splitter one `step` at a time along its own axis, :kbd[Shift] with an arrow takes a `largeStep`, and :kbd[Home] and :kbd[End] go as far as the gap allows. :kbd[Enter] collapses the split and a second press restores it to where it was. A double click does the same thing with the pointer, which is what gives a reader who cannot drag a way to reach both positions. `collapse` is the value both go to; its default sits below every legal share and clamps to `min`, so collapsing means going to the floor unless you say otherwise. A keystroke is a move and a commit, so `input` and `change` both fire for it.

Every `input` and `change` carries the modifier keys that step was made with as its `detail`: `{ altKey, ctrlKey, metaKey, shiftKey }`. The element gives none of them a meaning beyond :kbd[Shift]'s larger step; a host that snaps the value onto positions of its own reads them with `splitModifiersOf(event)` from `@jxsuite/ui/behaviors/split` and decides which key is the way past the snap. A plain `input` you dispatch yourself reads as no modifiers.

`orientation` names the splitter rather than the direction it travels, which is what ARIA means by it: the default `vertical` is the upright line between two side by side panes, dragged left and right, and `horizontal` is the flat line between two stacked boxes, dragged up and down.

`label` is its accessible name, and every splitter needs one: a separator is named by nothing else, no checker asks, and a reader arriving on an unnamed one is told they have landed on a separator and nothing more. Name it after the two things it divides. `disabled` keeps the box and the announcement and drops the tab stop, because a layout a reader cannot explain is worse than one they cannot change. While a drag is live the host carries `data-dragging`, so the splitter stays lit for a pointer that has left it. It has no parts: the element is the whole handle.

## Colours

`jx-color-field` is the whole control: a swatch that opens a picker, a text box for the value, and the doors to the system's own picker.

```json
{
  "tagName": "jx-color-field",
  "$props": { "label": "Background", "value": "#3b82f6", "alpha": true }
}
```

`label` says what the colour is for. Every control inside takes its name from it, so the text box is "Background", the swatch button is "Pick Background", and the screen picker is "Pick Background from the screen".

The element writes hex by default. Set `format` to `"oklch"` and it writes `oklch()` instead. That decides what it writes, never what it reads: a reader may type hex, `rgb()` or `oklch()` into the text box either way, and a half-typed value is only refused once they commit it.

A value the field cannot take apart is kept rather than refused. Hand it `var(--brand-accent)` or a named colour and it holds the string, shows it in the text box, and still draws it in the swatch, because the browser resolves it. Only the picker's sliders are stale, and the first thing the reader moves replaces the token with a literal.

`alpha` adds the opacity track to the picker and the alpha channel to the value. Leave it off and every value the field writes is opaque, so a field feeding a property with no alpha cannot be handed one by accident.

`system` and `eyedropper` control the two doors. `system` is a native `<input type="color">`, which opens whatever picker the operating system has. `eyedropper` is the screen picker, and its button appears only on engines that have the API, so you never get a control that does nothing when you press it. Turn both off where the colours must come from the project's own palette.

`labelledby` names the text field from a visible label you own; the other controls keep their composed names, because a label naming the row does not name the button inside it. `size` and `disabled` forward to every control inside. The empty string means no colour has been chosen and draws the slashed chip rather than black. The parts are `row`; `control`, the swatch button, with `preview` inside it; `text`, the field; `dropper` and `system` with their `-slot` boxes; `picker`, the `jx-popover` itself; and inside it `panel`, `area`, `hue`, `opacity` with `opacity-slot`, and `tokens`. The swatch button is `control` because it is the one stop a roving container focuses: it is the opener, so Enter on it reaches the whole picker, and it is the control the element always draws. `tabindex` is a property on this element as on the buttons, and while it is set the text field and the two doors step out of the tab order, so a toolbar that was told this element is one stop finds exactly one.

Listen for `input` and `change` on the element. They come from the element itself whichever of the five controls the reader touched, so `e.target.value` is always the colour:

```json
{
  "tagName": "jx-color-field",
  "$props": { "label": "Accent", "value": { "$ref": "#/state/accent" } },
  "onchange": {
    "$prototype": "Function",
    "body": [
      {
        "operator": "=",
        "target": { "$ref": "#/state/accent" },
        "value": { "$ref": "event#/target/value" }
      }
    ]
  }
}
```

### A palette in the picker

Anything slotted into `tokens` is drawn under the sliders, and choosing from it sets the field's value:

```json
{
  "tagName": "jx-swatch-group",
  "attributes": { "slot": "tokens" },
  "$props": { "label": "Project palette", "columns": 5, "value": "#0ea5e9" },
  "children": [
    { "tagName": "jx-swatch", "$props": { "color": "#0ea5e9", "label": "Sky" } },
    { "tagName": "jx-swatch", "$props": { "color": "#22c55e", "label": "Green" } }
  ]
}
```

### Swatches on their own

`jx-swatch` is a colour chip that is a real button. Give every one a `label`: that is its accessible name, and without it a reader hears the hex code one character at a time. Set `value` when the swatch stands for a token rather than for the literal colour, and the `select` event carries that instead.

`color` is any CSS colour the page can resolve, and the empty string is the no-colour chip, a slashed square, because a blank square in a palette reads as white. `checked` and `selected` are different things: `checked`, `"true"` or `"false"`, makes the swatch one radio of a group and is what a reader is told, and `jx-swatch-group` is its single writer; `selected` draws the chosen ring and the tick without announcing anything, for a swatch a host has chosen outside a group. Setting one never sets the other. `size` is `sm`, `md` or `lg`, and the chip grows while the button's target never shrinks below the kit's control height. `disabled` cannot be chosen or focused. Slotted text sits beside the chip as a caption, and the label still names the swatch, so the two must agree. The parts are `control`, `chip`, `mark` with its `mark-slot` box, and `label`.

`jx-swatch-group` makes a set of them a radio group with one tab stop. Either arrow pair moves between swatches and chooses the one it lands on, Home and End go to the ends, and disabled swatches are stepped over. The group owns the selection: write its `value` and it moves the swatches, and listen for `change` on the group rather than for `select` on a swatch. `label` names the group, and every group needs one, since a radio group takes no name from its members: "Theme palette" and "Recent colours" are two different questions and a reader hears only this.

`columns` lays the swatches out on a fixed grid. Leave it at 0 and they wrap on their own. The group has no parts.

### The picker's own parts

`jx-color-area` is the saturation and brightness square, and `jx-color-slider` is a hue or alpha track. Use them directly when you are building a picker of your own rather than using `jx-color-field`.

```json
{
  "tagName": "jx-color-area",
  "$props": { "label": "Accent colour", "hue": 265, "saturation": 72, "brightness": 88 }
}
```

The square holds two hidden range inputs, one for each axis, so it is fully operable from the keyboard. Left and right move the saturation, up and down move the brightness, Home and End go to the ends of the axis you are on, and holding :kbd[Shift] moves ten steps at a time. Every colour the pointer can reach is reachable this way, and a single click sets the colour outright, so nothing here needs a drag.

The square never writes the hue. Give it one from a `jx-color-slider` beside it, and dragging into the grey corner leaves the hue where the reader put it.

`label` names the square, and it is required: the square is a group holding two sliders, a group is named by nothing it contains, and no checker asks. `x-label` and `y-label` name the two axes, `Saturation` and `Brightness` unless another language needs other words. `brightness` is measured upward from the bottom edge, so 100 is the top. `step` is the grid both axes move on, for the arrow keys and for the snap a pointer drag is put through, so the thumb and the announced value cannot disagree mid-drag. `disabled` forwards to both ranges. The parts are `track`, `x` and `y`, the two ranges, and `thumb`.

```json
{
  "tagName": "jx-color-slider",
  "$props": { "label": "Hue", "channel": "hue", "value": { "$ref": "#/state/hue" } }
}
```

`channel` is `"hue"` or `"alpha"`. It chooses the gradient, the units the value is announced in, and the top of the range, so a hue track runs to 360 and an alpha track to 100 without your writing `max`. An alpha track fades from whatever you pass as `color`, and from `currentColor` when you pass nothing. `min` and `max` cut the track down to a band, and `max` at `0` means unset rather than a top of zero, since a track that ends at zero has nowhere to move. `step` is the grid the value moves on, for the platform's own arrows and for the ten-step :kbd[Shift] arrow the element adds; a plain arrow, Home, End and the Page keys are the platform's. `label` or `labelledby` is required, because a slider takes no name from its contents. `disabled` forwards to the range. The parts are `track` and `input`.

Both elements say `input` and `change` from themselves rather than from the range inside, so read `e.target.saturation` and `e.target.brightness` from a square and `e.target.value` from a track.

:::doc-note
Colour maths lives in `@jxsuite/ui/color`: hex, `rgb()` and `oklch()` parsing, sRGB to OKLCH and back, WCAG relative luminance and contrast ratio, and `preferredInk`, which answers with the black or white that can actually be seen on a colour. The kit uses that last one for a swatch's own boundary and tick, and you can use it for anything you draw on a colour a user chose.
:::

## Open the kit in Studio

The kit is a Jx project. Open `packages/ui/project.json` in Studio to see every element on the canvas, with one stylebook page per element showing its variants and states.

## Related

- [Embedding the runtime in your app](/docs/extending/embedding/runtime-host) for how a host mounts documents and passes state in.
- [Lists and iteration](/docs/framework/concepts/lists) for the keyed rows a surface is built from.
