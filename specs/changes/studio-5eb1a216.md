---
spec: studio.md
level: minor
---

6.1: Component Settings reads and edits a prop where the instance delivers it (the props.* shorthand, an attribute named like a reflected DOM property, a top-level key, a data-jx-props payload) in the order the runtime draws them, moves a value the route cannot carry (including a binding in an attribute) to $props, leaves every write one source and clears every source together, keeps an empty string in place on a route other than $props, and keeps an attribute that delivers a declared prop out of Custom; an npm flag is still a boolean attribute. 8.2.6 names the one reader the canvas and the panel share, and an attribute named like a prop that is not a DOM property no longer refuses an inline edit.
