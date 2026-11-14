---
spec: compiler.md
level: major
---

§8.1 a live component prerenders its initial state: a repeater's rows, the initial value of state a handler writes (held only on the page-document scope) and the selected $switch case; a $switch, a chosen tag and a non-literal repeater make a definition live, a component a live one renders is live with it, and an expanded instance's markup is never read as a template. §4.4 states that the prerender is replaced in one synchronous pass, §4.7 writes literal items as JSON, §9.1 prerenders a bound value a handler writes.
