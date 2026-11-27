---
spec: relationships.md
level: minor
---

Table to table: a to-one reference column is typed like its target's id and carries a foreign key that clears on delete, enforced on every shipped dialect, so an include onto an integer-id table resolves; existing columns are reported as drift, never altered, and a reference into another connection's table is stored without a key, a join or a junction.
