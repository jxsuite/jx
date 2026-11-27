---
spec: desktop.md
level: minor
---

§3.1: the settings lock spans processes. A patch holds an exclusive lockfile beside the store from the read to the write, a lockfile whose holder is gone or which has outlived any write is broken, a patch that cannot take the lock fails rather than writing without it, and §3.1 is Implemented.
