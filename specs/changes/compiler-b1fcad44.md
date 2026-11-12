---
spec: compiler.md
level: minor
---

§2.1, §3, §8.1: a pure named formula is a function, not state. It makes a node dynamic only while something left for the client reads it, and the site build drops one whose every call it resolved, so a page whose only state is a formula builds static. The reference scan also reads `state?.key` and a literal-keyed `state["key"]`, and a body that hands `state` on whole keeps every entry.
