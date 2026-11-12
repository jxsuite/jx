---
spec: studio.md
level: minor
---

Remote data on the editing canvas: a GET request and a server function run once per tab and are kept, keyed by what they ask for; Refresh fetches again; a request whose method is not the text GET never runs; a frame handed another tab keeps the request it had out for the tab that asked; bindings draw and report pending, failed and not-run states (bindingStatus); a host with no backend says once that it resolves no collections. canvas.setStateValue sets a plain state value for the canvas, with an On canvas field and a mark on the Data panel row (§4.1, §4.5, §5.6).
