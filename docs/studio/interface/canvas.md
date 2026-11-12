---
title: "The canvas"
description: "Working on the Jx Studio canvas: pan, zoom, selection, the block action bar, inserting, drag and drop, and the context menu."
spec:
  - studio.md#4.1
  - studio.md#4.3
  - studio.md#16.2
  - studio.md#4.4
  - studio.md#6.7
  - studio-ui-guidelines.md#8.1
code:
  - packages/site/src/site-style.ts
  - packages/studio/src/panels/zoom-control.ts
  - packages/studio/src/surfaces/statusbar.ts
  - packages/studio/src/canvas/edit-width-drag.ts
  - packages/studio/src/surfaces/canvas-stage.ts
  - packages/studio/src/editor/shortcuts.ts
  - packages/studio/src/panels/block-action-bar.ts
  - packages/studio/src/surfaces/block-action-bar.ts
  - packages/studio/src/editor/context-menu.ts
  - packages/studio/src/surfaces/menu.ts
  - packages/studio/src/editor/insert-zone-action.ts
  - packages/studio/src/panels/canvas-dnd-bridge.ts
  - packages/studio/src/canvas/iframe-interaction.ts
  - packages/studio/src/tabs/selection.ts
  - packages/studio/src/canvas/canvas-page-context.ts
  - packages/studio/src/canvas/repeater-sources.ts
  - packages/studio/src/canvas/npm-modules.ts
  - packages/studio/src/utils/edit-display.ts
---

# The canvas

The canvas is the center of the workspace, where your page renders live. It is the real thing, not a mock-up, and you work on it directly: click to put the cursor in the text and select the block, drag the block bar's handle to rearrange. How it behaves depends on the current [mode](/docs/studio/interface/modes); this page covers the interactions shared by the visual modes.

![Jx Studio design canvas showing one component across four responsive breakpoints with a style inspector](../../images/mode-design.png)

## Resizing the page

In **Edit** the canvas is a single centered column with a handle on each side. Dragging either one resizes the page symmetrically, and the [breakpoint](/docs/studio/design/breakpoints) follows the width. Each handle is a control rather than only a grip: Tab reaches it, the arrow keys resize the page a step at a time, and :kbd[Enter] returns it to the breakpoint's own width. Design has no handles, because it already draws every breakpoint side by side.

## Pan and zoom

In **Design** and **Project Styles** the canvas is an open surface you move around:

- **Pan** with the mouse wheel or trackpad. Hold :kbd[Shift] while scrolling to pan sideways, or drag with the middle mouse button.
- **Zoom** by holding :kbd[⌘] (macOS) or :kbd[Ctrl] (Windows/Linux) and scrolling; the canvas zooms toward your cursor, so whatever is under the pointer stays under it. :kbd[⌘=] / :kbd[Ctrl+=] zooms in, :kbd[⌘-] / :kbd[Ctrl+-] zooms out, and the **100%** button resets. The chords and the status bar's buttons zoom around the middle of the view. (:kbd[⌘0] / :kbd[Ctrl+0] is not a zoom reset: it moves the keyboard to the first pane.)
- The **zoom controls sit at the right end of the status bar**, on the focused pane. From left to right: a **fit** picker offering **Fit page**, **Fit width**, **Actual size** and **No fit**, remembered per document; **−** and **+**; a **slider**; and the current percentage, which is also the **100%** button. Drag the slider to zoom smoothly, or press :kbd[←] and :kbd[→] on it to step; :kbd[Shift] with an arrow moves ten steps. **Double-click the slider to reset to 100%.** The slider is logarithmic, because zooming is multiplicative: it runs from 5% to 500%, with 100% about two thirds of the way along. **Fit page** here may scale a small page up to fill the view, where the automatic fit on opening never goes past 100%.

The controls follow whichever pane you last clicked into, so with two panes open the readout re-points when you click the other one. They are not announced by screen readers on every change, and they are absent where there is nothing to zoom (see below).

**Design opens already fitted.** Switching into Design or Project Styles scales the canvas down so the whole thing is in view, so a wide layout never lands cut off at the edge of the panel. It never scales _up_ past 100%, and it never overrides you: once you have set a zoom yourself (with the controls, :kbd[Ctrl]-scroll or the chords), that file keeps your zoom for the rest of the session.

In **Edit** mode the page scrolls like a normal browser page instead of panning, and :kbd[Ctrl]-scrolling zooms the content itself, so the text reflows at the new size, like browser page zoom. The element under your cursor stays under it while the page reflows around it. The status bar's zoom controls work in Edit too, driving the content zoom (25% to 300%), with the slider and buttons but no fit picker, because there is no artboard to fit. In **Preview** the page scrolls too, and there is nothing to pan or zoom. See **[Modes](/docs/studio/interface/modes)**. The same goes for every editor that isn't a canvas: **Code**, the **Grid**, the **Content home**, an **entry form** and **[Project Settings](/docs/studio/projects/settings)** all scroll under the wheel exactly like an ordinary page, including the boxes inside them, the Source view of the project file for one. What none of them does is zoom: :kbd[Ctrl]-scroll and a trackpad pinch do nothing there, the same as anywhere else in Studio outside the canvas, so a stray pinch never rescales the whole window.

## Selecting elements

Click any element to select it. Studio outlines it, the Inspector inspects it, and the status bar shows its position in the page structure, a clickable trail of its ancestors.

That includes the parts of the page that come from its **[layout](/docs/studio/projects/pages-layouts-components)**. The header and footer render dimmed, under a `LAYOUT · layouts/base.json` chip, and clicking one selects it and offers **Open Layout →** in the Inspector. They can't be typed into from here, because they belong to every page that uses that layout; see **[Layout elements](/docs/studio/design/properties#layout-elements)**.

A content entry is drawn the same way: open a post and it is written inside its collection's page and that page's template, with the template's header and footer locked around it. The page's own design is locked too but drawn at full strength, and its title and other one-field text can be typed where it stands. A slim banner above the canvas says so, with a button that opens the page in Design; see **[Write an entry](/docs/studio/projects/browse#write-an-entry)**.

:kbd[⌘]-click (macOS) / :kbd[Ctrl]-click (Windows/Linux) adds an element to the selection or takes it out again. Every selected element keeps a box on the canvas, while the block action bar, the Inspector's single-element controls and the status trail address the one you clicked most recently; the status bar says **N selected** in front of the trail so the trail is never mistaken for the whole set. Ranges are drawn in the **[Outline](/docs/studio/design/layers#select-several-at-once)**, where a :kbd[Shift]-click covers everything between two rows. The canvas has no rubber-band selection.

You can also move the selection from the keyboard: :kbd[↑] and :kbd[↓] step between siblings, :kbd[→] steps into the first child, and :kbd[←] or :kbd[Esc] steps out to the parent. Pressed on the outermost element, :kbd[Esc] clears the selection instead. With nothing selected at all, :kbd[↑] or :kbd[↓] selects the outermost element, so the first key press always lands somewhere. The full list is in the **[shortcut reference](/docs/studio/interface/shortcuts)**.

## Popovers

A [popover](/docs/framework/concepts/overlays) is hidden until something opens it: a mobile menu, a dropdown, a search palette. On the canvas that stays true, so a closed one is invisible, exactly as on the page.

**Selecting it opens it.** Click the panel in the Outline, jump to a Problem inside it, or click its trigger button on the canvas, and the panel opens and the artboard grows to make room. Its contents are then ordinary elements: click a link inside it and edit the text, drag a block into it, style it in the Inspector.

It opens **in place** rather than floating over the page, marked with a dashed outline and a **POPOVER · SHOWN IN PLACE** label. That is a deliberate trade. On a real page a popover floats above everything in the browser's top layer, and that layer is one the editor cannot measure, cannot grow the canvas for, and cannot reliably put a selection box around. Shown in place, every editing tool works on it normally.

Two things are therefore **Preview only**: the backdrop behind the panel, and the way it stacks above the rest of the page. Switch to Preview to see the popover exactly as a visitor will, animation and all.

Selecting something outside the popover does not close it. Otherwise reaching for a color in the Inspector would shut the panel you were styling. Close it from the block action bar, or by clicking its trigger again.

A `<dialog>` works the same way. Select it, or anything inside it, and it opens in place with a **DIALOG · SHOWN IN PLACE** mark; a `command="show-modal"` button opens it too, and a `close` button closes it. On the canvas nothing goes modal and nothing goes inert, so the rest of the page stays editable while the dialog is up. Preview shows the dialog as a visitor sees it: modal, over a backdrop, with the page behind it locked. A region you marked `inert` is editable on the canvas for the same reason, and inert again in Preview and on the built page. A style rule you wrote for `[inert]` still applies while you edit, so the region looks the way it will on the page.

:::doc-note
A popover that lives inside a component stays closed while you are on a page that uses the component. Open the component's own file to edit it, the same rule that makes layout chrome read-only on a page.
:::

## The block action bar

A small floating toolbar appears above the selected element. It stays on the element's top edge while you type, rather than following the caret from line to line, so it never covers the text you are writing:

![The block action bar floating above a selected paragraph, showing the parent, tag, move, duplicate and formatting controls](../../images/block-action-bar.png)

- A **back arrow** selects the parent element.
- The **name badge** shows what's selected: the element's type or its name. When the element can become something else (a paragraph into a heading, for example), clicking the badge lists the conversions. On a component instance or a repeater, where there is nothing to convert to, the badge is grayed rather than gone.
- Drag the **⠿ drag handle** to move the element somewhere else on the page.
- **Move up** and **Move down** arrows swap the element with its neighbors.
- For a component instance, **Edit Component** opens the component itself; for anything else, **Convert to Component** turns the selection into a reusable component.
- While you're editing text, formatting buttons (bold, italic, and friends) and an **Insert data** button join the bar. See [Edit mode](/docs/studio/editing).

The bar steps aside when you leave the canvas. Click into the Inspector, a panel or the pane's context bar and it disappears, so it is never sitting over the control you were reaching for. **Your selection stays exactly as it was**, which is what the Inspector is editing. It comes back the moment the canvas is in play again: click the element on the canvas, or select anything from the Outline, and the bar is there for it. Panning or zooming the canvas leaves it alone, and so do the bar's own pieces: its `⋮` menu, the link popover and the slash menu. In Edit, the bar also hides while its element is scrolled out of view, including up under the writing banner over a collection entry, and returns when the element scrolls back. While only the top of the element has gone out of view, the bar drops below the element rather than standing above the page.

:::doc-tip
The bar keeps one shape. An action that cannot apply to the current selection, like moving the first child up or deleting the document root, is shown grayed with a tooltip saying what it needs, rather than disappearing. Buttons never move under your cursor.
:::

The bar also carries the structural verbs **Duplicate** and **Delete**. It shows a fixed run of them and keeps any further verb, with its name and its shortcut, behind a **More block actions** button rather than dropping it.

With several elements selected the bar sits on the last one you clicked and names it. **Duplicate** and **Delete** act on everything selected, in one undo step; the move arrows act on that one element, because moving several elements one slot along has no single meaning. See **[Select several at once](/docs/studio/design/layers#select-several-at-once)**.

## Inserting elements

Three ways to add something to the page:

- **The + affordance.** Move the pointer between two elements and a **+** appears at the insertion point. Click it and pick an element from the menu; the new element lands right there, selected. The menu stays where it opened while you move the pointer toward a row, whatever the pointer passes over; it closes when you pick, press `Escape`, click anywhere else, or scroll or zoom the canvas.
- **The slash menu.** While editing text, type `/` at the start of a line to insert headings, lists, images, buttons, and more without leaving the keyboard. See [Edit mode](/docs/studio/editing).
- **The Insert panel.** Click **Insert** on the Navigator rail and drag an element or component card onto the canvas. Drop it on the empty canvas below your content to add it at the end of the page.

## Drag and drop

You can drag onto and around the canvas from almost anywhere: cards from the **Insert** panel, rows in the **Outline** panel, and the **⠿** handle on the block action bar. While you drag, an indicator line shows exactly where the element will land: before, after, or inside the element under the cursor. Over the empty canvas below a short page it lands after the last element; over a layout's locked header or footer it lands nowhere. Drop to commit, or press :kbd[Esc] to cancel the drag with nothing changed.

Files from your desktop work too. Drop an image on empty space and Studio uploads it and inserts it there; drop it on a picture that's already on the page and it swaps that picture's source instead. The target highlights so you can tell the two apart before you let go. An upload that fails says so and stays said, on the **[Problems](/docs/studio/interface/problems-and-progress)** list, naming the file it couldn't write. See **[Media](/docs/studio/projects/media)**.

## The right-click context menu

Right-click any element for the full action list: **Copy**, **Cut**, **Duplicate**, **Copy styles** and **Paste styles**, **Insert before** and **Insert after**, **Wrap in Div**, **Repeat...** (turn the element into a repeating list), **Set Title**, **Edit Component** or **Convert to Component**, and **Delete**. With something on the clipboard, **Paste inside** and **Paste after** appear too.

Right-clicking an element that is already part of a [multiple selection](/docs/studio/design/layers#select-several-at-once) keeps that selection rather than collapsing it to the element you aimed at; right-clicking anything else selects it alone. **Cut** then removes the whole selection in one undo step, putting the element you aimed at on the clipboard. The other rows address that one element: to duplicate or delete a whole selection, use :kbd[⌘D] and :kbd[Delete], or the block action bar.

**Every** row is a command as well as a menu item, so all of them can be run by name from the [command palette](/docs/studio/interface/quick-access), with the same wording and the same reason when they are unavailable. A row that can't apply to what you have selected is grayed with that reason rather than hidden: **Cut** on the page root says it needs an element that isn't the root. See **[Commands](/docs/studio/interface/commands)**.

Right-clicking **empty space** around the page gives you the browser's own menu, not this one. There is nothing there to act on, and that margin is where you reach for View Source or Inspect. The desktop app shows no menu there. Inside text you are editing, a right-click gives the spelling and edit menu in both.

## Editing text

Click any text to put the cursor there and start typing. Everything about writing on the canvas is covered in **[Edit mode](/docs/studio/editing)**: formatting, the slash menu, links.

## Your site's styles

The canvas is a page of your site, not a picture of one. Everything a published page carries, the page on the canvas carries too: the fonts, links and scripts from your project's **Head** settings, its breakpoints, and the whole of its `style` block, applied as one stylesheet. That block is where your design tokens live, and it is also where **[Project Styles](/docs/studio/design/stylebook)** saves the default look of every heading, link and button. A rule you write there for `h1, h2` or for `a` styles the headings and links on the canvas exactly as it styles them on the built page: the same rule text, in the same order, so a heading in your display face and a link with no underline look that way here before you ever run a build.

:::doc-note
The canvas stylesheet and the one `jx build` writes are produced by the same builder and compared byte for byte in the test suite, so the two cannot drift apart quietly. If the canvas and a built page ever do disagree about a project-level style, that is a bug worth reporting rather than a limit of the editor.
:::

## Your site's data

The page on the canvas also knows where it is. `$page` and `$site` are filled in the way a build fills them: the page's URL, its title, its language and writing direction from the folder it sits in, and your site's name and languages. A collection entry gets the URL and language of the page that publishes it. So `${$page.locale}` formats a date in the page's own language on the canvas too, in every view.

In Edit and Design, everything your page draws from data shows the data: text, images, attributes and styles resolve to the values the page will have, not to the expressions that produce them. Bound text is made of [tags](/docs/studio/interface/modes), which read as plain text until your caret enters their block and are saved as the binding they stand for. A [repeater](/docs/studio/design/repeaters#rows-on-the-canvas) draws every item of its list, so each exhibition card shows its own exhibition's title, dates and gallery, whether the card is a component or plain elements. Click any card to work in it: the edit applies to the template, and every card redraws. The list's data is loaded before the page draws. An image shows a placeholder only when it names no source or its source fails to load.

Data a layout reads from a content type, such as a sidebar's navigation, is loaded the same way, and a package script a component names with `npm:` is loaded from your project's installed packages.

Data a page fetches is drawn too. A `GET` request and a server function each run once when you open the page, and the answer is reused for every redraw until you click **Refresh** in the **[Data panel](/docs/studio/logic/data#fetched-once)**. A request that would change something on a server, meaning any method but `GET`, is never sent from the canvas.

Where a binding has no value, the canvas says why and never shows the expression. The binding's name is drawn with one of three states, quietly underlined: **Loading** while its data is on the way, **Could not load** when the request failed (rest the pointer on it for the reason), and **Runs on the live page** for data the canvas does not fetch. A binding whose own expression fails says **Has an error**, which is a mistake in the expression and not in the data. A bound image is outlined the same way, and a list waiting for its data says so on its template row.

:::doc-note
Two things a built page has are still missing on the canvas: state declared at the project level, and the list of a page's translations (`$page.alternates`), so a language switcher built from it stays empty here.
:::

## Next

- Style what you select in **[Design mode](/docs/studio/design)**
- Wire up behavior in **[Logic](/docs/studio/logic)**
- Keep your hands on the keys with the **[shortcut reference](/docs/studio/interface/shortcuts)**
