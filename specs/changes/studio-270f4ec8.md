---
spec: studio.md
level: minor
---

§4.1: a `$props` edit on a component instance writes the changed props into the live instance instead of rebuilding it, falls back to rebuilding where a write could differ from a fresh render, and the release of a prop-bound inline edit names the instance in its patch's `redrawPaths` so it is drawn again.
