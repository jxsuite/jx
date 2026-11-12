---
title: "Dynamic tags"
description: "Bind text, images and links to your data in Jx Studio: pick a source, a format and a fallback from a popover that shows the real value."
spec:
  - studio.md#6.9
  - studio.md#4.5
  - studio.md#4.4
code:
  - packages/studio/src/editor/dynamic-tags.ts
  - packages/studio/src/editor/tag-sources.ts
  - packages/studio/src/panels/dynamic-tag.ts
  - packages/studio/src/panels/tag-popover-door.ts
  - packages/studio/src/panels/tag-strip.ts
  - packages/studio/src/surfaces/dynamic-tag.ts
  - packages/studio/src/surfaces/tag-strip.ts
  - packages/studio/src/canvas/iframe-tags.ts
---

# Dynamic tags

A **dynamic tag** is a place where your page shows data instead of words you typed: a post's title in a heading, its date under it, its featured image, the address a link goes to. On the canvas a tag shows the real value. You never have to write the expression behind it: you pick what it reads, how it is written and what to show when there is nothing, and Studio writes the expression for you.

## See what is bound

- **In text**, put the caret in a block. Each tag in it turns into a tinted token with its name, such as **Post date**, ahead of its value.
- **On any element**, select it. The block action bar shows one **Bound pill** for every property the element draws from data: **Text: Title**, **Image: Featured image**, **Link: Permalink**. This is how you find a binding that draws no text, such as an image's source or a link's address. The bar shows up to four pills.
- **Without selecting anything**, point at an element. Bound elements get a dotted outline, and the hover box names what they read.

A name comes from your content type where it gives the field a title, so a field titled "Post date" is called that everywhere. Otherwise Studio makes one from the field's own name.

## Open a tag

Any of these opens the same popover, for one tag:

- Click a tag in the block you are working in. The first click on a block selects it, so click the tag once the block is selected or has your caret.
- Click a Bound pill.
- Click a tag in the Inspector, where a bound value is drawn the same way (see [below](#in-the-inspector)).

Press :kbd[Esc] or click elsewhere to close it, whichever control has focus. Focus goes back to where you were: the caret stays where you left it on the canvas. Clicking another tag while one is open shows that tag. A popover belongs to the tag it was opened on: switching to another tab, or deleting the block, closes it.

## Change what a tag shows

The popover has one field for each thing you can decide.

**Source** is the value the tag reads. Inside a [repeating list](/docs/studio/design/repeaters) it offers the current item's fields first, then your page's own data. Pick another field and every row on the canvas changes at once, because you are editing the template they share.

**Format** lists the ways the value can be written, and each one is drawn with your actual value. A date shows as "October 29, 2026", "Oct 29, 2026" and "10/29/26", so you choose by looking. Only formats that can read the value are offered: a title is never offered a number format. **As stored** removes the format. When a format has settings of its own, such as a time style beside the date style, they appear as fields under the list.

**Show** decides whether the tag gives the value itself, or a yes or no answer about it: **Whether it is set** or **Whether it is empty**. Use the second two for properties that are on or off, such as hiding an element when a field is blank.

**Fallback** is what to show when there is no value. Choose **When missing or blank** to cover an empty field as well as an absent one, or **When missing** to cover only an absent one, then type the text.

**Now** shows what the tag resolves to at this moment, on the row you are working in. If the value is still loading, could not be loaded, or the expression has an error, it says so and why.

Every change is saved as one step, so :kbd[⌘Z] / :kbd[Ctrl+Z] takes back exactly one decision. Opening a tag and closing it again changes nothing.

:::doc-note
Formats are ordinary formulas. The first time you pick one, Studio adds that formula to your page's data so the page carries everything it needs, and undoing the format removes it again. A formula you write yourself is offered as a format too when it takes one value. See **[Formulas](/docs/studio/logic/formulas)**.
:::

## Advanced, and custom expressions

**Advanced** holds the expression itself, for anything the fields do not cover. Edit it and click **Apply**, or press :kbd[⌘Enter] / :kbd[Ctrl+Enter].

Some bindings are more than a value, a format and a fallback: a condition, a calculation, a small function. Studio calls these **Custom expressions**. They show their live value like any other tag, and their popover opens straight to the expression, because there are no fields that could describe them. Studio never rewrites one. If you type something simpler into Advanced, the fields come back. Apply refuses text that would change the words around the tag, such as an unclosed brace or quote, and says so.

## Insert a tag

1. Put the caret where the value should go.
2. Click **Insert dynamic tag** (the `{ }` button) on the block action bar.
3. Pick a value from the list. Type to filter it. Each row shows what the value is today.

The tag goes in at the caret, between words, at either end of the block, or next to another tag. It shows its name for a moment and then its value, in every row of a repeating list. After you pick, you can keep typing: the caret is after the new tag. A block whose whole text is one bound value has nothing to put a tag in, and the button says so. To remove a tag, put the caret beside it and press :kbd[Backspace] or :kbd[Delete].

## In the Inspector

A value set to **Mixed text** in the Inspector is drawn as the canvas draws it: your words, with each tag as a small pill showing its name and current value. Click a pill to open the tag. Click **Edit as text** when you want to type around the tags, and **Show as tags** to go back.

## Read the template instead of the data

To see which parts of a page are bound, open the **Context** popover on the pane's context bar (the sliders button) and set **Bound data** to **Names**. Every tag on the canvas is drawn as its name instead of its value. Set it back to **Values** when you are done. This changes nothing in your document.

## Step through a repeating list

Select anything inside a repeating list and the block action bar shows a row stepper: **Row 3 of 24** with an arrow on each side. The arrows move to the previous or next row and scroll it into view, which is the quickest way to check a format or a fallback against other items. Click the row count to choose how many rows the canvas draws. A block that is a `$switch`, or one of its cases, shows a case picker that names the case the page selects, such as **Case: closed (live)**. See **[Rows on the canvas](/docs/studio/design/repeaters#rows-on-the-canvas)**.

## For scripts and assistants

Each of these controls runs a command that names the state it ends in, so it can be scripted: `canvas.setTagPopover`, `canvas.setBindingDisplay`, `canvas.setActiveRow`, `canvas.setRepeaterRows` and `canvas.setSwitchCase`. They are listed in **[Commands](/docs/studio/interface/commands)**.
