---
spec: project-state.md
level: minor
---

The dev server runs the project state host for its active project and serves the Server-Sent Events binding and conditional file writes (§10.2, §3.2); collaboration rooms are keyed by document, follow renames, save with a base and are saved before an activation closes them, and the dev server keys the preview overlay by document and client (§11.3, §5); a binding that cannot tie a request to a subscription keeps the unconditional write for every request without a base (§5).
