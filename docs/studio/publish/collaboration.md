---
title: "Real-time collaboration"
description: "Co-edit Jx files live: presence chips, shared cursors on canvas and in code, merged edits and shared saves, and how Studio falls back to solo editing."
spec:
  - collab.md#1.2 # persistence: a flush answers once
  - collab.md#2.4 # awareness state
  - collab.md#3.1
code:
  - packages/collab/src/provider.ts
  - packages/collab/src/schema.ts
  - packages/collab/src/style-order.ts
  - packages/studio/src/collab/collab-session.ts
  - packages/studio/src/collab/collab-state.ts
  - packages/studio/src/tabs/project-config.ts
  - packages/studio/src/collab/presence-chips.ts
  - packages/studio/src/surfaces/pane-context.json
  - packages/studio/src/surfaces/commandbar.json
  - packages/studio/src/collab/monaco-cursors.ts
  - packages/studio/src/collab/monaco-binding.ts
  - packages/server/src/collab.ts
  - packages/collab/src/source-lock.ts
  - packages/studio/src/files/based-writes.ts
---

# Real-time collaboration

When two people open the same file through the same Studio backend, the tab becomes a shared session: everyone sees everyone's edits as they happen, on the canvas and in the code. There's nothing to turn on. If your setup supports it (see below), co-editing starts by itself the moment a second person opens the file, and a file opened alone behaves exactly as always.

![A co-edited tab with the Live status pill, two presence chips, and a peer's colored selection box on the canvas](https://jxsuite.com/content/docs/images/collab-presence.png)

## What you see

- **A status pill** in the toolbar reads **Live** while the session is connected, and names every other state plainly: **Solo** when nobody else is here, **Connecting…**, **`Offline — changes sync on reconnect`**, or **Not connected** when the session could not start. Hover it for the reason. It replaces the usual unsaved-changes dot for this tab.
- **Flags beside the pill**: **Read-only** when you may look but not publish, and **Code view held** while a collaborator has the text view (see below). Both are standing statements, not error messages.
- **Presence chips**: one colored circle per collaborator, showing their avatar or initial. Hover one to see who it is and which file they're in; peers elsewhere in the project show up too, labeled with the file they're working in, and someone who has closed every shared file leaves the row. With several shared files open, a collaborator is labeled with the one they opened, or switched to Code view in, most recently.
- **Selections on the canvas**: every element a peer has selected is outlined in their color, labeled with their name, and follows them live. A peer working across several elements at once shows all of them, so you can see the whole shape of what they are about to change rather than one node of it.
- **Cursors in Code view**: in the **[Code](/docs/studio/logic/code)** mode the shared text carries every writer's caret and selection in their color, with their name on the caret. A caret goes away when its author leaves Code view, so the ones you can see are the people actually in the text with you.

## How co-editing behaves

- **Edits merge.** Everyone edits the same live document, and changes apply as they arrive. Two people typing in the same paragraph both keep what they typed, around bold text and links too, and two people changing different style properties of one element both keep theirs. Two people working in the same [document script](/docs/framework/concepts/functions) or the same function body both keep what they wrote. When two people change the same thing at once, such as one element's tag or the same style property, only one of the two changes is kept, and moving or wrapping an element while someone types inside it keeps the move and loses their typing. No locking, no taking turns.
- **Style declarations are kept in a fixed order.** A shared document does not remember the order you typed an element's style properties in. Everyone sees them with each shorthand (such as `margin`) before the properties it covers (such as `margin-left`), the rest by name, and nested rules such as `&:hover` after them. Breakpoint rules such as `@--sm` and `@--md` keep the order of the document's `$media` list, so a larger breakpoint still overrides a smaller one. This matters when a property was written before the shorthand that covers it: the shorthand used to win by coming later, and after sharing it comes first, so the specific property wins. Write the specific property after the shorthand if that is the result you want.
- **Undo is yours alone.** :kbd[⌘Z] / :kbd[Ctrl+Z] steps back through _your_ edits only, so you can't undo what a teammate just did. The status pill's tooltip says so, because it is the kind of rule that is easier to be told than to discover.
- **Forms sync too.** Page metadata and frontmatter fields co-edit the same way the canvas does.
- **Code view takes precedence, including over the person in it.** While someone is editing the file as text, the text is the truth: structural editing pauses for everyone, the text editor included. Their Outline, their Inspector and their canvas refuse the same edits everyone else's do, and say the same thing when they try. A **Code view held** flag stands beside the status pill for as long as it lasts, so a refused edit has a visible cause rather than looking like a fault. When the last text editor leaves Code view, normal editing resumes.

  The lock applies to the text editor as well. Holding the text lock while still editing the tree previously meant editing two representations with only one shared: the structural edit never reached the text, and leaving Code view parsed untouched text back over it. The layer you deleted reappeared seconds later without explanation. One document, one truth at a time: the lock holder is not exempt from their own lock.

- **Read-only guests follow along.** On backends that grant view-only access, those visitors see everything (content, cursors, presence), but their edits are not published. A banner says so before you start typing, and a **Read-only** flag sits beside the status pill.

## Your project's configuration stays yours

One document is deliberately outside the session: the **project file** (`project.jxn` or `project.json`), the file behind **[Project settings](/docs/studio/projects/settings)** and **Project Styles**. Open it and there is no pill, no presence, no shared cursor. It edits like a file you are alone with, because for this purpose you are.

Two reasons, and both are about what the file _is_:

- **Its edits don't come from the canvas.** The surfaces that write it are forms, not text: a settings form, the packages list, the deploy fields. The shared session is built for a document two people type into. A collaborator holding the text view would otherwise pause your configuration edits, which contain no text at all.
- **Its value configures your editor.** Studio reads all of this out of the project file as you work: the formats you can open, the extensions that are loaded, the schemas your JSON is checked against, the style cascade the canvas renders with. Shared, a teammate turning an extension on would reconfigure your editor mid-keystroke.

The consequence to plan around: **a collaborator does not see your configuration edits live.** They arrive with the file: once you have saved it, and once that saved file has reached them, whether by [source control](/docs/studio/publish/source-control) or by their reopening it. Tell the room when you change a shared setting; nothing else will.

## Commands

Open the **[Command palette](/docs/studio/interface/commands)** and type `Collaborate` for the session's verbs:

- **Collaborate: Share this document** and **Collaborate: Stop sharing** join or leave the session for the open document.
- **Collaborate: Copy session link** copies a reference to the room. It names the session; it does not grant anyone access to it.
- **Collaborate: Follow a collaborator** reports which file a named collaborator is in, and offers to open it.
- **Collaborate: What is happening in this document?** gives the full state in one place: connection, who is here, whether you can publish, whether the code view is held, and the undo rule.

## Syncing is not saving

Your edits reach your collaborators instantly, but the file on disk still changes only when someone saves. The explicit **Save** is unchanged. What _is_ shared is the unsaved state itself: the moment anyone edits, the file counts as unsaved for the whole session, and one person saving saves the shared result for everyone. If the save can't be written, or the connection drops before the server confirms it, Studio says so and the file stays unsaved. Committing in **[Source control](/docs/studio/publish/source-control)** saves open co-edited files first, so a commit captures what the session currently sees, except for a file whose session is waiting on the changed-on-disk question below, which the commit takes as it is on disk. If a co-edited file can't be saved, the commit stops and names it.

A save never overwrites a change it has not seen. On the dev server and on Jx Cloud, a session remembers the exact bytes it loaded or last saved, and its save is written only if the file on disk is still those bytes. When a change made outside the session (another editor, a script, a git checkout, or on Jx Cloud a pull, a discard, or a save from a tab that is not in the session) reaches a session with no unsaved edits, the session resets onto the new content, as described under [Falling back to solo](#falling-back-to-solo). When the session has unsaved edits, it keeps them: the file stays unsaved for everyone in the session, and [Problems](/docs/studio/interface/problems-and-progress) says that the file changed on disk. A save that lands before the outside change has reached the session finds the same thing and writes nothing.

Saving the session then asks first, with the same three answers as a document of your own (see [When the file changes on disk](/docs/studio/interface/tabs#when-the-file-changes-on-disk)):

- **Keep Mine** saves the session's edits over the copy on disk.
- **Take Disk Copy** throws the session's edits away for everyone in it, and every open copy of the file, the Code view included, shows it as it is on disk.
- **Compare** saves nothing and shows what the session would save beside the copy on disk.

The notice clears once the session saves, takes the disk copy, or you leave it.

Renaming or moving a co-edited file inside the open project, on the dev server or on Jx Cloud, keeps the session. Everyone who had it open stays in it, opening it at its new path joins the same session with its unsaved edits, and the next save lands at the new path. Deleting the file ends the session.

Opening another project on the same dev server, from any tab, ends the sessions of the project before it. Each one with unsaved edits is saved first. If that save is refused because the file changed on disk in the meantime, those unsaved edits are lost.

:::doc-warning
On a shared dev server, unsaved co-edits live only in the server's memory. If everyone closes the file without saving, those edits are discarded shortly after, so save before you all walk away. Stopping the dev server discards them too. A tab that is still open keeps your edits, so save it once the server is back.
:::

## Which setups support it

- **A shared dev server** is the built-in case. Everyone who opens the same dev-server URL (see **[The dev server](/docs/framework/build/dev-server)**) co-edits; even two browser windows on your own machine will. The dev server has no user accounts, so collaborators appear with generic names (`local-1`, `local-2`, …) and everyone can write.
- **A hosted Studio backend** gives the same experience wherever it offers a collaboration endpoint, with real identities (name and avatar) and per-person write or read-only permission supplied by the platform.
- **The [desktop app](/docs/studio/desktop)** is always solo: it edits your local files directly and has no collaboration endpoint.

## Falling back to solo

Collaboration degrades, never blocks:

- A backend without the endpoint simply gives you ordinary solo editing, with no errors and no pill.
- A backend running a **different version of the co-editing wire format** also gives you solo editing, rather than a session. Studio and the backend agree on a format before the connection opens, and when they can't, joining anyway would mean two copies of the document merging edits neither side reads the same way. Updating whichever side is older restores it.
- If a session can't sync within a few seconds of opening, the tab proceeds solo and the pill reads **Not connected** with the reason on hover. This is deliberately not the same as **Solo**: **Solo** means nobody else is here, **Not connected** means something went wrong, and the two never wear the same word.
- If the connection drops, the pill reads **`Offline — changes sync on reconnect`**: keep editing, and your changes merge when the connection returns.
- If the file is replaced underneath a session with no unsaved edits (a git pull or discard, an outside edit), the session resets and rejoins on the new content automatically. One with unsaved edits keeps them and asks when you save (see [Syncing is not saving](#syncing-is-not-saving)).

## Next

- **[Source control](/docs/studio/publish/source-control)** turns the shared result into a commit.
- **[Code](/docs/studio/logic/code)** is the text view that co-editing shares character by character.
