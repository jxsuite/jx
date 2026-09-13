---
title: "Popovers and overlays"
description: "Build a mobile menu, a dropdown or a search palette with the HTML Popover API, and the one rule that decides whether it works."
spec:
  - spec.md#8.3
  - spec.md#8.7
  - spec.md#9.2
code:
  - packages/schema/src/overlays.ts
  - packages/schema/src/dialogs.ts
  - packages/runtime/src/runtime.ts
  - packages/runtime/src/css.ts
---

# Popovers and overlays

A mobile menu, a dropdown, a search palette: all three are one element that is hidden until something opens it, and the browser has a mechanism for exactly that. Jx uses it directly. There is no overlay component, no state entry and no JavaScript. A `popover` attribute on the panel, a `popovertarget` on the button, and the platform does the rest, including closing on Escape and on a click outside.

## The pattern

```json
{
  "tagName": "header",
  "children": [
    {
      "tagName": "button",
      "attributes": {
        "type": "button",
        "popovertarget": "site-menu",
        "aria-label": "Open menu"
      },
      "style": { "display": "none", "@--md": { "display": "flex" } },
      "textContent": "Menu"
    },
    {
      "tagName": "nav",
      "id": "site-menu",
      "attributes": { "popover": "auto", "aria-label": "Site menu" },
      "style": {
        "inset-block": "0",
        "inset-inline-start": "auto",
        "inset-inline-end": "0",
        "width": "min(320px, 85vw)",
        "height": "100dvh",
        "margin": "0",
        "border": "none",
        "padding": "4.5rem 0 2rem",
        "overflow-y": "auto",
        "overscroll-behavior": "contain",
        "flex-direction": "column",
        "translate": "calc(100% * var(--drawer-dir, 1))",
        "transition": "translate 0.3s, display 0.3s allow-discrete, overlay 0.3s allow-discrete",
        ":dir(rtl)": { "--drawer-dir": "-1" },
        ":popover-open": { "display": "flex", "translate": "0" },
        "::backdrop": { "background-color": "rgb(0 0 0 / 0.5)", "opacity": "0" },
        ":popover-open::backdrop": { "opacity": "1" },
        "@starting-style": {
          ":popover-open": { "translate": "calc(100% * var(--drawer-dir, 1))" }
        },
        "@(prefers-reduced-motion: reduce)": {
          "transition": "none",
          "translate": "0",
          ":popover-open": { "translate": "0" }
        }
      },
      "children": [
        {
          "tagName": "button",
          "attributes": {
            "type": "button",
            "popovertarget": "site-menu",
            "popovertargetaction": "hide",
            "autofocus": true,
            "aria-label": "Close menu"
          },
          "textContent": "Close"
        },
        { "tagName": "a", "attributes": { "href": "/about" }, "textContent": "About" }
      ]
    }
  ]
}
```

## The one rule that decides whether it works

**A popover's base style declares no `display`.**

The browser hides a closed popover with a rule of its own:

```css
[popover]:not(:popover-open) {
  display: none;
}
```

That rule lives in the browser's stylesheet, and **anything you write beats it**, at any specificity, from anywhere. So a `display: flex` in the panel's own `style` object does not "set the layout for when it opens". It cancels the hiding, permanently. The panel is then laid out on every page whether or not anyone opened it, usually shoved off the side of the viewport by the `translate` that was meant to animate it in.

Nothing looks wrong until you scroll sideways, or read the page with a screen reader, or wonder why the header is suddenly enormous.

Put `display` inside `:popover-open`, where it belongs:

```json
{
  "style": {
    "flex-direction": "column",
    ":popover-open": { "display": "flex" }
  }
}
```

:::doc-note
Studio checks this for you. A popover whose base rule sets `display` raises a **Problem** naming the panel, with a fix that moves the declaration into `:popover-open`.
:::

## Opening and closing

`popovertarget` names the panel's `id`. `popovertargetaction` chooses what the click does: `toggle` (the default), `show` or `hide`.

**Only `<button>` and `<input>` can be invokers.** This is not a Jx limitation; it is where HTML puts the attributes. On an `<a>`, or a `<div>`, or anything else, `popovertarget` parses and does nothing at all.

That is easy to miss because it usually looks like it works: a link inside an open panel dismisses it by navigating away, so the attribute appears to have done the job the navigation did. Two links prove it did not:

- a link with `target="_blank"` opens a new tab and leaves the panel open on the page behind it;
- a link to a `#fragment` on the same page scrolls the page behind the open panel.

So a panel's links carry no popover attributes. Its close button does. If you need a link that closes the panel without navigating, make it a `<button>`.

An `auto` popover also closes on **Escape** and on a **click outside**, and only one `auto` popover can be open at a time. `manual` gives all three of those up, so use it only when you want a panel that closes on nothing but your own button.

## Animating it

Two entries in the transition list are easy to leave out and both matter:

- **`display 0.3s allow-discrete`** keeps the box alive while it animates out. Without it the panel vanishes the instant it closes and the exit animation never runs.
- **`overlay 0.3s allow-discrete`** keeps it in the top layer for those same milliseconds. Without it the panel drops behind the page content and the backdrop disappears a frame early, so the exit reads as a flicker rather than a slide.

`@starting-style` gives the panel the state to animate _from_ when it enters. It is a plain at-rule key in the style object, exactly like a breakpoint.

## Positioning

The panel is `position: fixed` and positioned against the viewport, whatever it sits inside. Wrapping it in a `position: relative` container does not change that. An open popover is in the browser's **top layer**, and the top layer's containing block is the viewport.

Use logical insets (`inset-block`, `inset-inline-start`, `inset-inline-end`) rather than `top`/`left`/`right`. A drawer pinned with `inset: 0 0 0 auto` opens off the right edge in every language, including the ones that read right to left, where it should come from the left.

For a dropdown that follows a button, use **anchor positioning**: `anchor-name` on the button, `position-anchor` on the panel, and `position-area` to say where it goes.

```json
{
  "style": {
    "position-anchor": "--menu-button",
    "position-area": "block-end span-inline-end",
    "position-try-fallbacks": "block-start span-inline-end",
    "@supports not (position-area: block-end)": {
      "inset-block-start": "var(--header-height, 5rem)",
      "inset-inline-end": "0"
    }
  }
}
```

:::doc-warning
Always give an anchored panel a fallback. If `anchor()` does not resolve, every inset it feeds computes to `auto`, and a fixed box with four `auto` insets falls back to its **static position**, which for a panel declared inside a header is in the middle of the header. `position-area` degrades to nothing rather than to `auto`, and the `@supports` block covers engines that have neither.
:::

## Writing the attribute

`popover` takes `auto`, `manual` or `hint`. Write the keyword:

```json
{ "attributes": { "popover": "auto" } }
```

An empty string means the same thing to the browser, but Studio's Content tab shows an empty value as _unset_, so `"auto"` is the spelling that reads correctly everywhere. Do not write it as `true`: a boolean is not one of the three keywords, and a value the browser does not recognise falls back to `manual`, which silently gives up Escape and click-outside.

## Dialogs

A modal conversation, one that must be answered before anything else, is a `<dialog>` rather than a popover. Open it with `showModal()`, or declaratively with an invoker command, and the browser makes everything outside it inert, traps focus inside, and closes it on Escape.

```json
{
  "tagName": "dialog",
  "id": "confirm-delete",
  "attributes": { "aria-labelledby": "confirm-title", "closedby": "closerequest" },
  "style": { "&[open]": { "display": "grid", "gap": "1rem" } },
  "children": [
    { "tagName": "h2", "id": "confirm-title", "textContent": "Delete this page?" },
    {
      "tagName": "button",
      "attributes": { "command": "close", "commandfor": "confirm-delete" },
      "textContent": "Cancel"
    }
  ]
}
```

`closedby` decides what closes it: `any` (Escape and a click outside), `closerequest` (Escape only, the default for a modal) or `none`. A modal with `closedby="none"` needs a close button inside it, or nobody can leave.

The `display` rule is the same rule as for popovers, for the same reason: a closed dialog is hidden by the browser's own `dialog:not([open]) { display: none }`, which any author `display` beats. So `display` goes in `&[open]`, never in the base rule.

## Invoker commands

A `<button>` can open and close either kind of overlay with no script at all. `commandfor` names the target's `id`, and `command` says what to do:

| Command                                          | Acts on                              |
| ------------------------------------------------ | ------------------------------------ |
| `toggle-popover`, `show-popover`, `hide-popover` | a popover                            |
| `show-modal`, `close`, `request-close`           | a dialog                             |
| `--anything` (a custom command)                  | whatever handles it with `oncommand` |

```json
{
  "tagName": "button",
  "attributes": { "command": "show-modal", "commandfor": "confirm-delete" },
  "textContent": "Delete…"
}
```

Three things to know. Only a `<button>` carries these attributes: not an `<input>`, which `popovertarget` allows, and not a link. A command aimed at the wrong kind of target is ignored, so `show-modal` at a popover does nothing. And a custom command is a `CommandEvent` the target has to answer: give the target an `oncommand` handler that switches on `event#/command`.

Studio reports every one of these mistakes in Problems, beside the popover ones, and `jx validate` names them too.

## Custom elements that are overlays

A component can be a popover, and a component can be the button that opens one. Both work, and both need the tools to know it.

A component is a popover when its own definition carries `popover`, the way `jx-menu` does. Where you use it you write only the id:

```json
{ "tagName": "jx-menu", "attributes": { "id": "actions" } }
```

The `popover` attribute is nowhere in your page, so a checker reading your page alone sees an ordinary unknown tag. Studio and `jx validate` are told which of the components in scope are popovers, so a command aimed at one resolves, Problems stays quiet, and selecting it on the canvas opens it. A component of your own gets the same treatment once the project registers it.

A component is an invoker when it forwards `popovertarget` or `command` and `commandfor` to a native button inside itself, which is what `jx-button` does. Write the attributes on the component and they reach the button that acts on them:

```json
{
  "tagName": "jx-button",
  "attributes": { "command": "show-modal", "commandfor": "confirm-delete" },
  "children": [{ "tagName": "span", "textContent": "Delete…" }]
}
```

A component that forwards nothing is still refused, and so are a `<div>` and a link, because on those the attributes parse and do nothing.

## In Studio

Selecting a popover opens it on the canvas and grows the artboard to fit, whether you select the panel itself or anything inside it, from the canvas or the [Outline](/docs/studio/design/layers). Clicking its trigger opens it too. A dialog behaves the same way, shown in place rather than modally, and a `command` button that targets either one works on the canvas without locking the page. See **[The canvas](/docs/studio/interface/canvas)** for what the editor does and does not simulate.

## Next

- Style the open state and the backdrop in **[Hover states and selectors](/docs/studio/design/states-and-selectors)**.
- Show the trigger only on small screens with **[Breakpoints](/docs/studio/design/breakpoints)**.
- The nested-selector and at-rule syntax used throughout is **[Styling](/docs/framework/concepts/styling)**.
