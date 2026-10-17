---
spec: spec.md
level: minor
---

§8.5 states one slot distribution rule (capture, group, place, forward) and the interpreter, the compiled component module and the static prerender all apply it: whitespace-only text is discarded, the first slot of a name takes its group, fallback follows a group with no content, a forwarded slot is grouped by its own slot attribute, and a prerendered instance recovers its bracketed children on upgrade; §16.6 names data-jx-slots among the hydration markers.
