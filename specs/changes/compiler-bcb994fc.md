---
spec: compiler.md
level: minor
---

4.3, 8.1: the element target attaches a definition's root-level handlers to the host from the constructor, lowered as a child's binding is, writes its root attributes in connectedCallback, and the prerender writes them on every expanded instance; a template that hands the scope itself to a helper compiles.
