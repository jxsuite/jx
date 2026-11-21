---
spec: project-state.md
level: minor
---

§2.4 records a file's size and time only outside the filesystem's timestamp tick and never for an own write; §4.2 never pairs a move of the configuration or a dependency input; §4.8 states how a subscribe during a restart is answered; §5 states that a failed write leaves no temporary file or pending echo, that a write through an in-root link writes its target and keeps permissions, and that an unreadable file refuses a write or delete.
