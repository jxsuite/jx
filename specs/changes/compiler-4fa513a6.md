---
spec: compiler.md
level: minor
---

A compiled element passes the host to onMount on its first connection, runs onAdopted from adoptedCallback, and observes its declared attributes through an inlined copy of the runtime's rule; the site build reads an instance's observed attributes beneath its props, counts them in the expansion path, and never treats a definition that declares them as fully static
