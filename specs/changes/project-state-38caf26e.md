---
spec: project-state.md
level: minor
---

Studio tabs carry a buffer state against a base hash: every write and delete Studio makes names a base, a refused or externally changed buffer is conflicted and asks the author before anything is written, and a co-edited tab reads its room's state. Section 6 is Implemented; §11.1 is Partial until the caches outside the store are keyed by document and hash.
