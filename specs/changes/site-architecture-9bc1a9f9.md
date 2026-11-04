---
spec: site-architecture.md
level: minor
---

§4.3 a paginate source splits an array in the page's own state into numbered routes, the first at the list's own URL under a catch-all, each built with its slice and its pager values, once per value of an each source when the list belongs to another parameter; §4.5, §5.5 and §8.4.1 say so. §6.4 a ContentCollection queries several content types as one list, reads dotted field paths through arrays, and resolves #/$params and #/state references in a filter value; a field with no value contains nothing, so not contains keeps the entry.
