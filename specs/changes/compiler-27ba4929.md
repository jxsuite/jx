---
spec: compiler.md
level: minor
---

4.7, 8.1, 11, 12: mapped-array compilation applies filter and sort through an inlined helper and lowers a keyed list to lit repeat behind a coalescing directive; the build leaves a list over runtime-only state for the client, holds state an inline handler writes, and every page import map carries the prefix keys.
